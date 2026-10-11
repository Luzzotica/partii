//! The CLI's output contract: every command prints exactly one JSON document
//! on stdout. Success is `{"ok":true, ...}`; failure is
//! `{"ok":false,"error":{"code","message","hint"}}` with a non-zero exit.
//! Progress for long commands goes to stderr as JSON lines, never stdout.

use serde_json::{json, Map, Value};

/// A failure the caller can act on: a stable `code`, a message, and a hint
/// that says what to do next.
#[derive(Debug, Clone)]
pub struct CliError {
    pub code: &'static str,
    pub message: String,
    pub hint: String,
    pub exit: i32,
}

impl CliError {
    pub fn new(code: &'static str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self { code, message: message.into(), hint: hint.into(), exit: 1 }
    }
    pub fn usage(message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self { exit: 2, ..Self::new("usage", message, hint) }
    }
}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError::new("io", e.to_string(), "check the path and permissions")
    }
}

pub type CliResult = Result<Value, CliError>;

/// Merge `ok:true` into a command's result object.
pub fn ok(v: Value) -> Value {
    let mut m = match v {
        Value::Object(m) => m,
        other => {
            let mut m = Map::new();
            m.insert("result".into(), other);
            m
        }
    };
    m.insert("ok".into(), Value::Bool(true));
    Value::Object(m)
}

pub fn print(result: CliResult, pretty: bool) -> i32 {
    let (doc, code) = match result {
        Ok(v) => (ok(v), 0),
        Err(e) => (json!({"ok": false, "error": {"code": e.code, "message": e.message, "hint": e.hint}}), e.exit),
    };
    let s = if pretty { serde_json::to_string_pretty(&doc) } else { serde_json::to_string(&doc) };
    println!("{}", s.expect("json"));
    code
}

/// A progress line on stderr (JSON), for long-running commands.
pub fn progress(v: Value) {
    eprintln!("{v}");
}
