# partii: a game developer's guide

partii gives a game four things:

- **Online play** that connects through any network: rooms with short codes, a relay that always works, WebRTC when it is faster.
- **Player accounts**: a guest account on first launch, upgradeable to email, Apple, Google, Discord or Steam later.
- **Saves and purchases** that follow the player to every device.
- **A store page** to sell the game, plus **phone controllers** (players scan a QR code and their phone becomes a gamepad).
- **Analytics**: players, sessions, retention, gameplay events and grouped crash reports, on a dashboard at partii.games/dev.

You drive all of it from the `partii` command line. Every command prints one JSON document. This guide takes a game from nothing to all of the above.

- Reference: [API.md](API.md) (every operation; generated) and `partii help --json` (every command).
- Wire details: [PROTOCOL.md](PROTOCOL.md) (live rooms) and [CONTROLLER.md](CONTROLLER.md) (phones).

## 0. Get the CLI and an account

```sh
curl -fsSL https://partii.games/install.sh | sh     # macOS, Linux; Windows: irm https://partii.games/install.ps1 | iex
partii login --email you@example.com                # emails a 6-digit code
partii login --email you@example.com --code 123456  # saves the sign-in for every later command
partii whoami
```

New emails get a free developer account. Until partii trusts the account, a game you publish goes to review first (usually under a day), only free games, and up to 5 projects and 20 games (`partii whoami` shows the limits). Building from source instead: `cargo build -p partii-cli` in `partii/platform`.

Which platform you use:

- **Production** (the default): https://api.partii.games.
- **Local** (everything on your machine): `partii dev up` (leave it running), then `export PARTII_API=http://127.0.0.1:8787`. It prints a ready-made publishable key for a built-in `demo` project, handy for a first multiplayer test; `partii dev key` mints more. Locally, purchases go through a fake store and logins are fake, so nothing needs Stripe or Apple, and an operator makes developers: `partii admin developers create --email you@example.com --admin-token dev-admin-token`.
- **Staging**: `export PARTII_API=https://api-staging.partii.games` (no email there: `partii login` returns the code).

`partii login` saves the API and token to `~/.config/partii/cli.json` (`PARTII_CONFIG` moves it; `partii logout` revokes and forgets it). Anything in the environment wins over the saved sign-in:

| Variable | What |
|---|---|
| `PARTII_API` | Platform URL (default `https://api.partii.games`) |
| `PARTII_TOKEN` | Your developer token (CI; `partii login --print-token` shows one) |
| `PARTII_KEY` | A publishable key (games and web pages ship this) |
| `PARTII_PLAYER_TOKEN` | A player's token (for player commands and tests) |
| `PARTII_ADMIN_TOKEN` | Platform operators only (`partii admin …`); locally `dev-admin-token` |

## 1. Project, key, game

```sh
partii projects put mystudio --name "My Studio"   # ids: lowercase letters and digits
partii keys create mystudio --key-id game         # reply: key.key = pk_mystudio_game_...
export PARTII_KEY=pk_mystudio_game_...
partii games put my-game --project mystudio --title "My Game" --platforms '["web"]'
```

When it's ready: `partii games publish my-game`. A new developer's game goes to review (`in_review: true`); `partii games get my-game` shows `review.status` (pending, approved, rejected) and `review.note` (what to fix). Approved, it's on https://partii.games and its site opens at https://my-game.partii.games; until then the site is reachable at its preview address (`partii web list my-game`).

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
| `player_token()`, `client()` | `Option<String>`, `Option<partii_api::Client>`: call any player operation (e.g. `ugcPublish`) as this player; calls block, so make them off the frame; ask again after `login` |
| `is_guest()`, `providers()` | `Option<bool>` (None until known), `Vec<String>` |
| `login(provider, fields)`, `take_login()` | `()`, `Option<Result<(), String>>`: link a provider; the guest becomes or merges into that account |
| `steam_browser_login()`, `take_browser_url()` | `()`, `Option<String>`: "Sign in through Steam" in the browser (no Steam key needed); open the URL, the outcome arrives via `take_login` |
| `submit_receipt(store, fields)`, `take_receipt()` | `()`, `Option<Result<(), (code, message)>>`: a platform-store purchase (App Store `{"transaction": Transaction.id}`, Play `{"purchase_token", "product_id"}`), verified and unlocked on every platform; also for restores. A purchase belongs to one partii account: a guest's moves to whoever restores it, a signed-in account's gives `claimed_by_another_account` |

**When `owns` is fresh.** Before `ready()`, `owns` returns last week's cached answer (or `None` on a fresh install). Once `ready()` is true it reflects the platform at sign-in. After a purchase made elsewhere (the browser, another device), call `refresh()`; `owns` updates when the answer arrives.

