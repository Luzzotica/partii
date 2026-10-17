//! A command for every API operation, built from the generated operation
//! table (api/openapi.yaml): `partii games price tankii --price-cents 499`.
//! Path parameters are positional; query parameters and body fields are
//! flags (kebab-case, typed from the spec); `--body` takes a whole JSON body
//! (or `@file.json`); a string flag's `@path` reads that file (`@@` for a literal @);
//! `--file` uploads bytes; `--out` saves a download.

use crate::out::{print, CliError};
use clap::{Arg, ArgAction, ArgMatches, Command};
use partii_api::{Body, Client, Loc, Op, Reply, OPS};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Flags every API command has; a body field with one of these names is set
/// with --field or --body instead.
const RESERVED: &[&str] = &["body", "field", "file", "out", "api", "token", "key", "player-token", "admin-token", "dry-run", "pretty", "help"];

fn kebab(s: &str) -> String {
    s.replace('_', "-")
}

/// The operation whose command words start `args` (longest match wins).
pub fn find(args: &[String]) -> Option<(&'static Op, usize)> {
    let words: Vec<&str> = args.iter().take_while(|a| !a.starts_with('-')).map(String::as_str).collect();
    OPS.iter()
        .filter_map(|o| {
            let cli: Vec<&str> = o.cli?.split(' ').collect();
            (words.len() >= cli.len() && words[..cli.len()] == cli[..]).then_some((o, cli.len()))
        })
        .max_by_key(|(_, n)| *n)
}

/// For a command group that exists (`errors`) with a subcommand that doesn't (`errors update`):
/// the group's real subcommands, e.g. "errors get, errors list, errors mark".
pub fn group_commands(args: &[String]) -> Option<(String, Vec<&'static str>)> {
    let group = args.first().filter(|a| !a.starts_with('-'))?;
    let mut cmds: Vec<&str> = OPS.iter().filter_map(|o| o.cli).filter(|c| c.split(' ').next() == Some(group.as_str())).collect();
    cmds.sort_unstable();
    cmds.dedup();
    (!cmds.is_empty()).then(|| (group.clone(), cmds))
}

fn globals(c: Command) -> Command {
    c.arg(Arg::new("api").long("api").env("PARTII_API").default_value(crate::config::DEFAULT_API).help("Platform API base URL."))
        .arg(Arg::new("token").long("token").env("PARTII_TOKEN").hide_env_values(true).help("Developer token (saved by `partii login`)."))
        .arg(Arg::new("key").long("key").env("PARTII_KEY").hide_env_values(true).help("Publishable key (games and players)."))
        .arg(Arg::new("player-token").long("player-token").env("PARTII_PLAYER_TOKEN").hide_env_values(true).help("Player token."))
        .arg(Arg::new("admin-token").long("admin-token").env("PARTII_ADMIN_TOKEN").hide_env_values(true).help("Platform admin token."))
        .arg(Arg::new("dry-run").long("dry-run").action(ArgAction::SetTrue).help("Show the change without making it."))
        .arg(Arg::new("pretty").long("pretty").action(ArgAction::SetTrue).help("Indent the JSON output."))
}

pub fn command(op: &Op) -> Command {
    let name = op.cli.unwrap_or(op.id).to_string();
    let mut c = Command::new(name).about(op.summary).no_binary_name(true);
    for p in op.params.iter().filter(|p| p.loc == Loc::Path) {
        c = c.arg(Arg::new(p.name).required(true).help(format!("{} (path)", p.name)));
    }
    for p in op.params.iter().filter(|p| p.loc == Loc::Query) {
        c = c.arg(Arg::new(p.name).long(kebab(p.name)).required(p.required).help(format!("{} (query)", p.name)));
    }
    match op.body {
        Body::Json => {
            c = c.arg(Arg::new("body").long("body").help("The whole JSON body, or @path/to/file.json"));
            c = c.arg(Arg::new("field").long("field").action(ArgAction::Append).value_name("KEY=VALUE").help("One body field (repeatable); JSON values are parsed"));
            for f in op.fields {
                if op.params.iter().any(|p| p.name == f.name) || RESERVED.contains(&kebab(f.name).as_str()) {
                    continue;
                }
                c = c.arg(Arg::new(format!("f:{}", f.name)).long(kebab(f.name)).help(format!("body field {} ({}){}", f.name, f.ty, if f.required { ", required" } else { "" })));
            }
        }
        Body::Binary => c = c.arg(Arg::new("file").long("file").required(true).help("The file to upload")),
        Body::None => {}
    }
    if op.binary_response {
        c = c.arg(Arg::new("out").long("out").help("Where to save the download (default: the server's filename)"));
    }
    globals(c)
}

/// A field value of `-` is read from stdin (secrets stay out of shell history and process lists).
fn stdin_or(v: &str) -> Result<String, String> {
    if v != "-" {
        return Ok(v.to_string());
    }
    let mut s = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).map_err(|e| format!("reading stdin: {e}"))?;
    Ok(s.trim_end_matches(['\r', '\n']).to_string())
}

