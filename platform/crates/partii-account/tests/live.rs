//! Against a real platform (`PARTII_API` + `PARTII_KEY`, e.g. `partii dev
//! up`; skipped otherwise): guest sign-in is stable per device, a second
//! device's stale write conflicts, merges and lands, and a third device
//! reads the merged save. A player who bought nothing owns nothing.

use std::time::{Duration, Instant};

use partii_account::{merge_objects, Account, AccountConfig};
use serde_json::{json, Value};

fn wait(what: &str, mut f: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(15);
    while Instant::now() < until {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timed out: {what}");
}

#[test]
fn saves_merge_across_devices_of_one_player() {
    let (Ok(edge), Ok(key)) = (std::env::var("PARTII_API"), std::env::var("PARTII_KEY")) else {
        eprintln!("skip: set PARTII_API and PARTII_KEY");
        return;
    };
    let dir = std::env::temp_dir().join(format!("partii-account-live-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let cfg = AccountConfig { edge, key: Some(key), game: "account-test".into(), data_dir: dir.clone(), slots: vec!["progress".into()], merge: Some(merge_objects), ..AccountConfig::default() };
    let a = Account::start(cfg.clone());
    let b = Account::start(cfg.clone());
    wait("both signed in", || a.ready() && b.ready());
    assert!(a.player_id().is_some());
    assert_eq!(a.player_id(), b.player_id(), "one device id → one guest player");
    assert_eq!(a.owns("full"), Some(false), "nothing bought");

    a.write_save("progress", r#"{"a":1}"#);
    wait("a's write", || a.save_rev("progress") >= 1);
    // b still thinks the slot is empty: its write conflicts and merges.
    b.write_save("progress", r#"{"b":2}"#);
    wait("b's merged write", || b.save_rev("progress") >= 2);
    let merged: Value = serde_json::from_str(&b.read_save("progress").unwrap()).unwrap();
    assert_eq!(merged, json!({"a":1,"b":2}));

    let c = Account::start(cfg);
    wait("third device", || c.ready());
    let seen: Value = serde_json::from_str(&c.read_save("progress").unwrap()).unwrap();
    assert_eq!(seen, json!({"a":1,"b":2}));
    let _ = std::fs::remove_dir_all(dir);
}