- **Sign-in.** On first launch the install becomes a guest player (a random device id kept in `data_dir`), with no form. Later `acct.login(provider, fields)` links Steam (`{"ticket": hex}`; add `"identity"` if you made the ticket with `GetAuthTicketForWebApi(identity)`), email (`{"email", "code"}`, after `playersEmailStart`), Apple or Google (`{"id_token"}`; Apple's `identity_token` works too), Game Center (`{"team_player_id", "bundle_id", "timestamp", "salt", "signature", "public_key_url"}` from `fetchItemsForIdentityVerificationSignature`, with salt and signature in base64, plus an optional `"alias"` as the display name. Silent on iOS: it's the same player on every device signed in to that Game Center account. In dev and staging, `{"team_player_id", "test": true}` signs in without a device.) or Discord (`{"code"}`). The guest becomes, or merges into, that account, so saves, purchases and votes follow the player to every device, and this device signs in to that account from then on. Show "Sign in to publish" while `is_guest()` is `Some(true)`.
- **Steam.** Two ways in, both reaching the same player. *Ticket:* `acct.login("steam", json!({"ticket": hex, "identity": "partii"}))` with a ticket from `GetAuthTicketForWebApi("partii")`. It is checked with **your game's own** Steamworks key, which you store once:
  ```sh
  partii secrets set <game> steam.web_api_key --value -     # paste the key, then Ctrl-D (stdin keeps it out of shell history)
  partii secrets set <game> steam.app_ids --value 4971410,4971420   # full game, demo, …
  ```
  Secrets are encrypted, tied to the game, and never shown again (`partii secrets list <game>` shows the last 4 characters). *Browser:* if the game has no key, `login` fails with `steam_not_set_up`. Call `acct.steam_browser_login()` instead and open the URL from `take_browser_url()`; the player signs in at steamcommunity.com and the game picks it up. This needs no key, so it works for any game.
- **Saves.** Named JSON slots per game. If another device wrote first, your `merge` function gets both copies and the merged result is written. Every write keeps a backup (`savesHistory`, `savesRestore`).
- **Offline.** The last entitlement answer is cached for a week, so a paid game stays unlocked without a network.
- **Tests.** Set `AccountConfig::player_token` (e.g. from `partii test players create`) to act as a specific player.

Under the hood these are plain API calls (`POST /v1/players/guest`, `PUT /v1/saves/{game}/{slot}` with `base_rev`, `GET /v1/players/me/entitlements?game=`), listed in [API.md](API.md); `partii-api` is a typed client for all of them if you need more.

### Leaderboards

Submit once per run, with a player token (guests count). Each board keeps every player's best for today, this week and all time. Days and weeks are UTC, and weeks start on Monday.

```ts
await api.leaderboardSubmit("rocket-to-heaven", "altitude", { score: 4200, meta: { play_time_seconds: 81.5, cause: "lava" } });
const top = await api.leaderboardGet("rocket-to-heaven", "altitude", { period: "daily", limit: 10 });
// top.entries: [{rank, player_id, display_name, score, meta, achieved_at}]
// top.me: your best and rank (with a player token), or null
// top.resets_at, top.players, top.total_plays
```

- **New boards** are created on the first submit, and higher scores win. For times, run `partii leaderboards config <game> <board> --higher-is-better false` before anyone submits.
- **Worse scores** count as a play but don't replace the player's best. `meta` (flat, 1 KB) is kept with the best score.
- **Signing in:** a guest's scores join the account it signs in to.
- **Cheaters:** `partii leaderboards remove <game> <board> <player>` removes a player's scores. Deleted players drop off.

### Player content: levels, worlds, replays

Players can publish what they make so that anyone can browse and download it. Only the author can change or unpublish it. Every call is in [API.md](API.md) under `ugc*`; reads take your key, and writes take the player token too.

