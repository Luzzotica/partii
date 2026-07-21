# Party API — Developer Reference

Partii provides a REST-based signaling and session management API for building phone-controller multiplayer party games. Any game that can make HTTP requests — Godot, Unity, a browser, a native app — can use it.

**Base URL:** `https://your-deployment.vercel.app` (or `http://localhost:3000` locally)

---

## How It Works

```
Your Game (PC/TV)                   Partii API                    Phone Browser
─────────────────                   ──────────────                ─────────────
POST /api/party/sessions        →   Creates session
← { session_id, join_code,
    host_secret, expires_at }

Show join_code + QR on screen
                                                              User scans QR code
                                                              Opens your controller URL
                                                              POST /api/party/sessions/{id}/players
                                                              ← { player_id, player_secret, slot }

GET /api/party/sessions/{id}   →   Shows new player joined
← { players: [...] }

POST /api/party/signals             host sends offer SDP
                                                              GET /api/party/signals (polling)
                                                              ← finds offer

                                                              POST /api/party/signals
                                                              controller sends answer SDP

GET /api/party/signals (polling)
← finds answer, ICE candidates
                                                              GET /api/party/signals (polling)
                                                              ← finds ICE candidates

══════════════ WebRTC P2P connected — all game data flows directly ══════════════
```

Once WebRTC is connected, this API is no longer involved. All game input flows peer-to-peer.

---

## Authentication

This API uses **shared secrets** generated at creation time — no accounts or API keys required.

| Caller | Credential | How to use |
|---|---|---|
| **Game host** | `host_secret` (UUID) | Include in the request body of mutating session calls. |
| **Phone controller** | `player_secret` (UUID) | Include in the request body of mutating player calls, along with `sender_player_id`. |

**Critical:** Both secrets are returned **exactly once** — in the HTTP response that creates them. Store them immediately; they cannot be retrieved again.

```
POST /api/party/sessions       → returns host_secret once
POST /sessions/{id}/players    → returns player_secret once
```

The secrets are verified server-side and are never stored in a way that's readable by clients. The signal polling endpoint (`GET /signals`) is intentionally unauthenticated — recipient IDs are not secrets, and signal payloads are ephemeral and useless without an established WebRTC connection.

---

## Setup

### Environment variables

The API uses Supabase under the hood. No extra env vars are needed beyond what the main app already requires:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # required — API routes use the service role
```

### Database migration

Run once to create the required tables:

```bash
# Local development
npx supabase db reset

