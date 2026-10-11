//! `partii torture`: run real clients through bad networks (docs/DESIGN.md,
//! "Proof"). Each scenario gets its own Docker topology; trials run host and
//! guest bots through it and record timings, the rung that connected, and
//! whether the link survived the scenario's disruption.

mod report;
mod scenario;
mod topo;
mod trial;

use crate::out::{progress, CliError, CliResult};
use crate::Cli;
use clap::Subcommand;
use serde_json::json;
use std::path::PathBuf;
pub use trial::Client;

#[derive(Subcommand, Debug)]
pub enum TortureCmd {
    /// List the scenarios.
    Scenarios,
    /// Run trials and write a report.
    #[command(after_help = "partii torture run --client legacy-web --api https://www.sterlinglong.me --trials 10 --label baseline\n\
                            partii torture run --client engine --scenario cgnat --trials 50")]
    Run {
        /// Which client the bots run.
        #[arg(long, value_enum, default_value = "engine")]
        client: Client,
        /// Only these scenarios (repeatable). Default: all.
        #[arg(long)]
        scenario: Vec<String>,
        /// Trials per scenario.
        #[arg(long, default_value_t = 5)]
        trials: u32,
        /// Scenarios run side by side.
        #[arg(long, default_value_t = 4)]
        jobs: usize,
        /// The game key the bots use (a publishable key, or a legacy mpk_ key for --client legacy-web).
        #[arg(long, env = "PARTII_KEY", hide_env_values = true)]
        key: Option<String>,
        /// Report name (files go to <out>/<label>.md and raw/<label>.jsonl).
        #[arg(long, default_value = "torture")]
        label: String,
        /// Report directory.
        #[arg(long, default_value = "docs/reports")]
        out: PathBuf,
        /// The platform/ directory (holds torture/ and the Linux bot build).
        #[arg(long, default_value = ".")]
        platform_dir: PathBuf,
    },
    /// Remove every torture container and network.
    Clean,
}

pub fn run(cli: &Cli, cmd: &TortureCmd) -> CliResult {
    match cmd {
        TortureCmd::Scenarios => Ok(json!({ "scenarios": scenario::all() })),
        TortureCmd::Clean => {
            for (i, s) in scenario::all().iter().enumerate() {
                topo::Topo::new(&format!("pt-{}", s.name), 60 + i as u8, vec![]).down();
            }
            Ok(json!({ "cleaned": true }))
        }
        TortureCmd::Run { client, scenario: only, trials, jobs, key, label, out, platform_dir } => {
            let scenarios: Vec<_> = scenario::all().into_iter().filter(|s| only.is_empty() || only.iter().any(|o| o == s.name)).collect();
            if scenarios.is_empty() {
                return Err(CliError::usage(format!("no scenario named {:?}", only), "run `partii torture scenarios` for the names"));
            }
            let key = key.clone().ok_or_else(|| CliError::usage("no game key", "pass --key or set PARTII_KEY"))?;
            let platform = platform_dir.canonicalize().map_err(|_| CliError::usage("platform dir not found", "pass --platform-dir <path to platform/>"))?;
            let mounts = match client {
                Client::LegacyWeb => vec![format!("{}:/bots/legacy-web-bot:ro", platform.join("torture/legacy-web-bot").display())],
                Client::Engine => vec![format!("{}:/bots/bin:ro", platform.join("target-linux/bin").display())],
            };
            if cli.dry_run {
                return Ok(json!({ "dry_run": true, "scenarios": scenarios.iter().map(|s| s.name).collect::<Vec<_>>(), "trials": trials, "client": client }));
            }
            let target = trial::BotTarget { client: *client, api: cli.api.clone(), key };
            let all_idx: Vec<(usize, &str)> = scenario::all().iter().enumerate().map(|(i, s)| (i, s.name)).collect();
            let results = std::sync::Mutex::new(Vec::new());
            let queue = std::sync::Mutex::new(scenarios.clone());
            std::thread::scope(|scope| {
                for _ in 0..(*jobs).max(1) {
                    scope.spawn(|| loop {
                        let Some(s) = queue.lock().unwrap().pop() else { break };
                        let octet = 60 + all_idx.iter().find(|(_, n)| *n == s.name).map(|(i, _)| *i).unwrap_or(0) as u8;
                        let topo = topo::Topo::new(&format!("pt-{}", s.name), octet, mounts.clone());
                        if let Err(e) = topo.up(&s) {
                            progress(json!({"scenario": s.name, "error": e.message}));
                            results.lock().unwrap().push(trial::TrialResult { scenario: s.name.into(), error: Some(format!("topology: {}", e.message)), ..Default::default() });
                            topo.down();
                            continue;
                        }
                        for n in 0..*trials {
                            let r = trial::run(&topo, &s, &target, n);
                            progress(serde_json::to_value(&r).unwrap());
                            results.lock().unwrap().push(r);
                        }
                        topo.down();
                    });
                }
            });
            let results = results.into_inner().unwrap();
            let summary = report::write(out, label, *client, &cli.api, &scenarios, &results)?;
            Ok(summary)
        }
    }
}
