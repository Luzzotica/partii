//! `partii web deploy <game> <dir>`: put a folder online at
//! https://<game>.partii.games. Hashes every file, asks the platform which
//! hashes it lacks (webDeployStart), uploads only those (in parallel, straight
//! to storage when the platform signs storage URLs), then finishes the deploy
//! (webDeployFinish), which makes it live unless --no-activate. The other web
//! commands (list, activate, take-down) come from the API spec.

use crate::out::{CliError, CliResult};
use crate::Cli;
use clap::{Args, Subcommand};
use partii_api::Client;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug)]
pub enum WebCmd {
    /// Deploy a folder as the game's site (index.html at its top).
    #[command(after_help = "partii web deploy hexii ./dist\npartii web deploy tankii ./controller-dist --spa --no-activate   # preview first, then `partii web activate`")]
    Deploy(DeployArgs),
}

#[derive(Args, Debug)]
pub struct DeployArgs {
    /// The game id (the site is <game>.partii.games).
    game: String,
    /// The folder to deploy.
    dir: PathBuf,
    /// Unknown paths serve the nearest index.html (client-side routing).
    #[arg(long)]
    spa: bool,
    /// Cross-origin isolation headers (threaded wasm: Godot, Unity, Emscripten pthreads).
    #[arg(long)]
    isolated: bool,
    /// Upload but don't make it live; preview it at the preview_url, then `partii web activate`.
    #[arg(long)]
    no_activate: bool,
    /// A note shown in `partii web list`.
    #[arg(long, default_value = "")]
    note: String,
    /// Parallel uploads.
    #[arg(long, default_value_t = 8)]
    jobs: usize,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Every file under `dir`, as (site path, file path); skips dotfiles and dot-folders.
fn walk(dir: &Path) -> Result<Vec<(String, PathBuf)>, CliError> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let rd = std::fs::read_dir(&d).map_err(|e| CliError::new("read", format!("{}: {e}", d.display()), "check the folder path"))?;
        for entry in rd {
            let entry = entry.map_err(|e| CliError::new("read", e.to_string(), ""))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let p = entry.path();
            let ft = entry.file_type().map_err(|e| CliError::new("read", e.to_string(), ""))?;
            if ft.is_dir() {
                stack.push(p);
            } else if ft.is_file() || ft.is_symlink() && p.is_file() {
                let rel = p.strip_prefix(dir).unwrap().components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
                out.push((rel, p));
            }
        }
    }
    out.sort();
    Ok(out)
}

fn put(up: &Value, bytes: &[u8]) -> Result<(), String> {
    let url = up["url"].as_str().ok_or("no upload url")?;
    let mut req = ureq::put(url);
    if let Some(h) = up["headers"].as_object() {
        for (k, v) in h {
            if let Some(v) = v.as_str() {
                req = req.header(k, v);
            }
        }
    }
    let res = req.config().http_status_as_error(false).build().send(bytes).map_err(|e| format!("upload failed: {e}"))?;
    let status = res.status().as_u16();
    if status >= 300 {
        let detail = res.into_body().read_to_string().unwrap_or_default();
        return Err(format!("upload refused (HTTP {status}): {}", detail.chars().take(200).collect::<String>()));
    }
    Ok(())
}

fn api_err(v: &Value) -> CliError {
    CliError::new("platform", v["error"]["message"].as_str().unwrap_or("request failed").to_string(), v["error"]["hint"].as_str().unwrap_or("").to_string())
}

pub fn run(cli: &Cli, cmd: &WebCmd) -> CliResult {
    let WebCmd::Deploy(a) = cmd;
    let client = Client { base: cli.api.clone(), developer_token: cli.token.clone(), admin_token: None, key: None, player_token: None };
    if !a.dir.join("index.html").is_file() {
        return Err(CliError::usage(format!("{} has no index.html at its top", a.dir.display()), "deploy the build output folder (the one with index.html)"));
    }
    // Hash everything.
    let list = walk(&a.dir)?;
    let mut files = Map::new();
    let mut by_sha: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut total = 0u64;
    for (rel, p) in &list {
        let bytes = std::fs::read(p).map_err(|e| CliError::new("read", format!("{}: {e}", p.display()), ""))?;
        let sha = hex(&crate::dev::sha256(&bytes));
        total += bytes.len() as u64;
        files.insert(rel.clone(), json!({ "sha256": sha, "size": bytes.len() }));
        by_sha.entry(sha).or_insert_with(|| p.clone());
    }
    let mut body = json!({ "files": files, "spa": a.spa, "isolated": a.isolated, "note": a.note });
    if cli.dry_run {
        body["dry_run"] = json!(true);
        return Ok(json!({ "dry_run": true, "game": a.game, "files": list.len(), "bytes": total, "spa": a.spa, "isolated": a.isolated }));
    }
    let start = client.json("webDeployStart", &[("game", a.game.as_str())], Some(body)).map_err(|e| CliError::new("network", e.message, e.hint))?;
    if start["ok"] != true {
        return Err(api_err(&start));
    }
    let id = start["deploy"]["id"].as_str().unwrap_or_default().to_string();
    let missing: Vec<String> = start["missing"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
    // Upload what's missing, a batch of URLs at a time, in parallel.
    let mut uploaded_bytes = 0u64;
    for chunk in missing.chunks(100) {
        let ups = client.json("webDeployUploads", &[("game", a.game.as_str()), ("deploy", id.as_str())], Some(json!({ "sha256": chunk }))).map_err(|e| CliError::new("network", e.message, e.hint))?;
        if ups["ok"] != true {
            return Err(api_err(&ups));
        }
        let ups: Vec<Value> = ups["uploads"].as_array().cloned().unwrap_or_default();
        let jobs = a.jobs.clamp(1, 32);
        let results: Vec<Result<u64, String>> = std::thread::scope(|s| {
            let handles: Vec<_> = ups
                .chunks(ups.len().div_ceil(jobs).max(1))
                .map(|part| {
                    let by_sha = &by_sha;
                    s.spawn(move || {
                        let mut n = 0u64;
                        for up in part {
                            let sha = up["sha256"].as_str().unwrap_or_default();
                            let path = by_sha.get(sha).ok_or_else(|| format!("no local file for {sha}"))?;
                            let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
                            put(up, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
                            n += bytes.len() as u64;
                        }
                        Ok(n)
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("upload thread panicked".into()))).collect()
        });
        for r in results {
            uploaded_bytes += r.map_err(|e| CliError::new("upload", e, "run the deploy again; files already uploaded are skipped"))?;
        }
    }
    // Finish: the platform checks the uploads a batch per call.
    let activate = !a.no_activate;
    loop {
        let fin = client.json("webDeployFinish", &[("game", a.game.as_str()), ("deploy", id.as_str())], Some(json!({ "activate": activate }))).map_err(|e| CliError::new("network", e.message, e.hint))?;
        if fin["ok"] != true {
            return Err(api_err(&fin));
        }
        if fin["done"] == true {
            return Ok(json!({
                "deploy": id,
                "live": activate,
                "url": fin["url"],
                "preview_url": fin["deploy"]["preview_url"],
                "files": list.len(),
                "bytes": total,
                "uploaded": missing.len(),
                "uploaded_bytes": uploaded_bytes,
            }));
        }
        if let Some(n) = fin["not_uploaded"].as_array() {
            return Err(CliError::new("upload", format!("{} file(s) never reached storage", n.len()), "run the deploy again"));
        }
    }
}