# Or push to hosted Supabase
npx supabase db push
```

The migration creates three tables: `party_sessions`, `party_players`, `party_signaling`, plus SQL functions for atomic slot assignment and cleanup.

### Automatic cleanup

A Vercel cron job runs every 5 minutes and calls `GET /api/party/cleanup` to purge:
- Signaling rows older than 60 seconds
- Sessions older than 2 hours (or that were explicitly ended)

This is configured in `vercel.json` and requires no action. On non-Vercel deployments, schedule `GET /api/party/cleanup` manually.

### CORS

All `/api/party/*` endpoints return `Access-Control-Allow-Origin: *`. Phone controller UIs served from any domain can call the API directly from the browser.

---

## Endpoints

### Sessions

#### `POST /api/party/sessions`

Create a new party session. Call this when your game starts and wants to accept players.

**Request body** (all fields optional):
```json
{
  "game_id": "my-godot-platformer",
  "max_players": 4,
  "metadata": { "map": "forest", "mode": "co-op" }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `game_id` | string | `""` | Identify your game. Up to 100 chars. |
| `max_players` | number | `8` | Clamped to 1–16. |
| `metadata` | object | `{}` | Store any game-specific config here. |

**Response `201`:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "join_code": "XKZMPQ",
  "host_secret": "a3f2c1b4-...",
  "expires_at": "2026-04-19T02:00:00Z"
}
```

> **Store `host_secret` immediately.** It is not retrievable after this response.

---

#### `GET /api/party/sessions/{session_id}`

Read the current state of a session, including the player list.

**Response `200`:**
```json
{
  "session_id": "550e...",
  "join_code": "XKZMPQ",
  "game_id": "my-game",
  "status": "waiting",
  "max_players": 4,
  "player_count": 1,
  "players": [
    {
      "player_id": "abc123...",
      "display_name": "Alice",
      "slot": 1,
      "status": "joined",
      "joined_at": "2026-04-19T00:01:00Z",
      "metadata": {}
    }
  ],
  "metadata": { "map": "forest" },
  "created_at": "2026-04-19T00:00:00Z",
  "expires_at": "2026-04-19T02:00:00Z"
}
```

**Error `404`:** Session not found or has been purged.

---

#### `PATCH /api/party/sessions/{session_id}`

Update session status or metadata. Requires `host_secret`.

**Request body:**
```json
{
  "host_secret": "a3f2c1b4-...",
  "status": "ended",
  "metadata": { "winner": "Alice" }
}
```

| Field | Type | Notes |
|---|---|---|
| `host_secret` | string | **Required.** Must match the value returned at creation. |
| `status` | `"active"` \| `"ended"` | Transition the session. Use `"ended"` to cleanly close. |
| `metadata` | object | Overwrites the current metadata. |

**Response `200`:** `{ "ok": true }`

**Errors:** `400` missing secret · `403` wrong secret · `404` session not found

---

### Players

#### `POST /api/party/sessions/{session_id}/players`

Join a session as a controller. Call this from the phone browser after the player enters their name.

**Request body:**
```json
{ "display_name": "Alice" }
```

`display_name` is optional (defaults to `"Player"`), trimmed to 24 characters.

**Response `201`:**
```json
{
  "player_id": "abc123...",
  "player_secret": "d4e5f6...",
  "slot": 1,
  "display_name": "Alice"
}
```

> **Store `player_secret` immediately**, e.g. in `sessionStorage`. It is not retrievable.
> `slot` is the player's number (1-based) — use it for team assignment, colors, etc.

**Errors:** `404` session not found or ended · `409` session is full

---

#### `GET /api/party/sessions/{session_id}/players`

List all players in a session. No auth required.

**Response `200`:**
```json
{
  "players": [
    { "player_id": "abc...", "display_name": "Alice", "slot": 1, "status": "joined", "joined_at": "...", "metadata": {} }
  ]
}
```

---

#### `PATCH /api/party/sessions/{session_id}/players/{player_id}`

Update a player's status or metadata. Called by the phone controller.

**Request body:**
```json
{
  "player_secret": "d4e5f6...",
  "status": "connected",
  "metadata": { "team": "blue" }
}
```

| Field | Notes |
|---|---|
| `player_secret` | **Required.** |
| `status` | `"connected"` or `"disconnected"`. |
| `metadata` | Overwrites player metadata. Host can also set team/character info by calling the session PATCH. |

**Response `200`:** `{ "ok": true }`

**Errors:** `400` missing secret · `403` wrong secret · `404` player not found

---

### Signals

This is the WebRTC handshake exchange. The host and controllers take turns posting signals and polling for responses until RTCPeerConnection state reaches `"connected"`.

#### `POST /api/party/sessions/{session_id}/signals`

Send a WebRTC signal (offer, answer, or ICE candidate).

**Request body — from host:**
```json
{
  "host_secret": "a3f2c1b4-...",
  "recipient_id": "abc123...",
  "signal_type": "offer",
  "payload": { "type": "offer", "sdp": "v=0\r\no=..." }
}
```

**Request body — from controller:**
```json
{
  "player_secret": "d4e5f6...",
  "sender_player_id": "abc123...",
  "recipient_id": "host",
  "signal_type": "answer",
  "payload": { "type": "answer", "sdp": "v=0\r\no=..." }
}
```

| Field | Notes |
|---|---|
| `host_secret` / `player_secret` | Provide exactly one. |
| `sender_player_id` | Required when using `player_secret`. |
| `recipient_id` | `"host"` or a `player_id` UUID. |
| `signal_type` | `"offer"` \| `"answer"` \| `"ice_candidate"` |
| `payload` | The raw SDP or ICE JSON from your WebRTC engine. |

**Response `201`:** `{ "signal_id": 42 }`

**Errors:** `400` invalid/missing fields · `403` wrong secret · `404` session/player not found

---

#### `GET /api/party/sessions/{session_id}/signals`

Poll for signals. Call this on a loop (every 1–2 seconds) until WebRTC connects.

**Query params:**

| Param | Required | Notes |
|---|---|---|
| `recipient_id` | Yes | `"host"` or your `player_id`. |
| `since_id` | No | Cursor — only return signals with `id > since_id`. Default `0`. |
| `limit` | No | Max rows to return. Default `20`, max `50`. |

**Response `200`:**
```json
{
  "signals": [
    {
      "signal_id": 5,
      "sender_id": "host",
      "signal_type": "offer",
      "payload": { "type": "offer", "sdp": "v=0\r\n..." },
      "created_at": "2026-04-19T00:00:01Z"
    }
  ],
  "next_since_id": 5
}
```

**Polling pattern:** Save `next_since_id` and pass it as `since_id` on the next request. When the array is empty, `next_since_id` is unchanged. No auth required.

---

## Integration Examples

### Godot (GDScript)

```gdscript
# ─── 1. Create session ───────────────────────────────────────────────────────
var http = HTTPRequest.new()
add_child(http)

var headers = ["Content-Type: application/json"]
var body = JSON.stringify({ "game_id": "my-game", "max_players": 4 })
http.request("https://your-app.vercel.app/api/party/sessions", headers, HTTPClient.METHOD_POST, body)

var result = await http.request_completed
var response = JSON.parse_string(result[3].get_string_from_utf8())

var session_id = response.session_id
var host_secret = response.host_secret  # store this
var join_code  = response.join_code     # show to players

# ─── 2. Poll for players ────────────────────────────────────────────────────
# Call periodically (e.g. every 1s) until players join
func poll_players():
    var url = "https://your-app.vercel.app/api/party/sessions/" + session_id
    http.request(url)
    var res = await http.request_completed
    var data = JSON.parse_string(res[3].get_string_from_utf8())
    for player in data.players:
        if not _known_players.has(player.player_id):
            _known_players[player.player_id] = player
            _start_webrtc_for(player.player_id)   # create RTCPeerConnection

# ─── 3. Send offer ──────────────────────────────────────────────────────────
func send_offer(player_id: String, sdp: String):
    var body = JSON.stringify({
        "host_secret": host_secret,
        "recipient_id": player_id,
        "signal_type": "offer",
        "payload": { "type": "offer", "sdp": sdp }
    })
    var url = "https://your-app.vercel.app/api/party/sessions/" + session_id + "/signals"
    http.request(url, headers, HTTPClient.METHOD_POST, body)

# ─── 4. Poll for answers and ICE ────────────────────────────────────────────
var since_id := 0

func poll_signals():
    var url = ("https://your-app.vercel.app/api/party/sessions/" + session_id
               + "/signals?recipient_id=host&since_id=" + str(since_id))
    http.request(url)
    var res = await http.request_completed
    var data = JSON.parse_string(res[3].get_string_from_utf8())

    for signal in data.signals:
        match signal.signal_type:
            "answer":
                _peer_connections[signal.sender_id].set_remote_description("answer", signal.payload.sdp)
            "ice_candidate":
                _peer_connections[signal.sender_id].add_ice_candidate(
                    signal.payload.sdpMid,
                    signal.payload.sdpMLineIndex,
                    signal.payload.candidate
                )
    since_id = data.next_since_id

# ─── 5. End session ─────────────────────────────────────────────────────────
func end_session():
    var body = JSON.stringify({ "host_secret": host_secret, "status": "ended" })
    var url = "https://your-app.vercel.app/api/party/sessions/" + session_id
    http.request(url, headers, HTTPClient.METHOD_PATCH, body)
```

---

### Browser / TypeScript (using the built-in SDK)

The SDK is at `src/party/` and can be imported directly in any TypeScript project that lives alongside or copies these files.

```typescript
import { createHostSession, joinAsController } from "@/src/party";

// ─── Host (desktop game) ─────────────────────────────────────────────────────
const { result, manager, signaling } = await createHostSession(
  { baseUrl: "https://your-app.vercel.app" },
  { game_id: "my-browser-game", max_players: 4 },
  {
    onPlayerJoined: (player) => {
      console.log(`${player.display_name} joined (slot ${player.slot})`);
      manager.connectToPlayer(player.player_id);
    },
    onPlayerConnected: (playerId) => {
      console.log(`WebRTC connected: ${playerId}`);
    },
    onMessage: (playerId, data) => {
      // Parse game input from controller
      const input = JSON.parse(data as string);
      handleInput(playerId, input);
    },
  }
);

console.log("Share this code:", result.join_code);

// Poll for new players manually (or integrate with your game loop)
setInterval(async () => {
  const session = await signaling.getSession(result.session_id);
  for (const player of session.players) {
    manager.connectToPlayer(player.player_id);  // idempotent
  }
}, 1000);

// ─── Controller (phone browser) ──────────────────────────────────────────────
const { result: joinResult, manager: ctrlManager } = await joinAsController(
  { baseUrl: "https://your-app.vercel.app" },
  sessionId,    // from URL param e.g. ?session=XKZ9Q2
  "Alice",
  {
    onConnected: () => {
      console.log("WebRTC connected to host!");
    },
    onMessage: (data) => {
      // Host can send config or game state down to controller
      const msg = JSON.parse(data as string);
      renderControllerUI(msg.config);
    },
  }
);

// Send input at 60fps
setInterval(() => {
  ctrlManager.send(JSON.stringify({
    joystick: { x: joystickX, y: joystickY },
    buttons: { a: buttonAPressed }
  }));
}, 16);
```

---

## Signal Flow Reference

```
Host                              API                           Controller
 │                                 │                                │
 │ POST /sessions                  │                                │
 │ ─────────────────────────────►  │                                │
 │ ◄── { session_id, join_code,    │                                │
 │        host_secret }            │      (user scans QR)           │
 │                                 │                                │
 │                                 │ ◄──── POST /players ───────── │
 │                                 │ ────── { player_id,            │
 │                                 │          player_secret } ─────►│
 │                                 │                                │
 │ GET /sessions/{id} (polling)    │                                │
 │ ◄── players: [player_id=abc] ── │                                │
 │                                 │                                │
 │ POST /signals                   │                                │
 │ { host_secret, recipient: abc,  │                                │
 │   type: offer, payload: SDP }   │                                │
 │ ─────────────────────────────►  │                                │
 │                                 │                                │
 │ POST /signals (ICE)             │    GET /signals?recipient=abc  │
 │ ─────────────────────────────►  │ ───────────────────────────── │
 │                                 │ ◄── { signals: [offer, ICE] } ─│
 │                                 │                                │
 │                                 │ ◄── POST /signals ──────────── │
 │                                 │   { player_secret, type:answer}│
 │                                 │                                │
 │ GET /signals?recipient=host     │ ◄── POST /signals (ICE) ───── │
 │ ◄── { signals: [answer, ICE] }  │                                │
 │                                 │                                │
 │═══════════════════ WebRTC P2P connected ════════════════════════│
```

---

## Known Limitations

| Issue | Notes |
|---|---|
| **Symmetric NAT (~15% failure rate)** | STUN alone won't work on corporate/university networks or some mobile carriers. Add a TURN server to your `RTCConfiguration.iceServers` for production. (Twilio Network Traversal Service or self-hosted coturn.) |
| **Signal TTL is 60 seconds** | If your polling loop is stopped for more than 60 seconds during handshake, signals will be purged. Resume polling before then. |
| **Session TTL is 2 hours** | Sessions auto-expire. Extend by keeping the session active (`status: "active"`) and re-creating if needed. |
| **No per-player controller config** | `party_players.metadata` is available for host to store player-specific data, but there is no built-in "controller layout per player" — implement this in your controller UI using session metadata. |
| **Max 16 players per session** | Enforced at the API level. |

---

## Running Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests are in `tests/party/` and use vitest with a mocked Supabase admin client. They cover all endpoints including auth, error paths, and edge cases (join code collision, full session, cursor pagination, etc.).
