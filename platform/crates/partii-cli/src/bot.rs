//! `partii bot host|guest`: a headless engine peer for the torture harness
//! and quick checks. Speaks the bot contract (JSON lines on stdout):
//! created, joined, connected (with the
//! rung = the path in use), gap, summary, error, done.

use crate::out::{CliError, CliResult};
use crate::Cli;
use clap::Subcommand;
use partii_engine::{Config, Engine, Event, PathId};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[derive(Subcommand, Debug)]
pub enum BotCmd {
    /// Create a room and echo everything back to its sender.
    #[command(after_help = "partii bot host --key pk_demo_k1_... --secs 30")]
    Host {
        #[arg(long, env = "PARTII_KEY", hide_env_values = true)]
        key: Option<String>,
        #[arg(long, default_value_t = 20)]
        secs: u64,
        /// Use the ws relay only (no WebRTC).
        #[arg(long)]
        ws_only: bool,
        /// Time in the menu before creating (an app is open a while before
        /// its player hosts; 0 creates the moment the socket is up).
        #[arg(long, default_value_t = 1500)]
        menu_ms: u64,
    },
    /// Join a room and ping the host every 50 ms; report timings.
    #[command(after_help = "partii bot guest --key pk_demo_k1_... --code ABCDE --secs 20")]
    Guest {
        #[arg(long, env = "PARTII_KEY", hide_env_values = true)]
        key: Option<String>,
        #[arg(long)]
        code: String,
        #[arg(long, default_value_t = 20)]
        secs: u64,
        #[arg(long)]
        ws_only: bool,
    },
}

fn line(v: Value) {
    println!("{v}");
}

fn engine(cli: &Cli, key: &Option<String>, ws_only: bool) -> Result<Engine, CliError> {
    let key = key.clone().ok_or_else(|| CliError::usage("no key", "pass --key or set PARTII_KEY (a publishable key, pk_...)"))?;
    Ok(Engine::start(Config { edge: cli.api.clone(), key, conn: Engine::new_conn_id(), client: "partii-bot".into(), player_token: None, no_webrtc: ws_only }))
}

/// Wait for `Online` (or give up).
fn online(e: &Engine, t0: Instant) -> Result<(), String> {
    let deadline = t0 + Duration::from_secs(20);
    while Instant::now() < deadline {
        match e.next_event(Duration::from_millis(200)) {
            Some(Event::Online { .. }) => return Ok(()),
            Some(Event::Error { message }) => return Err(message),
            _ => {}
        }
    }
    Err("could not reach partii within 20 s".into())
}

pub fn run(cli: &Cli, cmd: &BotCmd) -> CliResult {
    match cmd {
        BotCmd::Host { key, secs, ws_only, menu_ms } => host(cli, key, *secs, *ws_only, *menu_ms),
        BotCmd::Guest { key, code, secs, ws_only } => guest(cli, key, code, *secs, *ws_only),
    }
}

fn host(cli: &Cli, key: &Option<String>, secs: u64, ws_only: bool, menu_ms: u64) -> CliResult {
    let t0 = Instant::now();
    let e = engine(cli, key, ws_only)?;
    if let Err(m) = online(&e, t0) {
        line(json!({"ev": "error", "msg": m}));
        return Ok(json!({"role": "host", "error": m}));
    }
    std::thread::sleep(Duration::from_millis(menu_ms));
    let t_create = Instant::now();
    let req = e.create("torture", Some(8), "game", "bot-host", Value::Null);
    let deadline = Instant::now() + Duration::from_secs(secs + 90);
    let mut code = None;
    while Instant::now() < deadline {
        let Some(ev) = e.next_event(Duration::from_millis(100)) else { continue };
        match ev {
            Event::Created { req: r, room } if r == req => {
                line(json!({"ev": "created", "code": room.code, "ms": t_create.elapsed().as_millis() as u64, "online_ms": (t_create - t0).as_millis() as u64 - menu_ms as u128 as u64}));
                code = Some(room.code);
            }
            Event::Failed { req: r, code: c, message } if r == req => {
                line(json!({"ev": "error", "msg": format!("create: {c}: {message}")}));
                break;
            }
            Event::Message { from, reliable, bytes } => e.send(from, reliable, bytes),
            Event::PeerConnected { mid, path } => line(json!({"ev": "peer", "mid": mid, "path": path})),
            Event::PathChanged { mid, from, to, rtt } => line(json!({"ev": "path", "mid": mid, "from": from, "to": to, "rtt": rtt})),
            _ => {}
        }
    }
    line(json!({"ev": "done"}));
    Ok(json!({"role": "host", "code": code}))
}