fn typed(ty: &str, v: &str) -> Result<Value, String> {
    let v = &stdin_or(v)?;
    match ty {
        "integer" => v.parse::<i64>().map(Value::from).map_err(|_| format!("{v} is not a whole number")),
        "number" => v.parse::<f64>().map(Value::from).map_err(|_| format!("{v} is not a number")),
        "boolean" => v.parse::<bool>().map(Value::from).map_err(|_| format!("{v} is not true/false")),
        // `@path` reads a file (notes, descriptions); `@@…` is a literal leading @.
        "string" => match (v.strip_prefix("@@"), v.strip_prefix('@')) {
            (Some(rest), _) => Ok(Value::String(format!("@{rest}"))),
            (None, Some(path)) => std::fs::read_to_string(path).map(Value::String).map_err(|e| format!("reading {path}: {e}")),
            _ => Ok(Value::String(v.to_string())),
        },
        _ => Ok(serde_json::from_str(v).unwrap_or_else(|_| Value::String(v.to_string()))),
    }
}

fn body(op: &Op, m: &ArgMatches) -> Result<Option<Value>, CliError> {
    if op.body != Body::Json {
        return Ok(None);
    }
    let mut obj = match m.try_get_one::<String>("body").ok().flatten() {
        Some(d) => {
            let text = match d.strip_prefix('@') {
                Some(path) => std::fs::read_to_string(path)?,
                None => d.clone(),
            };
            match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(o)) => o,
                _ => return Err(CliError::usage("--body must be a JSON object", "e.g. --body '{\"title\":\"Tankii\"}'")),
            }
        }
        None => Map::new(),
    };
    for kv in m.try_get_many::<String>("field").ok().flatten().into_iter().flatten() {
        let (k, v) = kv.split_once('=').ok_or_else(|| CliError::usage(format!("--field {kv} is not KEY=VALUE"), "e.g. --field price_cents=499"))?;
        let ty = op.fields.iter().find(|f| f.name == k).map(|f| f.ty).unwrap_or("any");
        obj.insert(k.to_string(), typed(ty, v).map_err(|e| CliError::usage(e, format!("{k} is {ty}")))?);
    }
    for f in op.fields {
        if let Some(v) = m.try_get_one::<String>(&format!("f:{}", f.name)).ok().flatten() {
            obj.insert(f.name.to_string(), typed(f.ty, v).map_err(|e| CliError::usage(e, format!("--{} is {}", kebab(f.name), f.ty)))?);
        }
    }
    for f in op.fields.iter().filter(|f| f.required) {
        if !obj.contains_key(f.name) {
            return Err(CliError::usage(format!("{} needs {}", op.cli.unwrap_or(op.id), f.name), format!("pass --{}", kebab(f.name))));
        }
    }
    Ok(Some(Value::Object(obj)))
}

/// Run the operation `op`; `rest` is everything after its command words.
pub fn run(op: &Op, rest: &[String]) -> i32 {
    let m = match command(op).try_get_matches_from(rest) {
        Ok(m) => m,
        Err(e) => {
            use clap::error::ErrorKind;
            if matches!(e.kind(), ErrorKind::DisplayHelp) {
                let _ = e.print();
                return 0;
            }
            let msg = e.to_string().lines().next().unwrap_or("bad arguments").trim_start_matches("error: ").to_string();
            return print(Err(CliError::usage(msg, format!("`partii {} --help` lists its arguments", op.cli.unwrap_or(op.id)))), false);
        }
    };
    let pretty = m.get_flag("pretty");
    let client = Client {
        base: m.get_one::<String>("api").cloned().unwrap_or_default(),
        developer_token: m.get_one::<String>("token").cloned(),
        admin_token: m.get_one::<String>("admin-token").cloned(),
        key: m.get_one::<String>("key").cloned(),
        player_token: m.get_one::<String>("player-token").cloned(),
    };
    let mut args = BTreeMap::new();
    for p in op.params {
        if let Some(v) = m.get_one::<String>(p.name) {
            args.insert(p.name.to_string(), v.clone());
        }
    }
    let body = match body(op, &m) {
        Ok(b) => b,
        Err(e) => return print(Err(e), pretty),
    };
    let raw = match m.try_get_one::<String>("file").ok().flatten() {
        Some(path) => match std::fs::read(path) {
            Ok(b) => Some(b),
            Err(e) => return print(Err(CliError::new("io", format!("{path}: {e}"), "check the path")), pretty),
        },
        None => None,
    };
    // A build's download name keeps the file's extension (`.zip`, `.apk`)
    // unless --filename says otherwise.
    if op.id == "buildsUpload" && !args.contains_key("filename") {
        if let Some(name) = default_build_filename(&args, m.try_get_one::<String>("file").ok().flatten().map(String::as_str)) {
            args.insert("filename".into(), name);
        }
    }
    // Builds go straight to storage when the platform supports it.
    if op.id == "buildsUpload" && !m.get_flag("dry-run") {
        if let (Some(bytes), Some(game)) = (raw.as_deref(), args.get("game")) {
            match crate::upload::direct(&client, game, &args, bytes) {
                Ok(crate::upload::Outcome::Done(v)) => {
                    let ok = v.get("ok").and_then(Value::as_bool).unwrap_or(false);
                    let s = if pretty { serde_json::to_string_pretty(&v) } else { serde_json::to_string(&v) };
                    println!("{}", s.unwrap_or_default());
                    return if ok { 0 } else { 1 };
                }
                Ok(crate::upload::Outcome::Fallback) => {}
                Err(e) => return print(Err(CliError::new("upload", e, "try again; the build was not recorded")), pretty),
            }
        }
    }
    match client.call(op, &args, body.as_ref(), raw, m.get_flag("dry-run")) {
        Err(e) => print(Err(CliError { code: e.code, message: e.message, hint: e.hint, exit: if e.code == "usage" { 2 } else { 1 } }), pretty),
        Ok(Reply::Json { body, .. }) => {
            let ok = body.get("ok").and_then(Value::as_bool).unwrap_or(false);
            let s = if pretty { serde_json::to_string_pretty(&body) } else { serde_json::to_string(&body) };
            println!("{}", s.unwrap_or_default());
            if ok { 0 } else { 1 }
        }
        Ok(Reply::Bytes { status, bytes }) => {
            if status >= 400 {
                return print(Err(CliError::new("http", format!("status {status}"), "")), pretty);
            }
            let out = m.try_get_one::<String>("out").ok().flatten().cloned().unwrap_or_else(|| format!("{}.bin", op.id));
            match std::fs::write(&out, &bytes) {
                Ok(()) => print(Ok(json!({"saved": out, "bytes": bytes.len()})), pretty),
                Err(e) => print(Err(CliError::new("io", format!("{out}: {e}"), "check the path")), pretty),
            }
        }
    }
}

