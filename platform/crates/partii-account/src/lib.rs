//! The player's partii account inside a game.
//!
//! * **Sign-in**: a guest account per device (a random id kept in the game's
//!   data folder), created on first launch with no form. `login` links
//!   email, Apple, Google, Discord or Steam later: the guest becomes (or
//!   merges into) that account, and this device signs in to it from then on.
//! * **Other calls** (player content, …): `client()` is an API client
//!   signed in as this player, for any operation in API.md.
//! * **Entitlements**: which SKUs the player owns. The last answer is cached
//!   for a week, so a paid game stays unlocked offline.
//! * **Cloud saves**: named JSON slots. Reads come from a local mirror;
//!   writes queue. When another device wrote first, the game's merge
//!   function combines both copies and the write is retried.
//! * **Checkout**: a store URL to open in the browser; `refresh` afterwards.
//!
//! All network work runs on one background thread; the frame never waits.
//!
//! ```no_run
//! use partii_account::{Account, AccountConfig};
//! let acct = Account::start(AccountConfig {
//!     game: "mygame".into(),
//!     key: Some("pk_mystudio_game_...".into()),
//!     data_dir: "/path/to/save/folder".into(),
//!     slots: vec!["progress".into()],
//!     ..AccountConfig::default()
//! });
//! // each frame / when needed:
//! if acct.owns("full") == Some(true) { /* unlock */ }
//! acct.write_save("progress", r#"{"level":3}"#);
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use partii_api::Client;
use serde_json::{json, Value};

/// Combine this device's copy of a slot with the platform's newer copy:
/// `(slot, mine, theirs) -> merged`. `None` keeps this device's copy.
pub type Merge = fn(&str, &str, &str) -> Option<String>;

#[derive(Clone)]
pub struct AccountConfig {
    /// partii edge base URL.
    pub edge: String,
    /// The game's publishable key.
    pub key: Option<String>,
    /// A player token to use instead of guest sign-in (tests, linked accounts).
    pub player_token: Option<String>,
    /// The game's id on partii.
    pub game: String,
    /// Where the device id and entitlement cache live (the game's save folder).
    pub data_dir: PathBuf,
    pub display_name: String,
    /// Save slots fetched at sign-in (others are fetched on first read).
    pub slots: Vec<String>,
    pub merge: Option<Merge>,
}

impl Default for AccountConfig {
    fn default() -> Self {
        AccountConfig {
            edge: "https://partii-edge.partii-games.workers.dev".into(),
            key: None,
            player_token: None,
            game: String::new(),
            data_dir: PathBuf::from("."),
            display_name: "Player".into(),
            slots: Vec::new(),
            merge: None,
        }
    }
}

#[derive(Default)]
struct State {
    /// Signed in and the first fetch is done.
    ready: bool,
    player_id: Option<String>,
    player_token: Option<String>,
    /// Sign-in providers linked to the player ("device" alone: a guest).
    providers: Option<Vec<String>>,
    login: Option<Result<(), String>>,
    /// SKUs owned ("full", …); None until known (fresh install offline).
    owns: Option<Vec<String>>,
    /// slot → (rev, JSON text) as the platform has it.
    saves: HashMap<String, (i64, String)>,
    checkout: Option<Result<String, String>>,
    error: Option<String>,
    /// Writes queued and not yet answered by the platform.
    pending: usize,
}

enum Job {
    Write { slot: String, contents: String },
    Refresh,
    Checkout,
    Login(Value),
}

pub struct Account {
    st: Arc<Mutex<State>>,
    jobs: Sender<Job>,
    edge: String,
    key: Option<String>,
}

/// A save slot name for a file path ("mygame/campaign-saves.json" → "campaign-saves").
pub fn slot_for(file: &str) -> String {
    let base = file.rsplit('/').next().unwrap_or(file);
    base.trim_end_matches(".json").chars().map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '-' }).collect()
}

