//! `partii help --json`: the whole command tree, read from clap, so the
//! description can never drift from the parser.

use clap::CommandFactory;
use serde_json::{json, Value};

pub fn tree() -> Value {
    let cmd = crate::Cli::command();
    json!({
        "name": "partii",
        "contract": {
            "output": "one JSON document on stdout: {\"ok\":true,...} or {\"ok\":false,\"error\":{\"code\",\"message\",\"hint\"}}",
            "progress": "long commands write JSON lines to stderr",
            "exit": {"0": "ok", "1": "error", "2": "usage"},
            "auth": "PARTII_API (base URL); PARTII_TOKEN (developer), PARTII_KEY (publishable key), PARTII_PLAYER_TOKEN (player), PARTII_ADMIN_TOKEN (operators)",
            "api_commands": "one per API operation, generated from api/openapi.yaml: path params positional, body fields as --kebab-flags, --body for a whole JSON body",
            "mutations": "idempotent; --dry-run shows the change without making it"
        },
        "global_args": args(&cmd),
        "commands": cmd.get_subcommands().filter(|c| c.get_name() != "help").map(command).collect::<Vec<_>>(),
        "api_commands": crate::api_cmd::help_entries(),
    })
}

fn command(c: &clap::Command) -> Value {
    let subs: Vec<Value> = c.get_subcommands().filter(|s| s.get_name() != "help").map(command).collect();
    let mut v = json!({
        "name": c.get_name(),
        "about": c.get_about().map(|s| s.to_string()),
        "args": args(c),
    });
    if let Some(ex) = c.get_after_help() {
        v["examples"] = json!(ex.to_string().lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>());
    }
    if !subs.is_empty() {
        v["commands"] = json!(subs);
    }
    v
}

fn args(c: &clap::Command) -> Vec<Value> {
    c.get_arguments()
        .filter(|a| !matches!(a.get_id().as_str(), "help" | "version"))
        .filter(|a| !a.is_global_set() || c.get_name() == "partii")
        .map(|a| {
            json!({
                "name": a.get_long().map(|l| format!("--{l}")).unwrap_or_else(|| a.get_id().to_string()),
                "help": a.get_help().map(|s| s.to_string()),
                "required": a.is_required_set(),
                "default": a.get_default_values().iter().map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>(),
                "env": a.get_env().map(|e| e.to_string_lossy().to_string()),
                "values": a.get_possible_values().iter().map(|p| p.get_name().to_string()).collect::<Vec<_>>(),
            })
        })
        .collect()
}
