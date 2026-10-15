//! `partii login`: sign up or sign in as a developer with an email code, in
//! two non-interactive steps an agent can run:
//!   partii login --email you@example.com            → emails a 6-digit code
//!   partii login --email you@example.com --code 123456  → saves the token
//! New emails become new developers. `partii logout` revokes the saved token
//! and forgets it.

use crate::config;
use crate::out::{CliError, CliResult};
use crate::Cli;
use clap::Args;
use partii_api::Client;
use serde_json::{json, Value};

#[derive(Args, Debug)]
pub struct LoginArgs {
    /// Your email (new emails sign up).
    #[arg(long)]
    email: String,
    /// The 6-digit code from the email (leave out to have one sent).
    #[arg(long)]
    code: Option<String>,
    /// Your name or studio's (new developers).
    #[arg(long)]
    name: Option<String>,
    /// Also print the token (to put in a CI secret); it's saved either way.
    #[arg(long)]
    print_token: bool,
}

fn client(cli: &Cli, token: Option<String>) -> Client {
    Client { base: cli.api.clone(), developer_token: token, admin_token: None, key: None, player_token: None }
}

/// The API's own error, as the CLI's.
fn api(v: Result<Value, partii_api::CallError>) -> CliResult {
    let v = v.map_err(|e| CliError::new("network", e.message, if e.hint.is_empty() { "is --api right? (default https://api.partii.games)".into() } else { e.hint }))?;
    if v["ok"] == json!(false) {
        let e = &v["error"];
        let code: &'static str = match e["code"].as_str() {
            Some("bad_code") => "bad_code",
            Some("code_expired") => "code_expired",
            Some("rate_limited") => "rate_limited",
            Some("bad_request") => "bad_request",
            _ => "api",
        };
        return Err(CliError::new(code, e["message"].as_str().unwrap_or("failed").to_string(), e["hint"].as_str().unwrap_or("").to_string()));
    }
    Ok(v)
}

pub fn login(cli: &Cli, a: &LoginArgs) -> CliResult {
    let c = client(cli, None);
    let Some(code) = &a.code else {
        let r = api(c.json("developersLoginStart", &[], Some(json!({ "email": a.email }))))?;
        let mut out = json!({
            "sent": r["sent"],
            "new_developer": r["new_developer"],
            "next": format!("partii login --email {} --code <the 6-digit code from the email>", a.email),
        });
        // Staging and local platforms send no mail: the code comes back.
        if let Some(code) = r["code"].as_str() {
            out["code"] = json!(code);
            out["next"] = json!(format!("partii login --email {} --code {code}", a.email));
        }
        return Ok(out);
    };
    let mut body = json!({ "email": a.email, "code": code, "token_name": format!("cli on {}", host()) });
    if let Some(n) = &a.name {
        body["name"] = json!(n);
    }
    let r = api(c.json("developersLogin", &[], Some(body)))?;
    let token = r["token"].as_str().unwrap_or_default().to_string();
    let saved = config::save(&json!({ "api": cli.api, "token": token, "token_id": r["token_id"], "email": a.email, "developer": r["developer"]["id"] }))
        .map_err(|e| CliError::new("io", format!("couldn't save the sign-in: {e}"), "set PARTII_TOKEN yourself (use --print-token)"))?;
    let mut out = json!({
        "developer": r["developer"],
        "created": r["created"],
        "saved_to": saved.display().to_string(),
        "next": r["next"],
    });
    if a.print_token {
        out["token"] = json!(token);
    }
    Ok(out)
}

pub fn logout(cli: &Cli) -> CliResult {
    let saved = config::load();
    let mut revoked = false;
    if let (Some(t), Some(id)) = (saved["token"].as_str(), saved["token_id"].as_str()) {
        let c = Client { base: saved["api"].as_str().unwrap_or(&cli.api).to_string(), ..client(cli, Some(t.to_string())) };
        revoked = c.json("tokensRevoke", &[("token_id", id)], None).map(|v| v["revoked"] == json!(true)).unwrap_or(false);
    }
    let removed = config::remove()?;
    Ok(json!({ "revoked": revoked, "forgot": removed }))
}

fn host() -> String {
    std::env::var("HOSTNAME").or_else(|_| std::env::var("COMPUTERNAME")).unwrap_or_else(|_| "this machine".into()).chars().take(40).collect()
}
