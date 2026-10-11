# partii: a game developer's guide

partii gives a game four things:

- **Online play** that connects through any network: rooms with short codes, a relay that always works, WebRTC when it is faster.
- **Player accounts**: a guest account on first launch, upgradeable to email, Apple, Google, Discord or Steam later.
- **Saves and purchases** that follow the player to every device.
- **A store page** to sell the game, plus **phone controllers** (players scan a QR code and their phone becomes a gamepad).

You drive all of it from the `partii` command line. Every command prints one JSON document. This guide takes a game from nothing to all of the above.

- Reference: [API.md](API.md) (every operation; generated) and `partii help --json` (every command).
- Wire details: [PROTOCOL.md](PROTOCOL.md) (live rooms) and [CONTROLLER.md](CONTROLLER.md) (phones).

## 0. Get the CLI and a platform

```sh
cd partii/platform
cargo build -p partii-cli            # → target/debug/partii (put it on PATH)
```

Which platform you use:

- **Local** (everything on your machine): `partii dev up` (leave it running). It prints its URL and a ready-made publishable key for a built-in `demo` project, handy for a first multiplayer test. For a real game make your own project and key (section 1); `partii dev key` mints more demo keys. Locally, purchases go through a fake store and logins are fake, so nothing needs Stripe or Apple.
- **Staging** or **production**: set `PARTII_API` to its URL.

Credentials come from the environment:

| Variable | What |
|---|---|
| `PARTII_API` | Platform URL (default `http://127.0.0.1:8787`) |
| `PARTII_TOKEN` | Your developer token |
| `PARTII_KEY` | A publishable key (games and web pages ship this) |
| `PARTII_PLAYER_TOKEN` | A player's token (for player commands and tests) |
| `PARTII_ADMIN_TOKEN` | Platform operators only (`partii admin …`); locally `dev-admin-token` |

## 1. Account, project, key

```sh
# Platform operators create developers (locally the admin token is dev-admin-token):
partii admin developers create --email you@example.com --name "You" --admin-token dev-admin-token
export PARTII_TOKEN=pd_...                        # from the reply's "token"

partii projects put mystudio --name "My Studio"   # ids: lowercase letters and digits
partii keys create mystudio --key-id game         # reply: key.key = pk_mystudio_game_...
export PARTII_KEY=pk_mystudio_game_...
```

Every create is safe to repeat: `put` updates, and `create` with the same id returns the same key. Add `--dry-run` to any change to see it without making it.

Ids: projects are lowercase letters and digits; games are 1–40 lowercase letters, digits and dashes (`my-game`).

## 2. Multiplayer in a Rust game

Add the engine. It runs its own threads, and nothing blocks your frame:

```toml
[dependencies]
partii-engine = { path = "../partii/platform/crates/partii-engine" }   # or a git dependency; feature `native` (default) = desktop/mobile
serde_json = "1"                                                       # member/room `meta` is a serde_json::Value
```

For a web (wasm) build use `default-features = false`; the same `Engine` API runs on the browser's event loop.

```rust
use partii_engine::{Config, Engine, Event, BROADCAST};

let engine = Engine::start(Config {
    edge: std::env::var("PARTII_API").unwrap_or("https://<your platform>".into()),
    key: "pk_mystudio_game_...".into(),
    conn: Engine::new_conn_id(),          // fresh per launch
    client: "mygame/1.0".into(),
    player_token: None,                   // or the signed-in player's token
    no_webrtc: false,
});

// Any time, even on the first frame: a create/join made before the engine is
// online is held and sent the moment it connects (Event::Online); if partii
// can't be reached within 10 s it fails with code "offline".
let req: u32 = engine.create("mygame", Some(4), "game", "Alice", serde_json::json!({}));
// or: engine.join("KXQPT", "game", "Bob", serde_json::json!({}));

// Every frame:
for ev in engine.poll() {
    match ev {
        Event::Created { room, .. } => show_code(&room.code),   // 5 capital letters
        Event::Joined { room, .. } => { /* you are room.you; the host is room.host */ }
        Event::Failed { req, code, message } => show_error(&code, &message), // not_found, full, not_joinable, offline, …
        Event::PeerConnected { mid, .. } => { /* member `mid` can receive now */ }
        Event::MemberLeft { mid, .. } => { /* gone */ }
        Event::Message { from, reliable, bytes } => handle(from, reliable, &bytes),
        Event::RoomClosed { reason } => back_to_menu(),          // "host_left", "expired", "kicked", …
        _ => {}
    }
}
engine.send(mid, false, input_bytes);     // unreliable: positions, inputs
engine.send(mid, true, event_bytes);      // reliable and ordered: chat, joins, round results
engine.send(BROADCAST, true, bytes);      // everyone else in the room
```

`create` and `join` return a request id (`u32`); the matching `Created`/`Joined`/`Failed` carries it as `req`. Every event:

