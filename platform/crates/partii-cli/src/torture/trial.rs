//! One torture trial: a host bot creates a room, a guest bot joins it and
//! pings through it, and the scenario's disruption (if any) hits mid-game.
//! Bots speak the JSON-line contract in torture/legacy-bot/src/main.rs.

use super::scenario::{Disruption, Scenario};
use super::topo::{docker, Topo};
use crate::out::CliError;
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, clap::ValueEnum)]
#[serde(rename_all = "kebab-case")]
pub enum Client {
    /// Today's party-kit TypeScript in headless Chromium (the baseline).
    LegacyWeb,
    /// The partii engine (`partii bot`).
    Engine,
}

pub struct BotTarget {
    pub client: Client,
    pub api: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct TrialResult {
    pub scenario: String,
    pub trial: u32,
    pub connected: bool,
    pub create_ms: Option<u64>,
    pub join_ms: Option<u64>,
    pub connect_ms: Option<u64>,
    pub rung: Option<String>,
    pub rtt_p50: Option<f64>,
    pub rtt_p95: Option<f64>,
    pub longest_gap_ms: Option<u64>,
    /// Disruption scenarios: did echoes flow again by the end?
    pub recovered: Option<bool>,
    pub error: Option<String>,
}

fn bot_cmd(t: &BotTarget, role: &str, code: Option<&str>, secs: u64) -> Vec<String> {
    let mut v: Vec<String> = match t.client {
        Client::LegacyWeb => vec!["node".into(), "/bots/legacy-web-bot/run.mjs".into()],
        Client::Engine => vec!["/bots/bin/partii".into(), "bot".into()],
    };
    v.extend([role.into(), "--api".into(), t.api.clone(), "--secs".into(), secs.to_string()]);
    if let Some(c) = code {
        v.extend(["--code".into(), c.into()]);
    }
    v
}

fn spawn(container: &str, t: &BotTarget, cmd: Vec<String>) -> Result<(Child, Receiver<Value>), CliError> {
    let mut args = vec!["exec".to_string(), "-e".into(), format!("LEGACY_API_KEY={}", t.key), "-e".into(), format!("PARTII_KEY={}", t.key), container.into()];
    args.extend(cmd);
    let mut child = Command::new("docker")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| CliError::new("docker_missing", e.to_string(), "install and start Docker"))?;
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    Ok((child, rx))
}

fn kill_bots(container: &str) {
    let _ = docker(&["exec", container, "sh", "-c", "pkill -f run.mjs; pkill -f chrom; pkill -f 'partii bot'; true"]);
}

pub fn run(topo: &Topo, s: &Scenario, t: &BotTarget, trial: u32) -> TrialResult {
    let mut r = TrialResult { scenario: s.name.into(), trial, ..Default::default() };
    let secs = if s.disruption.is_some() { 30 } else { 12 };
    let out = run_inner(topo, s, t, secs, &mut r);
    if let Err(e) = out {
        r.error.get_or_insert(e.message);
    }
    kill_bots(&topo.host);
    kill_bots(&topo.guest);
    r
}

fn run_inner(topo: &Topo, s: &Scenario, t: &BotTarget, secs: u64, r: &mut TrialResult) -> Result<(), CliError> {
    let (mut host, hrx) = spawn(&topo.host, t, bot_cmd(t, "host", None, secs))?;
    let code = loop {
        match hrx.recv_timeout(Duration::from_secs(45)) {
            Ok(v) if v["ev"] == "created" => {
                r.create_ms = v["ms"].as_u64();
                break v["code"].as_str().unwrap_or_default().to_string();
            }
            Ok(v) if v["ev"] == "error" => {
                r.error = Some(format!("host: {}", v["msg"].as_str().unwrap_or("?")));
                let _ = host.kill();
                return Ok(());
            }
            Ok(_) => continue,
            Err(_) => {
                r.error = Some("host: no room within 45 s".into());
                let _ = host.kill();
                return Ok(());
            }
        }
    };
    let (mut guest, grx) = spawn(&topo.guest, t, bot_cmd(t, "guest", Some(&code), secs))?;
    let deadline = Instant::now() + Duration::from_secs(secs + 60);
    let mut disrupted: Option<std::thread::JoinHandle<Result<(), CliError>>> = None;
    while Instant::now() < deadline {
        let Ok(v) = grx.recv_timeout(Duration::from_millis(500)) else {
            if guest.try_wait().ok().flatten().is_some() {
                break;
            }
            continue;
        };
        match v["ev"].as_str() {
            Some("joined") => r.join_ms = v["ms"].as_u64(),
            Some("connected") => {
                r.connected = true;
                r.connect_ms = v["ms"].as_u64();
                r.rung = v["rung"].as_str().map(str::to_string);
                if let Some(d) = s.disruption {
                    let topo = topo.clone();
                    disrupted = Some(std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_secs(4));
                        match d {
                            Disruption::SwitchNetwork => topo.switch_guest_network(),
                            Disruption::Background => topo.pause_guest(10),
                        }
                    }));
                }
            }
            Some("error") => {
                r.error = Some(v["msg"].as_str().unwrap_or("?").to_string());
            }
            Some("summary") => {
                r.rtt_p50 = v["rtt_p50"].as_f64();
                r.rtt_p95 = v["rtt_p95"].as_f64();
                r.longest_gap_ms = v["longest_gap_ms"].as_u64();
                if r.rung.is_none() {
                    r.rung = v["rung"].as_str().map(str::to_string);
                }
                if s.disruption.is_some() && r.connected {
                    r.recovered = Some(v["tail_echoes"].as_u64().unwrap_or(0) > 0);
                }
            }
            Some("done") => break,
            _ => {}
        }
        if r.recovered.is_some() || (r.error.is_some() && !r.connected) {
            // Summary seen, or the guest gave up before connecting.
            if v["ev"] == "summary" || v["ev"] == "error" && !r.connected {
                break;
            }
        }
    }
    if let Some(h) = disrupted {
        if let Ok(Err(e)) = h.join() {
            r.error.get_or_insert(format!("disruption: {}", e.message));
        }
    }
    let _ = guest.kill();
    let _ = host.kill();
    Ok(())
}