1. **Upload by hash.** `POST /v1/games/{game}/ugc/uploads` with `{kind: "file" | "thumbnail", size, sha256}` (hex). If that hash is already stored you get `exists: true`; skip to step 2. Otherwise PUT the bytes to `upload.url` with exactly `upload.headers` and no auth headers; the URL is good for an hour. The platform checks the hash, so other bytes are refused.
2. **Publish.** `POST /v1/games/{game}/ugc` with `{kind: "level" | "world" | "replay", title, description, tags, visibility: "public" | "unlisted", sha256, client_version, thumbnail_sha256?, refs?}`. A World lists the exact Level file hashes it uses in `refs`. Each of those hashes must already be uploaded to this game.
3. **New versions.** `POST /v1/ugc/{id}/versions` with `{sha256, client_version, notes?, refs?}`. Old versions stay downloadable by hash, so a World that pins one keeps working.
4. **Browse.** `GET /v1/games/{game}/ugc?sort=new|top|played&kind=&tags=a,b&q=&author=&limit=&cursor=`. Pass `next_cursor` back as `cursor` to get the next page. Unlisted items never appear here; find them with `GET /v1/games/{game}/ugc/code/{share_code}` (every item has a six-character code). To fetch one item use `GET /v1/ugc/{id}`, which includes every version. With a player token, `my_vote` is included.
5. **Download** from `download_url` or `thumbnail_url` (public; cache them forever, since they are addressed by hash). `GET /v1/games/{game}/ugc/hash/{sha256}` says which items and versions a hash belongs to.
6. **Votes and plays.** `PUT /v1/ugc/{id}/vote {value: 1 | -1 | 0}` (one vote per player). `POST /v1/ugc/{id}/plays` is fire and forget; `plays` counts players, not launches.
7. **Unpublish, reports, moderation.** The author calls `DELETE /v1/ugc/{id}`. The item leaves browse and lookups, but its files stay downloadable by hash while Worlds pin them. Players report with `POST /v1/ugc/{id}/report {reason}`. You review reports with `partii ugc reports <game>` and hide or restore an item with `partii ugc moderate <id> --action hide --reason "…"`. Hiding removes the item's files too.

Rules: only signed-in players can publish; guests can browse, download, vote and play, and their votes follow them when they sign in. Files are capped at 5 MB, thumbnails are PNG up to 256 KB, and each player gets 300 items per game. Per player per hour: 30 publishes or versions, 60 uploads, 300 votes and 20 reports. Deleting an account unpublishes its items.

## 4. Sell it

```sh
partii games put mygame --project mystudio --title "My Game" --tagline "One line" \
  --description "What it is." --price-cents 499 \
  --field 'platforms=["macos","windows","ios","android"]' \
  --field 'demo={"free_levels":20}'                   # a free part; `demo=null` = no free part (the whole game is paid)
partii builds upload mygame --platform macos --version 1.0.0 --file MyGame.dmg   # optional for publishing; any size
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
- In the App Store or Google Play (Apple requires it for unlocking inside an iPhone app): buy with StoreKit 2 / Play Billing, then `acct.submit_receipt("appstore", json!({"transaction": id}))` and wait for `acct.take_receipt()`; finish the store transaction only after `Ok`. For restores, submit each of StoreKit's current entitlements the same way. TestFlight and App Review buy in Apple's sandbox; those purchases unlock too (marked as test purchases).
- Purchases made in the App Store, Google Play or Steam: send them to `playersReceipt`. partii verifies them with the store.

Test without paying:

```sh
partii test players create --name Tester            # → player id + player_token
partii test purchase --game mygame --player p_...   # Stripe test mode, or the fake store locally
partii sales mygame                                  # purchases and totals (gross_cents counts real sales only; test purchases are test_count)
```

Uploads go straight to storage: the CLI gets a signed URL (`buildsUploadStart`), PUTs the file with its sha256 (storage refuses bytes that don't match), then records it (`buildsUploadFinish`). Locally, `partii dev` takes the file through the API instead; the command is the same.

Body fields are also flags: `--price-cents 500` and `--field price_cents=500` are the same; use `--field` for JSON values (lists, objects, `null`).

## 5. Live content

```sh
partii content push mygame --version 2026.10.12 --field 'files={"levels/1.json":"<base64>"}'
```

Games read `GET /v1/content/{game}/manifest` at launch and fetch changed files by hash (`contentFile`). Levels, tuning and scripts update without a store release.

## 6. Phone controllers

When the game hosts a room, show a QR code for:

```
<controller page>/c/<ROOM CODE>?k=<publishable key>&e=<platform URL>&g=<game id>
```

Each game builds its own controller page: controllers need the game's own states, layouts and art. Start from `platform/apps/controller` (sticks, buttons, joining, sign-in; React + the engine's wasm) and host yours with `partii web deploy <game> ./dist --spa` (§7), so the QR code points at `https://<game>.partii.games/c/<CODE>?…`. The phone joins as a member of kind `phone` and streams input frames (10 bytes, about 30 times a second; [CONTROLLER.md](CONTROLLER.md)):

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