| Event | Fields | Meaning |
|---|---|---|
| `Online` | `resumed: bool, relay: String` | The session socket is up (first time or after a drop). |
| `Offline` | – | The socket dropped; the engine is reconnecting (rooms survive short drops). |
| `Created` / `Joined` | `req: u32, room: Room` | You are in the room. |
| `Failed` | `req: u32, code: String, message: String` | A create/join didn't happen. |
| `MemberJoined` | `member: Member` | Someone joined. |
| `MemberLeft` | `mid: u16, reason: String` | Someone left (or their seat grace ran out). |
| `MemberSuspended` / `MemberResumed` | `mid: u16` | A member's connection dropped / came back (seat kept meanwhile). |
| `RoomUpdated` | `room: Room` | Room settings changed (joinable, meta, size). |
| `RoomClosed` | `reason: String` | The room is gone for you. When the host leaves, guests get `host_left`. |
| `PeerConnected` | `mid: u16, path: PathId` | You can send to `mid` now. |
| `PathChanged` | `mid: u16, from, to: PathId, rtt: Option<f64>` | The route to a member changed (ws relay ↔ TURN ↔ direct). Informational. |
| `Message` | `from: u16, reliable: bool, bytes: Vec<u8>` | Data from a member. |
| `Error` | `message: String` | Something to log; the engine recovers by itself. |

`Room { code: String, game: String, host: u16, you: u16, joinable: bool, max_members: u32, meta: Value, members: Vec<Member> }` and `Member { mid: u16, kind: String, name: String, meta: Value, status: String }`. Member ids (`mid`) are small integers, unique within the room; the host is `room.host`.

What the engine does for you:

- **Paths.** A member is reachable the moment you are both in the room (over the relay). The engine moves to WebRTC (TURN, or direct when faster) on its own, and back when a path fails. Your code never sees paths. `engine.stats()` shows them.
- **Reliability.** Reliable messages survive path switches, network changes and short drops (the session resumes). Members who drop briefly keep their seat for 20 s.
- **Network changes.** Phones changing networks, apps backgrounded for a few seconds, and hotel Wi-Fi that only allows port 443 all keep working.

Members have a `kind` you choose:

- `game`: a full game client.
- `phone`: a phone controller (section 6).

Put anything you need about a member (your own player id, a team) in `meta` when you create or join. Other members see it in `room.members`.

For web pages, the same engine is built for browsers (`scripts/build-engine-web.sh`, which makes `sdk/engine-web`). `new WebEngine(JSON.stringify(config))` has the same methods; `poll()` returns a JSON array.

### Test it without a second person

```sh
partii bot host --menu-ms 0          # creates a room and echoes everything (prints the code)
partii bot guest --code KXQPT        # joins, pings, prints timings and the path used
partii torture run --client engine   # every bad network, in Docker (see docs/DESIGN.md)
```

## 3. Players and saves

Add `partii-account` (`partii-account = { path = "../partii/platform/crates/partii-account" }`). One `Account` per launch does it all on a background thread (native builds):

```rust
use partii_account::{Account, AccountConfig, merge_objects};

let acct = Account::start(AccountConfig {
    edge: "https://<your platform>".into(),
    key: Some("pk_mystudio_game_...".into()),
    game: "mygame".into(),
    data_dir: save_folder.clone(),       // keeps this install's device id + offline entitlement cache
    display_name: "Player".into(),
    slots: vec!["progress".into()],      // fetched at sign-in
    merge: Some(merge_objects),          // or your own fn(slot, mine, theirs) -> Option<merged>
    ..AccountConfig::default()
});

// Any frame (never blocks):
acct.ready();                            // signed in + first fetch done
acct.player_id();                        // Some("p_...")
acct.owns("full");                       // Some(true/false); None while unknown (fresh install offline)
acct.read_save("progress");              // Some(json text) once fetched
acct.write_save("progress", r#"{"level":3}"#);  // queued; conflicts merge and retry
acct.pending_writes();                   // writes not stored yet; wait for 0 before quitting if it matters
```

The API, in types:

| Item | Type |
|---|---|
| `AccountConfig { edge, game, display_name }` | `String` |
| `AccountConfig { key, player_token }` | `Option<String>` |
| `AccountConfig { data_dir }` | `PathBuf` |
| `AccountConfig { slots }` | `Vec<String>` |
| `AccountConfig { merge }` | `Option<fn(slot: &str, mine: &str, theirs: &str) -> Option<String>>` (JSON texts in, merged JSON text out; `None` keeps yours) |
| `merge_objects` | a ready-made `merge`: unions two JSON objects, your keys win |
| `ready()` | `bool`: signed in, entitlements and the listed slots fetched |
| `player_id()` | `Option<String>` |
| `owns(sku)` | `Option<bool>` |
| `read_save(slot)` | `Option<String>`: JSON text; `None` if empty or not fetched |
| `save_rev(slot)` | `i64`: 0 = never written |
| `write_save(slot, json_text)` | `bool`: queued; the text is stored as parsed JSON |
| `pending_writes()` | `usize` |
| `refresh()`, `start_checkout()` | `()` |
| `take_checkout()` | `Option<Result<String, String>>` |
| `error()` | `Option<String>` |

