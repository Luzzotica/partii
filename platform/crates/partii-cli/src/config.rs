//! Saved sign-in: `partii login` writes the API and the developer token to
//! ~/.config/partii/cli.json (%APPDATA%\partii\cli.json on Windows; mode 600),
//! and every command reads them when PARTII_API / PARTII_TOKEN aren't set.
//! The environment always wins, so CI and other machines need no file.

use serde_json::{json, Value};
use std::path::PathBuf;

/// Production, for everyone who installed the CLI. Local platforms pass --api.
pub const DEFAULT_API: &str = "https://api.partii.games";

pub fn path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("PARTII_CONFIG") {
        return Some(PathBuf::from(p));
    }
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("partii").join("cli.json"))
    } else {
        let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
        Some(base.join("partii").join("cli.json"))
    }
}

pub fn load() -> Value {
    path().and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}))
}

pub fn save(v: &Value) -> std::io::Result<PathBuf> {
    let p = path().ok_or_else(|| std::io::Error::other("no home folder for the config (set PARTII_CONFIG)"))?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).expect("json"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, &p)?;
    Ok(p)
}

pub fn remove() -> std::io::Result<bool> {
    match path() {
        Some(p) if p.exists() => std::fs::remove_file(p).map(|_| true),
        _ => Ok(false),
    }
}

/// Before parsing: fill PARTII_API and PARTII_TOKEN from the saved sign-in
/// (only when unset), and default the API to production.
pub fn apply() {
    let c = load();
    let api_set = std::env::var_os("PARTII_API").is_some();
    if !api_set {
        let api = c["api"].as_str().unwrap_or(DEFAULT_API).to_string();
        std::env::set_var("PARTII_API", &api);
    }
    // A saved token belongs to the saved API: don't send it to another one.
    let same_api = !api_set || std::env::var("PARTII_API").ok().as_deref() == c["api"].as_str();
    if std::env::var_os("PARTII_TOKEN").is_none() && same_api {
        if let Some(t) = c["token"].as_str() {
            std::env::set_var("PARTII_TOKEN", t);
        }
    }
}
