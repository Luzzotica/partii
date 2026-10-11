//! Torture reports: raw trials as JSON lines plus a Markdown summary per
//! scenario (success rate, rungs, phase timings, recovery).

use super::scenario::Scenario;
use super::trial::{Client, TrialResult};
use crate::out::CliError;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;

fn pct(mut v: Vec<f64>, p: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    Some(v[((v.len() as f64 - 1.0) * p).round() as usize])
}

fn fmt_ms(v: Option<f64>) -> String {
    v.map(|x| format!("{x:.0}")).unwrap_or_else(|| "–".into())
}

pub fn summarize(results: &[TrialResult], name: &str) -> Value {
    let rs: Vec<&TrialResult> = results.iter().filter(|r| r.scenario == name).collect();
    let n = rs.len();
    let ok = rs.iter().filter(|r| r.connected).count();
    let mut rungs: BTreeMap<String, usize> = BTreeMap::new();
    let mut settled: BTreeMap<String, usize> = BTreeMap::new();
    for r in rs.iter().filter(|r| r.connected) {
        *rungs.entry(r.rung.clone().unwrap_or_else(|| "unknown".into())).or_default() += 1;
        *settled.entry(r.settled.clone().or(r.rung.clone()).unwrap_or_else(|| "unknown".into())).or_default() += 1;
    }
    let col = |f: &dyn Fn(&TrialResult) -> Option<f64>| rs.iter().filter_map(|r| f(r)).collect::<Vec<f64>>();
    let create = col(&|r| r.create_ms.map(|x| x as f64));
    let join = col(&|r| r.join_ms.map(|x| x as f64));
    let connect = col(&|r| r.connect_ms.map(|x| x as f64));
    let rtt = col(&|r| r.rtt_p50);
    let gap = col(&|r| r.longest_gap_ms.map(|x| x as f64));
    let rec: Vec<bool> = rs.iter().filter_map(|r| r.recovered).collect();
    let mut errors: BTreeMap<String, usize> = BTreeMap::new();
    for r in rs.iter().filter(|r| !r.connected || r.error.is_some()) {
        *errors.entry(r.error.clone().unwrap_or_else(|| "no echo".into())).or_default() += 1;
    }
    json!({
        "scenario": name,
        "trials": n,
        "connected": ok,
        "success_rate": if n > 0 { ok as f64 / n as f64 } else { 0.0 },
        "rungs": rungs,
        "settled": settled,
        "create_ms": {"p50": pct(create.clone(), 0.5), "p95": pct(create, 0.95)},
        "join_ms": {"p50": pct(join.clone(), 0.5), "p95": pct(join, 0.95)},
        "connect_ms": {"p50": pct(connect.clone(), 0.5), "p95": pct(connect, 0.95)},
        "rtt_ms_p50": pct(rtt, 0.5),
        "longest_gap_ms_p95": pct(gap, 0.95),
        "recovered": if rec.is_empty() { Value::Null } else { json!({"yes": rec.iter().filter(|x| **x).count(), "of": rec.len()}) },
        "errors": errors,
    })
}