**When `owns` is fresh.** Before `ready()`, `owns` returns last week's cached answer (or `None` on a fresh install). Once `ready()` is true it reflects the platform at sign-in. After a purchase made elsewhere (the browser, another device), call `refresh()`; `owns` updates when the answer arrives.

- **Sign-in.** On first launch the install becomes a guest player (a random device id kept in `data_dir`), with no form. Later the player can link email (`playersEmailStart`, then `playersLogin` with `provider: "email"`), Apple, Google, Discord or Steam. The guest becomes, or merges into, that account, so saves and purchases follow them to every device.
- **Saves.** Named JSON slots per game. If another device wrote first, your `merge` function gets both copies and the merged result is written. Every write keeps a backup (`savesHistory`, `savesRestore`).
- **Offline.** The last entitlement answer is cached for a week, so a paid game stays unlocked without a network.
- **Tests.** Set `AccountConfig::player_token` (e.g. from `partii test players create`) to act as a specific player.

Under the hood these are plain API calls (`POST /v1/players/guest`, `PUT /v1/saves/{game}/{slot}` with `base_rev`, `GET /v1/players/me/entitlements?game=`), listed in [API.md](API.md); `partii-api` is a typed client for all of them if you need more.

## 4. Sell it

```sh
partii games put mygame --project mystudio --title "My Game" --tagline "One line" \
  --description "What it is." --price-cents 499 \
  --field 'platforms=["macos","windows","ios","android"]' \
  --field 'demo={"free_levels":20}'                   # a free part; `demo=null` = no free part (the whole game is paid)
partii builds upload mygame --platform macos --version 1.0.0 --file MyGame.dmg   # optional for publishing
partii games publish mygame                           # now on the store (needs nothing else)
partii games sale mygame --percent 25                 # a week-long sale (or --starts-at/--ends-at, ms)
partii codes create mygame --count 10 --note press    # redeemable keys
```

In the game, the player owns it if their entitlements say so:

```
GET /v1/players/me/entitlements?game=mygame
   → {entitlements: [{game, sku: "full", source}], signed}
```

Keep `signed` (it is valid for a week) so the game stays unlocked offline. While the player doesn't own the game, play only the free part.

To unlock from inside the game:

- `acct.start_checkout()`, then `acct.take_checkout()` gives the URL to open in the browser (`Err("completed")` means the local fake store finished at once). Call `acct.refresh()` when the player is back; `acct.owns("full")` turns true.
- Purchases made in the App Store, Google Play or Steam: send them to `playersReceipt`. partii verifies them with the store.

Test without paying:

```sh
partii test players create --name Tester            # → player id + player_token
partii test purchase --game mygame --player p_...   # Stripe test mode, or the fake store locally
partii sales mygame                                  # purchases and totals (gross_cents counts real sales only; test purchases are test_count)
```

Body fields are also flags: `--price-cents 500` and `--field price_cents=500` are the same; use `--field` for JSON values (lists, objects, `null`).

## 5. Live content

```sh
partii content push mygame --version 2026.10.12 --field 'files={"levels/1.json":"<base64>"}'
```

Games read `GET /v1/content/{game}/manifest` at launch and fetch changed files by hash (`contentFile`). Levels, tuning and scripts update without a store release.

## 6. Phone controllers

When the game hosts a room, show a QR code for:

```
<controller page>/c/<ROOM CODE>?k=<publishable key>&e=<platform URL>
```

The controller page is `platform/apps/controller`; the staging copy is `https://partii-controller-staging.partii-games.workers.dev`. The phone joins as a member of kind `phone` and streams input frames (10 bytes, about 30 times a second; [CONTROLLER.md](CONTROLLER.md)):

```rust
// In Event::Message from a phone member:
if bytes.len() >= 9 && bytes[0] == 0x50 {
    let lx = bytes[3] as i8 as f32 / 127.0;          // left stick, -1..1 (+y down)
    let ly = bytes[4] as i8 as f32 / 127.0;
    let rx = bytes[5] as i8 as f32 / 127.0;          // right stick
    let ry = bytes[6] as i8 as f32 / 127.0;
    let buttons = u16::from_le_bytes([bytes[7], bytes[8]]); // 1 primary, 2 secondary, 4 start
}
```

Tell the phone its seat so it can colour itself: `engine.send(mid, true, br#"{"t":"seat","label":"P2","color":"#3B82F6"}"#.to_vec())`. Rename its buttons with `{"t":"layout","buttons":["JUMP","GRAB"]}`.

## 7. Errors

Every failure is `{"ok": false, "error": {"code", "message", "hint"}}`, and the hint says what to do. CLI exit codes:

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | the platform said no |
| 2 | a bad command line |

## Checklist for a new game

1. Project and key (section 1).
2. Engine in the game: host and join with a code (section 2). Check with `partii bot guest`.
3. `partii-account` at launch: guest sign-in, saves, `owns("full")` (section 3).
4. Store page, price and demo gate; the game checks entitlements (section 4).
5. Optional: phone controllers (section 6) and live content (section 5).