Make the page look like your game with a theme (colours, fonts, button lips, logo): `partii theme set <game> --body @theme.json` after uploading its files with `partii theme file`. The format is in [CONTROLLER.md](CONTROLLER.md#looking-like-the-game).

## 7. Host a site: browser games and controllers

Any static folder (a browser build of the game, a phone controller, a page) goes online at `https://<game>.partii.games`:

```sh
partii web deploy hexii ./dist                    # live at https://hexii.partii.games
partii web deploy tankii ./controller/dist --spa  # client-side routes (/c/CODE) serve index.html
partii web deploy hexii ./dist --no-activate      # upload, preview at the preview_url, then:
partii web activate hexii <deploy id>             # go live (also how you roll back)
partii web list hexii                             # deploys, which is live, preview links
partii web take-down hexii
```

- The folder needs `index.html` at its top. Dotfiles are skipped, except a top-level `.well-known` (iOS universal links, Android app links). Up to 10,000 files, 100 MB each, 1 GB per deploy.
- Only changed files upload (files are stored by their hash), straight to storage.
- `--spa`: a path with no file serves the nearest `index.html` above it, so `/controller/c/ABCD` gets `/controller/index.html`.
- `--isolated`: cross-origin isolation headers, which threaded wasm needs (Godot 4, Unity with threads, Emscripten pthreads). Everything on the site must then be same-origin or CORS-enabled.
- `404.html` at the top is served for missing pages. Unity's `.br`/`.gz` build files are served with the right encoding.
- HTML is revalidated on every load; other files are cached for a minute, so a new deploy shows up within a minute.
- Each game's site is its own origin. Call the partii API from it with your publishable key like any web app (`https://api.partii.games`).
- Staging: `https://<game>-staging.partii.games` (with `PARTII_API=https://api-staging.partii.games`).

## 8. Analytics: players, events, errors

The account crate sends events and error reports; partii.games/dev shows them (sign in with a developer token, `partii tokens create`).

```rust
partii_account::install_panic_hook(&save_dir);   // first thing in main
let acct = Account::start(AccountConfig {
    version: env!("CARGO_PKG_VERSION").into(),
    build: "steam".into(),                        // or "demo", "appstore", …; platform is filled in
    analytics: settings.share_stats,              // the player's "Share anonymous stats" switch (on by default)
    ..cfg
});
acct.set_owned(acct.owns("full") == Some(true)); // the dashboard's demo/full filter
acct.track("level_complete", json!({ "mission": 12, "secs": 81.5, "players": 2 }));
acct.report_error("error", "save failed", None, json!({ "screen": "pause" }));
acct.end_session(Duration::from_secs(2));         // on quit: session_end {secs}, then send
```

| Call | |
|---|---|
| `track(name, props)` | Queue an event. Names are `[a-z][a-z0-9_.]*`. Props are flat: strings up to 200 characters, numbers and bools, 1 KB in all. Sent every 30 s. |
| `report_error(kind, message, backtrace, context)` | `kind` is `panic`, `error` or `warning`. Sent at once. Reports of the same bug group together, even when the numbers in the message differ. |
| `install_panic_hook(dir)` | Writes panics to `dir`. A panic is reported straight away if the game survives it, otherwise at the next launch. |
| `set_analytics(on)`, `set_owned(full)` | The player's switch (off drops what's queued). Demo or full game. |
| `end_session(wait)` | Sends `session_end` and the queue, waiting at most `wait`. Returns `true` when everything went. Whatever is left (for example while offline) is kept on disk and sent next launch. |
| `session_id()` | This launch's id; every event and report carries it. |

The dashboard and the CLI show the same numbers. The CLI takes the same filters: `--days`, `--platform`, `--version` and `--owned true|false`.

```sh
partii analytics summary tankii                      # players today, last 7 and last 30 days; new vs returning; sessions and median length; D1/D7/D30 retention; by platform, version and country
partii analytics events tankii                       # every event name, with counts and players
partii analytics events tankii --name level_complete --by mission   # the funnel: players per mission
partii errors list tankii                            # open error groups: count, players, versions, last seen
partii errors get tankii <fingerprint>               # the latest reports, with backtraces and context
partii errors mark tankii <fingerprint> --status fixed   # reopens by itself if it comes back
```

- **Sessions** are one launch each. Their length comes from `session_end` (from the first to the last event if the game was killed).
- **Retention:** of the players first seen in the range, the share who played again exactly 1, 7 or 30 days later.
- **Privacy:** no IP addresses are stored, only the country. Raw events are kept 90 days. A device is the game's random install id. If the player deleted their account, their events stay but no longer link to them. What's collected is listed at partii.games/privacy; link to it from your game's settings next to the switch.
- **Limits:** 100 events and 20 errors per call, and 60 calls a minute per device. The crate stays well under these.

## 9. Errors

Every failure is `{"ok": false, "error": {"code", "message", "hint"}}`, and the hint says what to do. CLI exit codes:

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | the platform said no |
| 2 | a bad command line |

## Checklist for a new game

1. Project and key (section 1).
2. Engine in the game: host and join with a code (section 2). Check with `partii bot guest`.
3. `partii-account` at launch: guest sign-in, saves, `owns("full")` (section 3); `install_panic_hook`, a few `track` events and `end_session` on quit (section 8).
4. Store page, price and demo gate; the game checks entitlements (section 4).
5. Optional: phone controllers (section 6) and live content (section 5).