fn guest(cli: &Cli, key: &Option<String>, code: &str, secs: u64, ws_only: bool) -> CliResult {
    let t0 = Instant::now();
    let ms = || t0.elapsed().as_millis() as u64;
    let e = engine(cli, key, ws_only)?;
    if let Err(m) = online(&e, t0) {
        line(json!({"ev": "error", "msg": m, "ms": ms()}));
        line(json!({"ev": "done"}));
        return Ok(json!({"role": "guest", "error": m}));
    }
    let online_ms = ms();
    // Apps open their socket at launch; timings run from the join itself.
    let t_join = Instant::now();
    let jms = || t_join.elapsed().as_millis() as u64;
    let req = e.join(code, "game", "bot-guest", Value::Null);
    let mut host: Option<u16> = None;
    let mut path: Option<PathId> = None;
    let mut paths: Vec<Value> = Vec::new();
    let mut connected_at: Option<Instant> = None;
    let mut end: Option<Instant> = None;
    let mut sent = 0u64;
    let mut rtts: Vec<f64> = Vec::new();
    let mut echo_times: Vec<Instant> = Vec::new();
    let mut last_echo = Instant::now();
    let mut longest_gap = 0u128;
    let mut last_ping = Instant::now() - Duration::from_secs(1);
    let mut err: Option<String> = None;
    loop {
        let now = Instant::now();
        if connected_at.is_none() && now - t0 > Duration::from_secs(30) {
            err = Some("no echo within 30 s".into());
            line(json!({"ev": "error", "msg": "no echo within 30 s", "ms": ms(), "rung": path}));
            break;
        }
        if end.is_some_and(|t| now > t) {
            break;
        }
        if let Some(h) = host {
            if now - last_ping >= Duration::from_millis(50) {
                last_ping = now;
                let stamp = t0.elapsed().as_micros() as u64;
                e.send(h, false, stamp.to_le_bytes().to_vec());
                sent += 1;
                if connected_at.is_some() {
                    longest_gap = longest_gap.max(last_echo.elapsed().as_millis());
                }
            }
        }
        let Some(ev) = e.next_event(Duration::from_millis(5)) else { continue };
        match ev {
            Event::Joined { req: r, room } if r == req => {
                line(json!({"ev": "joined", "ms": jms(), "online_ms": online_ms}));
                host = Some(room.host);
            }
            Event::Failed { req: r, code: c, message } if r == req => {
                err = Some(format!("join: {c}: {message}"));
                line(json!({"ev": "error", "msg": err, "ms": ms()}));
                break;
            }
            Event::PeerConnected { path: p, .. } => {
                path = Some(p);
                paths.push(json!({"at_ms": ms(), "to": p}));
            }
            Event::PathChanged { to, rtt, .. } => {
                path = Some(to);
                paths.push(json!({"at_ms": ms(), "to": to, "rtt": rtt}));
            }
            Event::Message { bytes, .. } if bytes.len() == 8 => {
                let stamp = u64::from_le_bytes(bytes[..8].try_into().unwrap());
                let rtt = (t0.elapsed().as_micros() as u64).saturating_sub(stamp) as f64 / 1000.0;
                let gap = last_echo.elapsed().as_millis();
                if connected_at.is_some() && gap > 500 {
                    line(json!({"ev": "gap", "ms": gap as u64}));
                }
                last_echo = Instant::now();
                echo_times.push(last_echo);
                if connected_at.is_none() {
                    connected_at = Some(Instant::now());
                    end = Some(Instant::now() + Duration::from_secs(secs));
                    line(json!({"ev": "connected", "ms": jms(), "rung": path}));
                }
                rtts.push(rtt);
            }
            Event::RoomClosed { reason } => line(json!({"ev": "lost", "at_ms": ms(), "reason": reason})),
            Event::Offline => line(json!({"ev": "offline", "at_ms": ms()})),
            _ => {}
        }
    }
    rtts.sort_by(|a, b| a.total_cmp(b));
    let pct = |p: f64| rtts.get(((rtts.len() as f64 - 1.0) * p).round() as usize).copied();
    let tail = echo_times.iter().filter(|t| t.elapsed() < Duration::from_secs(3)).count();
    let stats = e.stats();
    let summary = json!({"ev": "summary", "stats": stats, "sent": sent, "echoed": rtts.len(), "tail_echoes": tail, "rtt_p50": pct(0.5), "rtt_p95": pct(0.95), "longest_gap_ms": longest_gap as u64, "rung": path, "paths": paths});
    line(summary.clone());
    line(json!({"ev": "done"}));
    Ok(json!({"role": "guest", "error": err, "summary": summary}))
}