pub fn write(dir: &Path, label: &str, client: Client, api: &str, scenarios: &[Scenario], results: &[TrialResult]) -> Result<Value, CliError> {
    std::fs::create_dir_all(dir.join("raw"))?;
    let mut raw = String::new();
    for r in results {
        raw.push_str(&serde_json::to_string(r).unwrap());
        raw.push('\n');
    }
    let raw_path = dir.join("raw").join(format!("{label}.jsonl"));
    std::fs::write(&raw_path, raw)?;

    let sums: Vec<Value> = scenarios.iter().map(|s| summarize(results, s.name)).collect();
    let total = results.len();
    let ok = results.iter().filter(|r| r.connected).count();
    let mut md = String::new();
    let _ = writeln!(md, "# Torture report: {label}\n");
    let _ = writeln!(md, "- Client: `{}`", serde_json::to_value(client).unwrap().as_str().unwrap_or("?"));
    let _ = writeln!(md, "- Platform: `{api}`");
    let _ = writeln!(md, "- When: {}", chrono_now());
    let _ = writeln!(md, "- Overall: {ok}/{total} trials connected ({:.1}%)\n", if total > 0 { 100.0 * ok as f64 / total as f64 } else { 0.0 });
    let _ = writeln!(md, "Times are milliseconds. *Create* is the host's create call until it has a room code (engine hosts create 1.5 s after their socket is up, as an app's player would from a menu). *Join* is the guest's join call until it is in the room. *Connect* is from the guest starting until its first message comes back from the host. *Rung* is the path the connection used.\n");
    let _ = writeln!(md, "| Scenario | Connected | Connected on | Settled on | Create p50 / p95 | Join p50 / p95 | Connect p50 / p95 | RTT p50 | Longest stall p95 | Recovered |");
    let _ = writeln!(md, "|---|---|---|---|---|---|---|---|---|---|");
    for (s, v) in scenarios.iter().zip(&sums) {
        let tally = |k: &str| v[k].as_object().map(|m| m.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", ")).filter(|s| !s.is_empty()).unwrap_or_else(|| "–".into());
        let (rungs, settled) = (tally("rungs"), tally("settled"));
        let pair = |k: &str| format!("{} / {}", fmt_ms(v[k]["p50"].as_f64()), fmt_ms(v[k]["p95"].as_f64()));
        let rec = if v["recovered"].is_null() { "–".to_string() } else { format!("{}/{}", v["recovered"]["yes"], v["recovered"]["of"]) };
        let _ = writeln!(
            md,
            "| {} | {}/{} | {} | {} | {} | {} | {} | {} | {} | {} |",
            s.name,
            v["connected"],
            v["trials"],
            rungs,
            settled,
            pair("create_ms"),
            pair("join_ms"),
            pair("connect_ms"),
            fmt_ms(v["rtt_ms_p50"].as_f64()),
            fmt_ms(v["longest_gap_ms_p95"].as_f64()),
            rec
        );
    }
    let _ = writeln!(md, "\n## Scenarios\n");
    for s in scenarios {
        let _ = writeln!(md, "- **{}**: {}", s.name, s.about);
    }
    let errs: Vec<(String, String)> = scenarios
        .iter()
        .zip(&sums)
        .flat_map(|(s, v)| v["errors"].as_object().into_iter().flatten().map(move |(e, n)| (s.name.to_string(), format!("{e} (×{n})"))))
        .collect();
    if !errs.is_empty() {
        let _ = writeln!(md, "\n## Failures\n");
        for (s, e) in errs {
            let _ = writeln!(md, "- {s}: {e}");
        }
    }
    let md_path = dir.join(format!("{label}.md"));
    std::fs::write(&md_path, md)?;
    Ok(json!({
        "report": md_path,
        "raw": raw_path,
        "trials": total,
        "connected": ok,
        "scenarios": sums,
    }))
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // UTC date and time without a date crate.
    let days = secs / 86400;
    let (h, m) = ((secs % 86400) / 3600, (secs % 3600) / 60);
    let (y, mo, d) = civil(days as i64);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02} UTC")
}

/// Days since 1970-01-01 to (year, month, day) (Howard Hinnant's algorithm).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20737), (2026, 10, 11));
    }

    #[test]
    fn summary_counts_rungs_and_failures() {
        let mk = |connected, rung: Option<&str>, err: Option<&str>| TrialResult {
            scenario: "x".into(),
            connected,
            rung: rung.map(Into::into),
            error: err.map(Into::into),
            connect_ms: connected.then_some(900),
            ..Default::default()
        };
        let rs = vec![mk(true, Some("relay"), None), mk(true, Some("host"), None), mk(false, None, Some("timeout"))];
        let v = summarize(&rs, "x");
        assert_eq!(v["connected"], 2);
        assert_eq!(v["rungs"]["relay"], 1);
        assert_eq!(v["errors"]["timeout"], 1);
        assert_eq!(v["connect_ms"]["p50"], 900.0);
    }
}
