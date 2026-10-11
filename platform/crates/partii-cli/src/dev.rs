//! `partii dev`: the whole platform on this machine, with one command.
//! Runs the edge Worker under `wrangler dev` (local Durable Objects, D1, R2),
//! and prints the URL and a dev key once it answers. Fake stores, fake
//! logins and a local TURN (for `--turn`) come with it.

use crate::out::{CliError, CliResult};
use crate::Cli;
use clap::{Args, Subcommand};
use serde_json::json;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The local edge signs keys with this secret (never used outside dev).
pub const DEV_KEY_SECRET: &str = "dev-only-key-secret";

#[derive(Subcommand, Debug)]
pub enum DevCmd {
    /// Run the platform locally (blocks; prints one JSON line when ready).
    #[command(after_help = "partii dev up\npartii dev up --port 443 --turn 10.200.0.5")]
    Up(UpArgs),
    /// A publishable key for the local platform.
    #[command(after_help = "partii dev key --project demo")]
    Key {
        #[arg(long, default_value = "demo")]
        project: String,
        #[arg(long, default_value = "k1")]
        key_id: String,
        /// Sign with this secret instead of the local one (staging bootstrap).
        #[arg(long, env = "PARTII_KEY_SECRET", hide_env_values = true)]
        secret: Option<String>,
    },
}

#[derive(Args, Debug)]
pub struct UpArgs {
    #[arg(long, default_value_t = 8787)]
    port: u16,
    /// Listen on every interface (so containers and phones can reach it).
    #[arg(long)]
    public: bool,
    /// Use a coturn at this address for relay credentials (torture runs).
    #[arg(long)]
    turn: Option<String>,
    /// The platform/ directory.
    #[arg(long, default_value = ".")]
    platform_dir: PathBuf,
}

pub fn run(_cli: &Cli, cmd: &DevCmd) -> CliResult {
    match cmd {
        DevCmd::Key { project, key_id, secret } => {
            Ok(json!({"key": sign_key(secret.as_deref().unwrap_or(DEV_KEY_SECRET), project, key_id)?, "project": project}))
        }
        DevCmd::Up(a) => up(a),
    }
}

fn up(a: &UpArgs) -> CliResult {
    let edge = a.platform_dir.join("edge");
    if !edge.join("wrangler.jsonc").exists() {
        return Err(CliError::usage("no edge/ here", "run from platform/ or pass --platform-dir"));
    }
    // The local database follows the schema (idempotent).
    let migrate = Command::new("npx")
        .args(["wrangler", "d1", "migrations", "apply", "partii-dev", "--local"])
        .current_dir(&edge)
        .env("CI", "1")
        .output()
        .map_err(|e| CliError::new("spawn", format!("npx wrangler: {e}"), "install Node.js and run `npm install` in platform/edge"))?;
    if !migrate.status.success() {
        return Err(CliError::new("migrate", String::from_utf8_lossy(&migrate.stderr).trim().to_string(), "see platform/edge/migrations"));
    }
    let mut args: Vec<String> = vec!["wrangler".into(), "dev".into(), "--port".into(), a.port.to_string()];
    if a.public || a.turn.is_some() {
        args.extend(["--ip".into(), "0.0.0.0".into()]);
    }
    if let Some(t) = &a.turn {
        for v in [
            "TURN_MODE:static".to_string(),
            format!("TURN_STATIC_URLS:stun:{t}:3478,turn:{t}:3478?transport=udp,turn:{t}:3478?transport=tcp"),
            "TURN_STATIC_USERNAME:partii".into(),
            "TURN_STATIC_CREDENTIAL:partii".into(),
        ] {
            args.extend(["--var".into(), v]);
        }
    }
    let mut child = Command::new("npx")
        .args(&args)
        .current_dir(&edge)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| CliError::new("spawn", format!("npx wrangler: {e}"), "install Node.js and run `npm install` in platform/edge"))?;
    let url = format!("http://127.0.0.1:{}", a.port);
    let t0 = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(CliError::new("edge_exited", format!("wrangler exited: {status}"), "is the port free? see the wrangler output above"));
        }
        if health(&url) {
            break;
        }
        if t0.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            return Err(CliError::new("edge_timeout", "the local edge did not answer within 60 s", "see the wrangler output above"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    println!("{}", json!({"ok": true, "ready": true, "api": url, "key": sign_key(DEV_KEY_SECRET, "demo", "k1")?, "ready_ms": t0.elapsed().as_millis() as u64}));
    let status = child.wait()?;
    Ok(json!({"stopped": true, "status": status.code()}))
}

fn health(url: &str) -> bool {
    use std::io::{Read, Write};
    let addr = url.trim_start_matches("http://");
    let Ok(mut s) = std::net::TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(300)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
    if s.write_all(format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.contains("\"ok\":true")
}

/// Same scheme as edge/src/keys.ts: `pk_<project>_<keyid>_<sig>`, sig =
/// first 22 chars of base64url(HMAC-SHA256(secret, "pk:<project>:<keyid>")).
pub fn sign_key(secret: &str, project: &str, key_id: &str) -> Result<String, CliError> {
    let ok = |s: &str| !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    if !ok(project) || !ok(key_id) {
        return Err(CliError::usage("project and key id must be [a-z0-9]{1,32}", "pick lowercase letters and digits"));
    }
    let mac = hmac_sha256(secret.as_bytes(), format!("pk:{project}:{key_id}").as_bytes());
    Ok(format!("pk_{project}_{key_id}_{}", &b64url(&mac)[..22]))
}

fn b64url(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut s = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..(c.len() + 1) {
            s.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    s
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&sha256(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Vec::with_capacity(64 + msg.len());
    inner.extend(k.iter().map(|b| b ^ 0x36));
    inner.extend_from_slice(msg);
    let mut outer = Vec::with_capacity(96);
    outer.extend(k.iter().map(|b| b ^ 0x5c));
    outer.extend_from_slice(&sha256(&inner));
    sha256(&outer)
}

/// A small SHA-256 (keeps the CLI free of a crypto dependency for one HMAC).
fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut m = data.to_vec();
    let bits = (data.len() as u64) * 8;
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&bits.to_be_bytes());
    for chunk in m.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    let mut out = [0u8; 32];
    for i in 0..8 {
        out[i * 4..i * 4 + 4].copy_from_slice(&h[i].to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_answers() {
        let hex = |b: [u8; 32]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(hex(sha256(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(hex(sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        // RFC 4231 case 2.
        assert_eq!(hex(hmac_sha256(b"Jefe", b"what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn keys_match_the_edge_format() {
        let k = sign_key("s3cret", "tankii", "abc123").unwrap();
        assert!(k.starts_with("pk_tankii_abc123_"));
        assert_eq!(k.len(), "pk_tankii_abc123_".len() + 22);
        assert!(sign_key("s", "Bad", "k").is_err());
    }
}
