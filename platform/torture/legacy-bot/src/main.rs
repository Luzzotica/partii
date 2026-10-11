//! legacy-bot: one side of a torture trial over today's Lobbii protocol.
//!
//!   legacy-bot host  --api URL --key K [--secs N]
//!   legacy-bot guest --api URL --key K --code CODE [--secs N]
//!
//! Prints JSON lines (the bot contract shared with `partii bot`):
//!   {"ev":"created","code","ms"}   host: create call → room ready
//!   {"ev":"joined","ms"}           guest: join call → room ready
//!   {"ev":"connected","ms","rung"} guest: join call → first echoed ping
//!   {"ev":"gap","ms"}              guest: a stall in echoes longer than 500 ms
//!   {"ev":"summary",...}           guest: pings sent/echoed, RTT p50/p95, longest gap
//!   {"ev":"error","msg"}
//! The host echoes every unreliable message back to its sender.

use party_kit_native::{HostOpts, JoinOpts, PartyConfig, PartyEvent, PartySession, Payload};
use serde_json::json;
use std::time::{Duration, Instant};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn out(v: serde_json::Value) {
    println!("{v}");
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let role = args.first().cloned().unwrap_or_default();
    let api = arg(&args, "--api").unwrap_or_else(|| "https://www.sterlinglong.me".into());
    let key = arg(&args, "--key").or_else(|| std::env::var("LEGACY_API_KEY").ok()).unwrap_or_default();
    let secs: u64 = arg(&args, "--secs").and_then(|s| s.parse().ok()).unwrap_or(20);
    let mut cfg = PartyConfig::new(api, key, "tankii-torture");
    cfg.platform = "dev".into();
    match role.as_str() {
        "host" => host(cfg, secs).await,
        "guest" => guest(cfg, arg(&args, "--code").unwrap_or_default(), secs).await,
        _ => out(json!({"ev":"error","msg":"usage: legacy-bot host|guest --api URL --key K [--code C] [--secs N]"})),
    }
}

async fn host(cfg: PartyConfig, secs: u64) {
    let t0 = Instant::now();
    let session = match PartySession::host(cfg, HostOpts { max_peers: Some(4), ..Default::default() }).await {
        Ok(s) => s,
        Err(e) => return out(json!({"ev":"error","msg":format!("host: {e}")})),
    };
    let mut rx = session.subscribe();
    out(json!({"ev":"created","code":session.join_code(),"ms":t0.elapsed().as_millis() as u64}));
    let deadline = Instant::now() + Duration::from_secs(secs + 60);
    while Instant::now() < deadline {
        let Ok(Ok(ev)) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await else { continue };
        match ev {
            PartyEvent::Message { peer_id, channel, payload } => {
                session.send(&peer_id, Some(&channel), payload).await;
            }
            PartyEvent::PeerConnected { peer_id, .. } => out(json!({"ev":"peer","peer":peer_id})),
            PartyEvent::Phase { phase, detail, .. } => {
                if phase == "selected" { out(json!({"ev":"selected","detail":detail})); }
                if std::env::var_os("BOT_TRACE").is_some() { eprintln!("host phase {phase} {detail}"); }
            }
            _ => {}
        }
    }
    session.end().await;
}

async fn guest(cfg: PartyConfig, code: String, secs: u64) {
    let t0 = Instant::now();
    let session = match PartySession::join_by_code(cfg, &code, JoinOpts { kind: std::env::var("BOT_KIND").unwrap_or_else(|_| "screen".into()), ..Default::default() }).await {
        Ok(s) => s,
        Err(e) => return out(json!({"ev":"error","msg":format!("join: {e}"),"ms":t0.elapsed().as_millis() as u64})),
    };
    let mut rx = session.subscribe();
    out(json!({"ev":"joined","ms":t0.elapsed().as_millis() as u64}));
    let mut host_peer: Option<String> = None;
    let mut rung: Option<String> = None;
    let mut connected_at: Option<Instant> = None;
    let mut sent = 0u64;
    let mut rtts: Vec<f64> = Vec::new();
    let mut last_echo = Instant::now();
    let mut longest_gap = 0u128;
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    let connect_deadline = t0 + Duration::from_secs(30);
    let mut end: Option<Instant> = None;
    loop {
        let now = Instant::now();
        if connected_at.is_none() && now > connect_deadline {
            out(json!({"ev":"error","msg":"no echo within 30 s","ms":t0.elapsed().as_millis() as u64,"rung":rung}));
            break;
        }
        if end.is_some_and(|e| now > e) {
            break;
        }
        tokio::select! {
            _ = tick.tick() => {
                if let Some(p) = &host_peer {
                    let stamp = t0.elapsed().as_micros() as u64;
                    if session.send(p, Some("input"), Payload::Binary(stamp.to_le_bytes().to_vec())).await {
                        sent += 1;
                    }
                }
                if connected_at.is_some() {
                    let gap = last_echo.elapsed().as_millis();
                    longest_gap = longest_gap.max(gap);
                }
            }
            ev = rx.recv() => {
                let Ok(ev) = ev else { continue };
                match ev {
                    PartyEvent::PeerConnected { peer_id, .. } => host_peer = Some(peer_id),
                    PartyEvent::Phase { phase, detail, .. } => {
                        if phase == "selected" { rung = detail["candidate_type"].as_str().map(str::to_string); }
                        if std::env::var_os("BOT_TRACE").is_some() { eprintln!("guest phase {phase} {detail}"); }
                    }
                    PartyEvent::PeerDisconnected { .. } => out(json!({"ev":"lost","at_ms":t0.elapsed().as_millis() as u64})),
                    PartyEvent::Message { payload: Payload::Binary(b), .. } if b.len() == 8 => {
                        let stamp = u64::from_le_bytes(b[..8].try_into().unwrap());
                        let rtt = (t0.elapsed().as_micros() as u64).saturating_sub(stamp) as f64 / 1000.0;
                        let gap = last_echo.elapsed().as_millis();
                        if connected_at.is_some() && gap > 500 {
                            out(json!({"ev":"gap","ms":gap as u64}));
                        }
                        last_echo = Instant::now();
                        if connected_at.is_none() {
                            connected_at = Some(Instant::now());
                            end = Some(Instant::now() + Duration::from_secs(secs));
                            out(json!({"ev":"connected","ms":t0.elapsed().as_millis() as u64,"rung":rung}));
                        }
                        rtts.push(rtt);
                    }
                    _ => {}
                }
            }
        }
    }
    rtts.sort_by(|a, b| a.total_cmp(b));
    let pct = |p: f64| rtts.get(((rtts.len() as f64 - 1.0) * p).round() as usize).copied();
    out(json!({"ev":"summary","sent":sent,"echoed":rtts.len(),"rtt_p50":pct(0.5),"rtt_p95":pct(0.95),"longest_gap_ms":longest_gap as u64,"rung":rung}));
    session.end().await;
}
