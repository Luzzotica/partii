//! `partii`: the platform's command line. Built for agents first: one JSON
//! document per command, nothing interactive, safe to repeat, `--dry-run` on
//! mutations, the token from `PARTII_TOKEN`, and `partii help --json` for
//! the full command tree (docs/DESIGN.md, "The CLI").

mod help;
mod out;
mod torture;

use clap::{Parser, Subcommand};
use out::{CliError, CliResult};

#[derive(Parser, Debug)]
#[command(name = "partii", version, disable_help_subcommand = true, about = "The partii platform CLI. Every command prints one JSON document.")]
pub struct Cli {
    /// Platform API base URL.
    #[arg(long, global = true, env = "PARTII_API", default_value = "http://127.0.0.1:8787")]
    pub api: String,
    /// Developer token (from `partii login`).
    #[arg(long, global = true, env = "PARTII_TOKEN", hide_env_values = true)]
    pub token: Option<String>,
    /// Show what a mutation would do without doing it.
    #[arg(long, global = true)]
    pub dry_run: bool,
    /// Indent the JSON output.
    #[arg(long, global = true)]
    pub pretty: bool,
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Describe every command, argument and example (use --json).
    Help {
        /// Print the command tree as JSON (the default, kept for clarity).
        #[arg(long)]
        json: bool,
    },
    /// Network torture harness: run real clients through bad networks.
    #[command(subcommand)]
    Torture(torture::TortureCmd),
}

fn main() {
    let cli = match Cli::try_parse() {
        Ok(c) => c,
        Err(e) => {
            use clap::error::ErrorKind;
            if matches!(e.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion) {
                let _ = e.print();
                std::process::exit(0);
            }
            let msg = e.to_string().lines().next().unwrap_or("bad arguments").trim_start_matches("error: ").to_string();
            std::process::exit(out::print(Err(CliError::usage(msg, "run `partii help --json` for every command and its arguments")), false));
        }
    };
    let pretty = cli.pretty;
    let result: CliResult = match &cli.cmd {
        Cmd::Help { .. } => Ok(help::tree()),
        Cmd::Torture(c) => torture::run(&cli, c),
    };
    std::process::exit(out::print(result, pretty));
}