/// This install's id, made once and kept in `dir`. Creation is exclusive
/// (`O_EXCL`), so two first launches racing agree on one id. (Not a hard
/// link: Android's SELinux policy forbids links in app storage.)
pub fn device_id(dir: &Path) -> String {
    use std::io::Write;
    let path = dir.join("partii-device");
    let read = || std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string()).filter(|s| s.len() >= 16);
    if let Some(id) = read() {
        return id;
    }
    let mut b = [0u8; 18];
    let _ = getrandom::fill(&mut b);
    let id: String = b.iter().map(|x| b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[(*x & 63) as usize] as char).collect();
    let _ = std::fs::create_dir_all(dir);
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            if f.write_all(id.as_bytes()).and_then(|_| f.sync_all()).is_ok() {
                return id;
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            // Another launch won; its id may still be landing.
            for _ in 0..50 {
                if let Some(theirs) = read() {
                    return theirs;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        Err(_) => {}
    }
    read().unwrap_or(id)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Cached {
    game: String,
    owns: Vec<String>,
    /// The platform's signed copy (kept for support and future checks).
    signed: String,
    /// Unix ms after which the cache no longer unlocks anything.
    until: u64,
}

const WEEK_MS: u64 = 7 * 86_400_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Keep what a sign-in answer says about the player.
fn signed_in(st: &Mutex<State>, v: &Value) {
    let mut s = lock(st);
    if let Some(t) = v["player_token"].as_str() {
        s.player_token = Some(t.to_string());
    }
    if let Some(id) = v["player"]["id"].as_str() {
        s.player_id = Some(id.to_string());
    }
    if let Some(p) = v["player"]["providers"].as_array() {
        s.providers = Some(p.iter().filter_map(|x| x.as_str().map(str::to_string)).collect());
    }
}

fn lock(st: &Mutex<State>) -> std::sync::MutexGuard<'_, State> {
    st.lock().unwrap_or_else(|p| p.into_inner())
}

impl Account {
    pub fn start(cfg: AccountConfig) -> Account {
        let st = Arc::new(Mutex::new(State::default()));
        let cache_path = cfg.data_dir.join(format!("partii-entitlements-{}.json", slot_for(&cfg.game)));
        // Offline: last week's entitlements still unlock.
        if let Some(c) = std::fs::read_to_string(&cache_path).ok().and_then(|s| serde_json::from_str::<Cached>(&s).ok()) {
            if c.until > now_ms() && c.game == cfg.game {
                lock(&st).owns = Some(c.owns);
            }
        }
        let (edge, key) = (cfg.edge.clone(), cfg.key.clone());
        let (tx, rx) = channel::<Job>();
        let shared = st.clone();
        std::thread::Builder::new()
            .name("partii-account".into())
            .spawn(move || {
                let mut c = Client { base: cfg.edge.clone(), key: cfg.key.clone(), player_token: cfg.player_token.clone(), ..Default::default() };
                // Sign in (retrying while offline), then the first fetch.
                let mut wait = 1u64;
                while c.player_token.is_none() {
                    let device = device_id(&cfg.data_dir);
                    match c.json("playersGuest", &[], Some(json!({ "device_id": device, "display_name": cfg.display_name }))) {
                        Ok(v) if v["ok"] == true => {
                            c.player_token = v["player_token"].as_str().map(str::to_string);
                            signed_in(&shared, &v);
                        }
                        Ok(v) => lock(&shared).error = Some(v["error"]["message"].as_str().unwrap_or("sign-in refused").to_string()),
                        Err(e) => lock(&shared).error = Some(e.message),
                    }
                    if c.player_token.is_none() {
                        std::thread::sleep(std::time::Duration::from_secs(wait));
                        wait = (wait * 2).min(30);
                    }
                }
                lock(&shared).player_token = c.player_token.clone();
                if lock(&shared).providers.is_none() {
                    if let Ok(v) = c.json("playersMe", &[], None) {
                        signed_in(&shared, &v);
                    }
                }
                refresh(&c, &cfg.game, &shared, &cache_path);
                for slot in &cfg.slots {
                    fetch(&c, &cfg.game, &shared, slot);
                }
                {
                    let mut s = lock(&shared);
                    s.ready = true;
                    s.error = None;
                }
                for job in rx {
                    match job {
                        Job::Refresh => refresh(&c, &cfg.game, &shared, &cache_path),
                        Job::Write { slot, contents } => {
                            write_save(&c, &cfg, &shared, &slot, contents);
                            let mut s = lock(&shared);
                            s.pending = s.pending.saturating_sub(1);
                        }
                        Job::Checkout => {
                            let out = match c.json("storeCheckout", &[("game", cfg.game.as_str())], Some(json!({}))) {
                                Ok(v) if v["ok"] == true => match v["url"].as_str() {
                                    Some(u) => Ok(u.to_string()),
                                    // The fake store (dev) completes at once.
                                    None => {
                                        refresh(&c, &cfg.game, &shared, &cache_path);
                                        Err("completed".into())
                                    }
                                },
                                Ok(v) => Err(v["error"]["message"].as_str().unwrap_or("checkout failed").to_string()),
                                Err(e) => Err(e.message),
                            };
                            lock(&shared).checkout = Some(out);
                        }
                        Job::Login(body) => {
                            // With the guest's token along, the platform links the
                            // identity to it, or merges it into the account.
                            let out = match c.json("playersLogin", &[], Some(body)) {
                                Ok(v) if v["ok"] == true => {
                                    c.player_token = v["player_token"].as_str().map(str::to_string);
                                    signed_in(&shared, &v);
                                    // A merge can change what the player owns and has saved.
                                    refresh(&c, &cfg.game, &shared, &cache_path);
                                    let slots: Vec<String> = lock(&shared).saves.keys().cloned().chain(cfg.slots.iter().cloned()).collect();
                                    for slot in slots {
                                        fetch(&c, &cfg.game, &shared, &slot);
                                    }
                                    Ok(())
                                }
                                Ok(v) => Err(v["error"]["message"].as_str().unwrap_or("sign-in refused").to_string()),
                                Err(e) => Err(e.message),
                            };
                            lock(&shared).login = Some(out);
                        }
                    }
                }
            })
            .expect("partii-account thread");
        Account { st, jobs: tx, edge, key }
    }

    /// Signed in and the first fetch is done.
    pub fn ready(&self) -> bool {
        lock(&self.st).ready
    }
    pub fn player_id(&self) -> Option<String> {
        lock(&self.st).player_id.clone()
    }
    /// The player token (None until signed in). It changes after `login`.
    pub fn player_token(&self) -> Option<String> {
        lock(&self.st).player_token.clone()
    }
    /// An API client signed in as this player, for any operation (player
    /// content: `ugcPublish`, `ugcVote`, …). Calls block, so make them off
    /// the frame. None until signed in; ask again after `login`.
    pub fn client(&self) -> Option<partii_api::Client> {
        let token = self.player_token()?;
        Some(Client { base: self.edge.clone(), key: self.key.clone(), player_token: Some(token), ..Default::default() })
    }
    /// Only a device guest (no email, Steam, … linked)? None until known.
    /// Publishing player content needs a signed-in player.
    pub fn is_guest(&self) -> Option<bool> {
        lock(&self.st).providers.as_ref().map(|p| p.iter().all(|x| x == "device"))
    }
    /// The providers linked to the player ("device", "steam", "email", …).
    pub fn providers(&self) -> Vec<String> {
        lock(&self.st).providers.clone().unwrap_or_default()
    }
    /// Sign in with a provider; the guest becomes (or merges into) that
    /// account. `fields` are the provider's: Steam `{"ticket": hex}`, email
    /// `{"email", "code"}` (send the code first with `playersEmailStart`
    /// through `client()`), Apple/Google `{"id_token"}`, Discord `{"code"}`.
    /// The outcome arrives via `take_login`; saves and entitlements are
    /// fetched again.
    pub fn login(&self, provider: &str, fields: Value) {
        let mut body = if fields.is_object() { fields } else { json!({}) };
        body["provider"] = json!(provider);
        lock(&self.st).login = None;
        let _ = self.jobs.send(Job::Login(body));
    }
    pub fn take_login(&self) -> Option<Result<(), String>> {
        lock(&self.st).login.take()
    }
    /// Does the player own `sku` (e.g. "full")? None while unknown.
    pub fn owns(&self, sku: &str) -> Option<bool> {
        lock(&self.st).owns.as_ref().map(|o| o.iter().any(|s| s == sku))
    }
    /// The last sign-in or network problem (cleared once signed in).
    pub fn error(&self) -> Option<String> {
        lock(&self.st).error.clone()
    }
    /// Ask the platform again (after a purchase in the browser).
    pub fn refresh(&self) {
        let _ = self.jobs.send(Job::Refresh);
    }
    /// Start buying the game; the URL to open arrives via `take_checkout`.
    pub fn start_checkout(&self) {
        let _ = self.jobs.send(Job::Checkout);
    }
    pub fn take_checkout(&self) -> Option<Result<String, String>> {
        lock(&self.st).checkout.take()
    }
    /// A slot's JSON text as last seen (None if empty or not fetched).
    pub fn read_save(&self, slot: &str) -> Option<String> {
        lock(&self.st).saves.get(slot).map(|(_, t)| t.clone()).filter(|t| t != "null")
    }
    /// The slot's revision as last seen (0 = never written).
    pub fn save_rev(&self, slot: &str) -> i64 {
        lock(&self.st).saves.get(slot).map(|(r, _)| *r).unwrap_or(0)
    }
    /// Queue a write of JSON text (it is stored as parsed JSON) to a slot.
    pub fn write_save(&self, slot: &str, contents: &str) -> bool {
        lock(&self.st).pending += 1;
        let ok = self.jobs.send(Job::Write { slot: slot.to_string(), contents: contents.to_string() }).is_ok();
        if !ok {
            let mut s = lock(&self.st);
            s.pending = s.pending.saturating_sub(1);
        }
        ok
    }
    /// Writes not yet stored by the platform. Wait for 0 (briefly) before
    /// quitting if a save must not be lost; writes made offline wait for
    /// sign-in.
    pub fn pending_writes(&self) -> usize {
        lock(&self.st).pending
    }
}

fn fetch(c: &Client, game: &str, st: &Mutex<State>, slot: &str) {
    if let Ok(v) = c.json("savesGet", &[("game", game), ("slot", slot)], None) {
        if v["ok"] == true {
            let rev = v["save"]["rev"].as_i64().unwrap_or(0);
            let text = serde_json::to_string(&v["save"]["data"]).unwrap_or_default();
            lock(st).saves.insert(slot.to_string(), (rev, text));
        }
    }
}

fn refresh(c: &Client, game: &str, st: &Mutex<State>, cache: &Path) {
    let Ok(v) = c.json("playersEntitlements", &[("game", game)], None) else { return };
    if v["ok"] != true {
        return;
    }
    let owns: Vec<String> = v["entitlements"].as_array().into_iter().flatten().filter(|e| e["game"] == game).filter_map(|e| e["sku"].as_str().map(str::to_string)).collect();
    lock(st).owns = Some(owns.clone());
    let cached = Cached { game: game.into(), owns, signed: v["signed"].as_str().unwrap_or("").to_string(), until: now_ms() + WEEK_MS };
    if let Ok(s) = serde_json::to_string(&cached) {
        let _ = std::fs::write(cache, s);
    }
}

/// Write a save; on a conflict, merge with the newer copy and write again.
fn write_save(c: &Client, cfg: &AccountConfig, st: &Mutex<State>, slot: &str, contents: String) {
    let Ok(mut data) = serde_json::from_str::<Value>(&contents) else { return };
    let game = cfg.game.as_str();
    for _ in 0..3 {
        let base = lock(st).saves.get(slot).map(|(r, _)| *r).unwrap_or(0);
        match c.json("savesPut", &[("game", game), ("slot", slot)], Some(json!({ "base_rev": base, "data": data }))) {
            Ok(v) if v["ok"] == true => {
                let rev = v["save"]["rev"].as_i64().unwrap_or(base + 1);
                lock(st).saves.insert(slot.to_string(), (rev, serde_json::to_string(&data).unwrap_or_default()));
                return;
            }
            Ok(v) if v["error"]["code"] == "conflict" => {
                let theirs = &v["theirs"];
                let rev = theirs["rev"].as_i64().unwrap_or(0);
                let their_text = serde_json::to_string(&theirs["data"]).unwrap_or_default();
                lock(st).saves.insert(slot.to_string(), (rev, their_text.clone()));
                let mine = serde_json::to_string(&data).unwrap_or_default();
                if let Some(merged) = cfg.merge.and_then(|m| m(slot, &mine, &their_text)).and_then(|m| serde_json::from_str(&m).ok()) {
                    data = merged;
                }
            }
            _ => return,
        }
    }
}

/// A merge that unions two JSON objects (this device's keys win). Handy
/// for saves that are maps of independent entries.
pub fn merge_objects(_slot: &str, mine: &str, theirs: &str) -> Option<String> {
    let (Ok(Value::Object(m)), Ok(Value::Object(mut t))) = (serde_json::from_str::<Value>(mine), serde_json::from_str::<Value>(theirs)) else {
        return None;
    };
    for (k, v) in m {
        t.insert(k, v);
    }
    serde_json::to_string(&Value::Object(t)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_map_to_slots() {
        assert_eq!(slot_for("tankii/campaign-saves.json"), "campaign-saves");
        assert_eq!(slot_for("my save!.json"), "my-save-");
    }

    #[test]
    fn device_id_is_made_once() {
        let dir = std::env::temp_dir().join(format!("partii-account-test-{}", now_ms()));
        let a = device_id(&dir);
        assert!(a.len() >= 16);
        assert_eq!(device_id(&dir), a);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn racing_first_launches_agree_on_one_device_id() {
        let dir = std::env::temp_dir().join(format!("partii-account-race-{}", now_ms()));
        let ids: Vec<String> = (0..8).map(|_| { let d = dir.clone(); std::thread::spawn(move || device_id(&d)) }).collect::<Vec<_>>().into_iter().map(|h| h.join().unwrap()).collect();
        assert!(ids.iter().all(|i| i == &ids[0]), "{ids:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn merge_objects_unions_and_mine_wins() {
        let m = merge_objects("s", r#"{"a":1,"b":2}"#, r#"{"b":9,"c":3}"#).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&m).unwrap(), json!({"a":1,"b":2,"c":3}));
        assert_eq!(merge_objects("s", "[1]", "{}"), None);
    }
}
