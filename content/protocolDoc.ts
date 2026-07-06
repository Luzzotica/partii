// GENERATED from packages/party-kit/PROTOCOL.md — edit there, then run scripts/sync-party-kit.mjs
export const PROTOCOL_MD = `# Arcadii Multiplayer Protocol — engine-neutral wire spec (v1)

This document specifies everything a client needs to implement arcadii multiplayer
on ANY platform (web, Godot, Unreal, Unity, native). The TypeScript reference
implementation lives in \`packages/party-kit/src/\`; this spec is authoritative for
non-TS clients. See \`CLIENT_PROMPT.md\` for generating a client with an LLM.

Base URL: configured per game (\`PARTY_API_URL\`, e.g. \`https://www.sterlinglong.me\`).
All bodies are JSON. All responses include permissive CORS headers.

## 1. Authentication

### 1.1 Credentials
- **API key** (\`mpk_live_…\`): identifies the game project. Ships in the client.
  Sent as \`X-API-Key: <key>\` on requests. **This alone is a complete, working
  auth setup** — new projects need nothing else.
- **Session token** (optional hardening): short-lived HS256 JWT from the token
  exchange (§1.2), sent as \`Authorization: Bearer <token>\`. Projects that opt
  into enforcement (a per-project setting) reject raw keys on gameplay routes;
  until then both work. Requires attestation configuration on the project.
- **Room token**: per-room scoped JWT returned by room create/join. Used by the
  realtime signal gateway (§5) and any room-scoped surface. Automatic — no setup.

### 1.2 Token exchange — \`POST /api/auth/token\` (optional hardening)
Headers: \`X-API-Key\`. Body:
\`\`\`json
{
  "platform": "web" | "steam" | "dev" | "mobile",
  "attestation": "<turnstile token | steam auth-session ticket hex>",
  "steam_id": "<optional claimed steamid64, steam only>",
  "device_id": "<stable client-generated uuid, for anonymous identity>"
}
\`\`\`
Response \`200\`:
\`\`\`json
{ "session_token": "<jwt>", "token_type": "Bearer", "expires_in": 600,
  "player_id": "steam:<id64>" | "anon:<device_id>" }
\`\`\`
Rules:
- Refresh proactively 30s before \`expires_in\` elapses. Cache one in-flight
  refresh (never mint concurrently).
- On exchange failure: back off ≥60s and fall back to \`X-API-Key\` on subsequent
  requests (until enforcement turns on). NEVER retry the exchange per-request.
- \`device_id\`: generate a UUID once, persist it (localStorage / config file);
  it makes \`player_id\` stable for telemetry/attribution.
- Errors: \`401\` bad key; \`403\` origin not allowed or attestation failed; \`429\` rate limited.

## 2. Rooms

### 2.1 Create — \`POST /api/rooms\`
Body:
\`\`\`json
{ "game_id": "<game>", "display_name": "…", "host_kind": "screen",
  "max_peers": 8, "password": "…", "visibility": "public"|"private",
  "metadata": { } }
\`\`\`
Response \`201\`:
\`\`\`json
{ "room_id": "<uuid>", "join_code": "ABCD", "host_secret": "…",
  "host_peer_id": "<uuid>", "host_peer_secret": "…", "expires_at": "<iso>",
  "room_token": "<jwt: {t:'room', rid, peer:'host', role:'host', exp}>",
  "ice_servers": [ { "urls": [ "stun:…", "turn:…?transport=udp", … ],
                     "username": "…", "credential": "…" } ] }
\`\`\`

### 2.2 Join — \`POST /api/rooms/{roomId}/peers\`
Body: \`{ "kind": "screen"|"phone", "display_name": "…", "password": "…", "metadata": {} }\`
Response \`201\`: \`{ "peer_id", "peer_secret", "room_token", "slot", "kind",
"display_name", "ice_servers" }\`
Errors: \`404\` not found, \`409\` full, \`423\` not joinable.

### 2.3 Discovery
- \`GET /api/rooms?game_id=X\` → \`{ rooms: [{ room_id, join_code, display_name,
  status, max_peers, peer_count, … }] }\` (public+joinable only, max 50).
- \`GET /api/rooms/lookup?code=ABCD\` → single room by join code (uppercase).

### 2.4 Lifecycle
- \`PATCH /api/rooms/{roomId}\` body \`{ host_secret, status|visibility|joinable|max_peers|metadata }\`.
- \`DELETE /api/rooms/{roomId}\` body \`{ host_secret }\` ends the room. Send with
  keepalive semantics on shutdown; a server cron sweeps stragglers at \`expires_at\`.
- \`DELETE /api/rooms/{roomId}/peers/{peerId}\` body \`{ peer_secret }\` on leave.

## 3. Signaling (WebRTC handshake relay)

Signals are durable rows with a monotonically increasing serial \`id\` per room.

### 3.1 Send — \`POST /api/rooms/{roomId}/signals\`
Body:
\`\`\`json
{ "recipient_peer_id": "<peer uuid | 'host'>",
  "signal_type": "offer" | "answer" | "ice_candidate",
  "payload": { … },
  "host_secret": "…"            // when sending AS the host
  // or: "sender_peer_id": "…", "peer_secret": "…"   (as a joiner)
}
\`\`\`
- The HOST is always addressed as the literal peer id \`host\`.
- Payloads: offer/answer \`{ "type": "offer"|"answer", "sdp": "…" }\`;
  ice_candidate = the standard RTCIceCandidate JSON (\`candidate\`, \`sdpMid\`,
  \`sdpMLineIndex\`, \`usernameFragment\`).

### 3.2 Receive (poll) — \`GET /api/rooms/{roomId}/signals?recipient_peer_id=X&since_id=N&limit=50\`
Response: \`{ "signals": [{ "signal_id", "sender_peer_id", "signal_type",
"payload", "created_at" }], "next_since_id": N }\`.
- Poll every **1500ms** (baseline). Persist \`next_since_id\` as the cursor.
- **Keep polling for the entire session** — mid-game ICE restarts arrive here.
- **Dedupe by \`signal_id\`** — the push path (§5) delivers the same rows; apply
  each signal at most once (cursor: only process ids > last-applied).

## 4. WebRTC transport

### 4.1 Channel topology (by remote peer \`kind\`)
| kind    | reliable channel | unreliable channel |
|---------|------------------|--------------------|
| screen  | \`state\` (ordered) | \`input\` (\`ordered:false, maxRetransmits:0\`) |
| phone   | \`data\` (ordered)  | \`input\` (same) |
| default | \`data\` (ordered)  | — |
Binary type MUST be arraybuffer. The **offerer creates the channels**; the
answerer accepts them. High-rate traffic (inputs, snapshots) goes on \`input\`;
app-level redundancy/sequencing recovers loss. Reliable channels are for
lobby/roster/critical state only.

### 4.2 Roles + handshake
- Offerer = whichever side the app designates (host↔guest pairs: host offers to
  screens, guests offer to the host — follow the reference: the JOINING side of
  a pair is told its role by app logic; both roles must be implemented).
- Trickle ICE: send the offer/answer immediately, then each ICE candidate as
  its own \`ice_candidate\` signal. Buffer remote candidates that arrive before
  \`setRemoteDescription\`; flush after.
- Use the \`ice_servers\` from YOUR room create/join response (they contain
  short-TTL credentials minted for you). Never hardcode TURN.

### 4.3 Timeouts + recovery ladder (normative constants)
- \`CONNECT_TIMEOUT_MS = 15000\` per connection attempt (polling signaling).
- On \`connectionState\`/\`iceConnectionState\` = \`failed\`|\`disconnected\` AFTER
  being connected: do NOT tear down. Start recovery:
  1. Arm a \`RECOVERY_GRACE_MS = 10000\` timer.
  2. Offerer sends an ICE-restart offer (\`iceRestart: true\`); the answerer
     re-answers when it receives an offer while already connected. Max
     \`MAX_ICE_RESTARTS = 2\` per outage; reset the budget when healthy again.
  3. **Tier-2, once per outage** — if still unhealthy when the grace timer
     fires: the offerer fetches fresh ICE servers via
     \`POST /api/rooms/{roomId}/refresh-ice\` (body: \`{ host_secret }\` or
     \`{ peer_secret, peer_id }\` → \`{ ice_servers }\` with NEW short-TTL creds —
     the originals expire ~10 min after join, which is why plain ICE restarts
     fail deep into a match), builds a brand-new peer connection, and re-offers
     with \`"renegotiate": true\` added to the offer payload. An answerer that
     receives a \`renegotiate\` offer while it already has a remote description
     mirrors: refresh-ice, rebuild its peer connection, then answer normally.
     A fresh \`CONNECT_TIMEOUT_MS\` budget applies.
  4. If the renegotiated attempt also fails → the peer is disconnected.
- \`bufferedAmount\` guard: if a data channel's buffered amount exceeds
  **512KB**, DROP unreliable sends (return false) instead of queueing — a
  stalled peer must never grow an unbounded send queue.

## 5. Realtime signal push (WSS gateway) — OPTIONAL fast path

Endpoint: \`wss://<SIGNAL_GW_HOST>/rooms/{roomId}?token=<room_token>\`
- On connect the gateway validates the room token and subscribes you to signals
  addressed to YOUR \`peer\` claim.
- Messages (server→client): \`{ "type": "signal", "signal": { same row as §3.2 } }\`.
- Heartbeat: server pings every 15s; reply pong (or send \`{"type":"ping"}\` and
  expect \`{"type":"pong"}\` if your WS library lacks frame-level ping).
- Reconnect with exponential backoff (1s → 2s → … cap 30s).
- While the socket is OPEN: relax polling to 5000ms (reconciliation). On error/
  close: resume 1500ms polling immediately. The POST path (§3.1) is unchanged.
- Everything received here MUST go through the same \`signal_id\` dedupe cursor.

## 6. Telemetry — \`POST /api/telemetry/connect\`

Fire-and-forget after every connection outcome (never block gameplay; ignore
failures). Body:
\`\`\`json
{ "outcome": "connected"|"timeout"|"failed"|"recovered"|"gave_up",
  "role": "host"|"peer", "game_id": "…", "room_id": "<uuid>",
  "connect_ms": 2100, "candidate_type": "host"|"srflx"|"prflx"|"relay",
  "relay_host": "<turn url when relayed>", "ice_restarts": 0,
  "signaling_path": "poll"|"push", "ua_hint": "<coarse platform tag>" }
\`\`\`
Report: \`connected\` (with \`connect_ms\` + selected candidate) when the first
channel opens; \`recovered\` when a recovery succeeds; \`timeout\`/\`failed\`/\`gave_up\`
terminally. Selected candidate: from getStats — the nominated succeeded
candidate-pair's local candidate type (+ its server url when relay).

## 7. Players — login, linking, identity (OPTIONAL)

Persistent player accounts across sessions/devices. Fully optional — rooms and
signaling never require a player. The zero-friction path is anonymous:
\`{"provider":"anon","device_id":"<persisted uuid>"}\` gives every install a
player with NO login UI; real providers can be LINKED later to make the
account recoverable.

### 7.1 Login — \`POST /api/players/login\`
Headers: \`X-API-Key\` (or session token). Body: \`{ "provider", "create": true,
"display_name"?, ...proof }\`. Providers + proof fields:
| provider | proof fields | project config (dashboard → Settings) |
|---|---|---|
| \`anon\` | \`device_id\` | — |
| \`steam\` | \`ticket\` (hex auth session ticket), \`steam_id\`? | Steam publisher key + App ID |
| \`gamecenter\` | \`public_key_url\`, \`signature\` (b64), \`salt\` (b64), \`timestamp\` (ms), \`player_id\` (teamPlayerID) | Apple bundle id |
| \`apple\` | \`id_token\` (Sign in with Apple identity token) | Apple bundle id |
| \`google\` | \`id_token\` (Sign in with Google ID token) | Google web OAuth client id |
| \`discord\` | \`code\`, \`redirect_uri\` | Discord client id + secret |
| \`email\` | \`access_token\` (from the hosted signup/sign-in — §7.4) | — (hosted; zero setup) |

Response \`200\`: \`{ "player_token", "token_type": "Bearer", "expires_in": 86400,
"player_id", "display_name", "created" }\`. Errors: \`403\` proof rejected or
banned; \`404\` when \`create:false\` and no such player.

### 7.2 Player token
24h HS256 JWT — the game's credential for player-scoped calls. Re-login
silently on expiry. Also valid as ATTESTATION for the session-token exchange:
\`POST /api/auth/token { "platform": "player", "attestation": "<player_token>" }\`
binds the multiplayer session to the player (\`player_id: player:<uuid>\` in
telemetry).

### 7.3 Provider discovery — \`GET /api/players/providers\`
Headers: \`X-API-Key\`. Returns which sign-in methods the project supports (so
the game renders the right buttons) plus the hosted-email connection info:
\`{ "providers": { "anon": true, "email": { "auth_url", "anon_key" },
"steam": bool, "gamecenter": bool, "apple": bool, "google": bool,
"discord": { "client_id" } | false } }\`.

### 7.4 Hosted email accounts (zero setup)
Full email accounts — signup, password sign-in, magic links, password resets —
hosted by the platform. Use the \`auth_url\` + \`anon_key\` from §7.3 with these
REST calls (any HTTP client; the \`apikey\` header is the anon key):

- Sign up: \`POST {auth_url}/signup\` \`{ "email", "password" }\`
- Sign in: \`POST {auth_url}/token?grant_type=password\` \`{ "email", "password" }\`
  → \`{ "access_token", "refresh_token", ... }\`
- Refresh: \`POST {auth_url}/token?grant_type=refresh_token\` \`{ "refresh_token" }\`
- Magic link: \`POST {auth_url}/magiclink\` \`{ "email" }\` (link redirects must be
  coordinated with the platform; password flow needs no redirects — prefer it
  for games)

Then trade the access token for a player:
\`POST /api/players/login { "provider": "email", "access_token": "<token>" }\`.
The email account is global to the platform, but the resulting PLAYER is
scoped to your project (the same email in another game is a different player).

### 7.5 Arcade SSO (embedded games)

When a game is embedded in a host page (an arcade website iframe, or a mobile
webview), the host can pass the signed-in user's session token down so the game
signs in automatically — no re-typing a password. Arcade accounts share the
Lobbii auth pool, so an SSO player is the SAME player as an in-game email
sign-in with that account.

**Game side:** \`initArcadeSso(cloud, { allowedOrigins })\` (party-kit) listens on
three channels — an iframe \`postMessage\`, a \`window.__ARCADE_TOKEN__\` global
(mobile webview), and a \`?arcade_token=\` URL param — and calls
\`POST /api/players/login { provider:"email", access_token }\` with whichever
arrives. Standalone (itch, direct link) → no token → falls back to anon/email.

**Host page side** (the arcade that embeds the iframe):
\`\`\`js
const iframe = document.querySelector("iframe#game");
const GAME_ORIGIN = "https://tankii.example";
window.addEventListener("message", (e) => {
  if (e.origin === GAME_ORIGIN && e.data?.type === "arcadii:ready") {
    // The player's Arcade session access token (e.g. from Supabase auth).
    iframe.contentWindow.postMessage(
      { type: "arcadii:auth", token: session.access_token },
      GAME_ORIGIN,
    );
  }
});
// On logout: iframe.contentWindow.postMessage({ type:"arcadii:signout" }, GAME_ORIGIN)
\`\`\`

### 7.6 Identity management (Bearer player_token)
- \`GET /api/players/me\` → player + linked identities (subjects masked).
- \`PATCH /api/players/me\` \`{ display_name }\`.
- \`POST /api/players/link\` \`{ provider, ...proof }\` — attach another provider.
  \`409 identity_already_linked\` when it belongs to a different player (no
  force-link).
- \`POST /api/players/unlink\` \`{ provider }\` — \`400 cannot_unlink_last_identity\`
  guards the final credential.

## 8. Player content — save & share (OPTIONAL)

Cloud storage for replays, levels, saves — owned by players, shareable by
visibility (\`private | unlisted | public\`) and an 8-char \`share_code\`.

### 8.1 Create (small JSON, ≤512KB) — \`POST /api/player-content\`
Bearer player_token. Body: \`{ "content_type": "level"|"replay"|"save"|…,
"name", "description"?, "game_id"?, "visibility"?, "data": <any JSON> }\`
→ \`201 { id, share_code, size_bytes }\`. \`402\` on plan quota.

### 8.2 Create (large/binary, ≤10MB) — \`POST /api/player-content/upload-url\`
Same metadata + \`{ "size_bytes", "content_mime" }\` → \`{ id, share_code,
upload_url, token }\`. PUT the raw bytes to \`upload_url\`
(\`x-upsert: true\` header not needed; single-use), then
\`POST /api/player-content/{id}/finalize\` — verifies the object + real size and
flips it live. Replays: for deterministic sims, store seed + input stream —
compact and perfectly reproducible.

### 8.3 Read / browse
- \`GET /api/player-content?mine=true\` (player token) — own content.
- \`GET /api/player-content?visibility=public&content_type=level&game_id=…&limit=20\`
  (API key) — public browse, newest first, \`before\` cursor.
- \`GET /api/player-content?share_code=AB23CD45\` — fetch shared (public/unlisted).
- \`GET /api/player-content/{id}\` → metadata + \`download_url\` (1h signed URL);
  \`?inline=true\` returns small JSON directly as \`{ ..., data }\`.

### 8.4 Manage (owner, Bearer player_token)
\`PATCH /api/player-content/{id}\` \`{ name?, description?, visibility? }\`;
\`DELETE /api/player-content/{id}\`.

Plan caps: free 200 items / 100 MB per project; pro 10,000 items / 5 GB.

## 9. Test flags (all clients SHOULD implement)
- \`relay=1\` → \`iceTransportPolicy: "relay"\` (forces TURN; connectivity matrix).
- \`turnproto=tcp|tls\` → filter the minted ice_servers to only \`turn:…transport=tcp\`
  / \`turns:\` entries before constructing the peer connection.
- \`net=debug\` → verbose connection logging.

## 10. Conformance checklist
1. Token exchange with refresh-before-expiry, single-flight, 60s failure backoff.
2. Create/join/list/lookup rooms; secrets + room_token stored.
3. Signals: send offer/answer/trickle-ICE; poll with cursor; whole-session polling.
4. Channel topology incl. UNRELIABLE input channel; arraybuffer binary.
5. Recovery ladder with the §4.3 constants; buffered-amount drop guard.
6. Signal-id dedupe shared by poll + push paths; WSS fast path optional but recommended.
7. Telemetry on every outcome.
8. Test flags §7; connect under 15s on normal networks, works with \`relay=1\`.
`;