/// The API commands for `partii help --json`.
pub fn help_entries() -> Vec<Value> {
    OPS.iter()
        .filter(|o| o.cli.is_some())
        .map(|o| {
            let c = command(o);
            json!({
                "command": o.cli,
                "about": o.summary,
                "auth": format!("{:?}", o.auth).to_lowercase(),
                "operation": o.id,
                "http": format!("{} {}", o.method, o.path),
                "args": c.get_arguments()
                    .filter(|a| !["api", "token", "key", "player-token", "admin-token", "dry-run", "pretty", "help"].contains(&a.get_id().as_str()))
                    .map(|a| json!({
                        "name": a.get_long().map(|l| format!("--{l}")).unwrap_or_else(|| a.get_id().to_string()),
                        "help": a.get_help().map(|h| h.to_string()),
                        "required": a.is_required_set(),
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn finds_the_longest_matching_command() {
        let (op, n) = find(&s(&["games", "sale-end", "tankii"])).unwrap();
        assert_eq!((op.id, n), ("gamesSaleEnd", 2));
        assert_eq!(find(&s(&["test", "players", "create"])).unwrap().0.id, "testPlayersCreate");
        assert!(find(&s(&["torture", "run"])).is_none());
    }

    #[test]
    fn builds_typed_bodies_from_flags_fields_and_data() {
        let op = partii_api::op("gamesPut").unwrap();
        let m = command(op).try_get_matches_from(s(&["tankii", "--price-cents", "499", "--field", "demo={\"free_levels\":20}", "--body", "{\"title\":\"T\"}"])).unwrap();
        let b = body(op, &m).unwrap().unwrap();
        assert_eq!(b, json!({"title": "T", "price_cents": 499, "demo": {"free_levels": 20}}));
        let bad = command(op).try_get_matches_from(s(&["tankii", "--price-cents", "4.99"])).unwrap();
        assert_eq!(body(op, &bad).unwrap_err().code, "usage");
    }

    #[test]
    fn required_fields_are_checked_locally() {
        let op = partii_api::op("gamesPrice").unwrap();
        let m = command(op).try_get_matches_from(s(&["tankii"])).unwrap();
        let e = body(op, &m).unwrap_err();
        assert!(e.hint.contains("--price-cents"));
    }

    #[test]
    fn every_operation_command_builds() {
        for op in OPS {
            command(op).debug_assert();
        }
    }
}

/// `<game>-<version>-<platform>.<ext of the file>`; None without an extension.
fn default_build_filename(args: &BTreeMap<String, String>, file: Option<&str>) -> Option<String> {
    let ext = std::path::Path::new(file?).extension()?.to_str()?.to_ascii_lowercase();
    let (game, version, platform) = (args.get("game")?, args.get("version")?, args.get("platform")?);
    let name = format!("{game}-{version}-{platform}.{ext}");
    name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b)).then_some(name)
}

#[cfg(test)]
mod filename_tests {
    use super::*;

    #[test]
    fn build_filename_keeps_the_extension() {
        let args: BTreeMap<String, String> = [("game", "tankii"), ("version", "0.4.54"), ("platform", "macos")].into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(default_build_filename(&args, Some("/x/Tankii-macos.ZIP")).as_deref(), Some("tankii-0.4.54-macos.zip"));
        assert_eq!(default_build_filename(&args, Some("/x/tankii")), None);
        assert_eq!(default_build_filename(&args, None), None);
    }
}
