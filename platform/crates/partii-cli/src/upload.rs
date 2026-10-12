//! `partii builds upload`, direct to storage: ask the platform for a signed
//! URL (buildsUploadStart), PUT the file to R2 with its sha256 (storage
//! rejects bytes that don't match), then record the build
//! (buildsUploadFinish). No request-size cap. Platforms without direct
//! uploads (local `partii dev`) answer `direct_upload_unavailable`, and the
//! caller falls back to uploading through the API.

use partii_api::Client;
use serde_json::{json, Value};

pub enum Outcome {
    /// The final reply (a build, or a platform error) to print.
    Done(Value),
    /// No direct uploads here: upload through the API instead.
    Fallback,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn direct(client: &Client, game: &str, query: &std::collections::BTreeMap<String, String>, bytes: &[u8]) -> Result<Outcome, String> {
    let sha = hex(&crate::dev::sha256(bytes));
    let mut body = json!({ "size": bytes.len(), "sha256": sha });
    for k in ["platform", "version", "channel", "filename"] {
        if let Some(v) = query.get(k) {
            body[k] = json!(v);
        }
    }
    let start = client.json("buildsUploadStart", &[("game", game)], Some(body.clone())).map_err(|e| e.message)?;
    if start["error"]["code"] == "direct_upload_unavailable" || start["error"]["code"] == "not_found" && start["error"]["message"].as_str().is_some_and(|m| m.contains("route")) {
        return Ok(Outcome::Fallback);
    }
    if start["ok"] != true {
        return Ok(Outcome::Done(start));
    }
    let up = &start["upload"];
    let (Some(id), Some(url)) = (up["id"].as_str(), up["url"].as_str()) else {
        return Err("buildsUploadStart returned no upload url".into());
    };
    let mut req = ureq::put(url);
    if let Some(h) = up["headers"].as_object() {
        for (k, v) in h {
            if let Some(v) = v.as_str() {
                req = req.header(k, v);
            }
        }
    }
    let res = req.config().http_status_as_error(false).build().send(bytes).map_err(|e| format!("upload to storage failed: {e}"))?;
    let status = res.status().as_u16();
    if status >= 300 {
        let detail = res.into_body().read_to_string().unwrap_or_default();
        return Err(format!("storage refused the upload (HTTP {status}): {}", detail.chars().take(300).collect::<String>()));
    }
    let fin = client.json("buildsUploadFinish", &[("game", game), ("upload", id)], Some(body)).map_err(|e| e.message)?;
    let mut fin = fin;
    if fin["ok"] == true {
        fin["direct"] = json!(true);
    }
    Ok(Outcome::Done(fin))
}

#[cfg(test)]
mod tests {
    #[test]
    fn hex_matches_the_platform() {
        assert_eq!(super::hex(&crate::dev::sha256(b"abc"))[..16], *"ba7816bf8f01cfea");
    }
}
