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

- **Local** (everything on your machine): `partii dev up` (leave it running). It prints its URL and a dev key. Fake stores and logins are on.
- **Staging** or **production**: set `PARTII_API` to its URL.

Credentials come from the environment:

| Variable | What |
|---|---|
| `PARTII_API` | Platform URL (default `http://127.0.0.1:8787`) |
| `PARTII_TOKEN` | Your developer token |
| `PARTII_KEY` | A publishable key (games and web pages ship this) |
| `PARTII_PLAYER_TOKEN` | A player's token (for player commands and tests) |

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

## 2. Multiplayer in a Rust game

Add the engine (path or git dependency on `partii/platform/crates/partii-engine`). It runs its own threads, and nothing blocks your frame:

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

// Later, from a menu (the engine connects at once; create/join right away is fine):
let req = engine.create("mygame", Some(4), "game", "Alice", serde_json::json!({}));
// or: engine.join("KXQPT", "game", "Bob", serde_json::json!({}));

// Every frame:
for ev in engine.poll() {
    match ev {
        Event::Created { room, .. } => show_code(&room.code),   // 5 capital letters
        Event::Joined { room, .. } => { /* you are room.you; the host is room.host */ }
        Event::Failed { code, message, .. } => show_error(&code, &message), // not_found, full, offline, …
        Event::PeerConnected { mid, .. } => { /* member `mid` can receive now */ }
        Event::MemberLeft { mid, .. } => { /* gone */ }
        Event::Message { from, reliable, bytes } => handle(from, reliable, &bytes),
        Event::RoomClosed { .. } => back_to_menu(),
        _ => {}
    }
}
engine.send(mid, false, input_bytes);     // unreliable: positions, inputs
engine.send(mid, true, event_bytes);      // reliable and ordered: chat, joins, round results
engine.send(BROADCAST, true, bytes);      // everyone else in the room
```

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

Each install signs in as a guest at first launch, with no form. Keep a random device id in your save folder:

```
POST /v1/players/guest  {"device_id": "<random, kept per install>", "display_name": "Player"}
   → {player, player_token}
```

From Rust, use `partii-api`, a typed client for every operation in [API.md](API.md):

```rust
let api = partii_api::Client { base, key: Some(pk), ..Default::default() };
let r = api.json("playersGuest", &[], Some(json!({"device_id": id, "display_name": "Player"})))?;
let token = r["player_token"].as_str().unwrap();
```

Later, a player can sign in with email (`playersEmailStart`, then `playersLogin` with `provider: "email"` and the code), Apple, Google, Discord or Steam. Send the current guest token along: the guest becomes, or merges into, that account. So their saves and purchases follow them to every device.

Saves are named slots of JSON per game:

```
PUT  /v1/saves/{game}/{slot}  {"base_rev": <rev you last read, or 0>, "data": {...}}
GET  /v1/saves/{game}/{slot}  → {save: {rev, data}}
```

If another device wrote first, the PUT answers **409** with both copies (`theirs`, `yours`). Merge them and write again with `base_rev = theirs.rev`. Every write keeps a backup; see `savesHistory` and `savesRestore`.

## 4. Sell it

```sh
partii games put mygame --project mystudio --title "My Game" --tagline "One line" \
  --description "What it is." --price-cents 499 \
  --field 'platforms=["macos","windows","ios","android"]' \
  --field 'demo={"free_levels":20}'                   # optional free part; null for none
partii builds upload mygame --platform macos --version 1.0.0 --file MyGame.dmg
partii games publish mygame                           # now on the store
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

- `storeCheckout` returns a URL. Open it in the browser, then check entitlements again once the player is back.
- Purchases made in the App Store, Google Play or Steam: send them to `playersReceipt`. partii verifies them with the store.

Test without paying:

```sh
partii test players create --name Tester            # → player id + player_token
partii test purchase --game mygame --player p_...   # Stripe test mode, or the fake store locally
partii sales mygame                                  # purchases and totals
```

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
3. Guest sign-in at launch; saves through `/v1/saves` (section 3).
4. Store page, price and demo gate; the game checks entitlements (section 4).
5. Optional: phone controllers (section 6) and live content (section 5).
