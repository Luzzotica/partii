export const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

export function buildWebRTCPrompt(opts: { apiKey: string; baseUrl: string }): string {
  const { apiKey, baseUrl } = opts;
  const isPlaceholder = apiKey === API_KEY_PLACEHOLDER;
  const credentialsHeading = isPlaceholder
    ? "## Credentials (you must fill in the API key)"
    : "## Credentials (already filled in for you)";
  const credentialsFooter = isPlaceholder
    ? `Before running anything, replace \`${API_KEY_PLACEHOLDER}\` with a real API key from the developer dashboard at \`${baseUrl}/developer\`. If the user hasn't given you one, ask for it before writing code.`
    : "Hard-code these into a config module or accept them via constructor — the user does not need to provide them again.";
  return `# Build a WebRTC party-session client

You are a senior engineer. Build a working WebRTC client against the party-session REST API described below. The signaling protocol is HTTP/JSON — it is language- and platform-agnostic, and clients are commonly built in TypeScript (browser), Godot (GDScript / C#), Rust, Swift, Kotlin, Unity, Unreal, Python, or anything else with a WebRTC implementation and an HTTP client.

**First, before writing any code:** if the user has not told you what target they want, ask them: *"What language and platform are you building for — browser TypeScript, Godot, Rust, Unity, native Swift/Kotlin, something else?"* Then write idiomatic code for that target using its standard WebRTC API. Examples:
- **Browser / TypeScript / JavaScript** → \`RTCPeerConnection\` + \`fetch\`
- **Godot 4** → \`WebRTCPeerConnection\` + \`HTTPRequest\`
- **Rust** → \`webrtc-rs\` (or \`webrtc.rs\`) + \`reqwest\`
- **C# / Unity** → \`Unity.WebRTC\` + \`UnityWebRequest\`
- **Swift / iOS** → Google's \`WebRTC.framework\` + \`URLSession\`
- **Kotlin / Android** → Google's \`webrtc\` Android lib + OkHttp / Ktor
- **Python** → \`aiortc\` + \`httpx\`
- **C++ / native** → \`libdatachannel\` or \`libwebrtc\` + any HTTP client

The protocol is the same on every platform; only the API calls differ. Produce runnable, idiomatic code (no pseudocode) covering **both** roles:

- A **Host** module — creates rooms, accepts incoming peers, owns the authoritative data channel(s).
- A **Controller** (peer) module — joins a room by code, talks to the host over WebRTC.
- A thin **signaling client** that wraps the REST endpoints below.

---

${credentialsHeading}

- **API key:** \`${apiKey}\`
- **Base URL:** \`${baseUrl}\`
- **Auth header on every request:** \`X-API-Key: <the api key above>\`

${credentialsFooter}

---

## Core concepts

- **Room** — a session created by the host. Identified by \`room_id\` (uuid). Also has a 6-char alphanumeric \`join_code\` that controllers use.
- **Host** — the creator of the room. Receives \`host_secret\` and \`host_peer_id\` exactly **once** at creation time.
- **Peer (controller)** — a phone, console, or browser that joined via \`join_code\`. Receives \`peer_id\` and \`peer_secret\` exactly **once** at join time.
- **Secrets** — \`host_secret\` and \`peer_secret\` must be kept in memory by the originating client only. They authenticate mutating actions (sending signals, updating peer status, ending the room). **Never** expose them to other peers, never log them, never persist them client-side beyond the session.
- **ICE servers (STUN + TURN, provided for you)** — \`POST /api/rooms\` and \`POST /api/rooms/{id}/peers\` both return an \`ice_servers\` array containing **STUN** entries *and* a **TURN** entry with short-lived \`username\` + \`credential\` (HMAC-signed, ~10 min TTL). The TURN server is hosted by the backend — you do not need to run your own. Pass the array straight into your platform's PeerConnection config (\`RTCConfiguration.iceServers\` in browser/Unity, \`add_ice_server()\` in Godot, \`RTCConfiguration::ice_servers\` in webrtc-rs, etc). Never hard-code STUN/TURN URLs and never strip the TURN entry — without it, peers behind symmetric NAT (most cellular networks, many corporate Wi-Fi) will fail to connect.
- **Signaling transport** — REST/HTTP only. There is **no WebSocket**. Both sides POST signals and GET-poll for incoming signals.

---

## Endpoints

All endpoints require header \`X-API-Key: ${apiKey}\`. All return JSON. All accept JSON bodies (\`Content-Type: application/json\`). Base URL is \`${baseUrl}\`.

### \`POST /api/rooms\` — create a room (host)
Request:
\`\`\`json
{
  "game_id": "string (required, <=100 chars)",
  "display_name": "string (optional, <=60)",
  "host_kind": "string (optional, default 'screen')",
  "host_display_name": "string (optional, <=60)",
  "max_peers": 8,
  "visibility": "private",
  "password": "optional plaintext",
  "metadata": {}
}
\`\`\`
Response \`201\`:
\`\`\`json
{
  "room_id": "uuid",
  "join_code": "ABC123",
  "host_secret": "uuid (store now, never returned again)",
  "host_peer_id": "uuid",
  "host_peer_secret": "uuid",
  "expires_at": "ISO 8601",
  "ice_servers": [
    { "urls": "stun:turn-host:3478" },
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": [
        "turn:turn-host:3478?transport=udp",
        "turn:turn-host:3478?transport=tcp"
      ],
      "username": "1730000000:k=apk_...:p=...",
      "credential": "base64-hmac-sha1"
    }
  ]
}
\`\`\`

### \`GET /api/rooms?game_id=...\` — list public joinable rooms (optional filter)

### \`GET /api/rooms/lookup?code=ABC123\` — resolve join code to room summary
Use this from the controller before joining.

### \`GET /api/rooms/{roomId}\` — get full room + peer roster
The host should poll this every ~2s to discover new peers it hasn't sent an offer to yet (there is no push channel for roster changes).

### \`PATCH /api/rooms/{roomId}\` — update room (host-only)
\`\`\`json
{ "host_secret": "...", "status": "ended" }
\`\`\`
Call with \`{ status: "ended" }\` when the host shuts down.

### \`POST /api/rooms/{roomId}/peers\` — join as controller
Request:
\`\`\`json
{
  "kind": "phone",
  "display_name": "string (optional)",
  "password": "if room is password-protected",
  "metadata": {}
}
\`\`\`
Response \`201\`:
\`\`\`json
{
  "peer_id": "uuid",
  "peer_secret": "uuid (store now)",
  "slot": 1,
  "kind": "phone",
  "display_name": "...",
  "ice_servers": [
    { "urls": "stun:turn-host:3478" },
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": [
        "turn:turn-host:3478?transport=udp",
        "turn:turn-host:3478?transport=tcp"
      ],
      "username": "1730000000:k=apk_...:p=...",
      "credential": "base64-hmac-sha1"
    }
  ]
}
\`\`\`

### \`PATCH /api/rooms/{roomId}/peers/{peerId}\` — update peer status
\`\`\`json
{ "peer_secret": "...", "status": "connected" }
\`\`\`
Status values: \`joined | connected | disconnected\`. Set \`connected\` when the data channel opens.

### \`DELETE /api/rooms/{roomId}/peers/{peerId}?peer_secret=...\` — leave room
Call on unload / page close / app teardown.

### \`POST /api/rooms/{roomId}/signals\` — send a WebRTC signal
**From host:**
\`\`\`json
{
  "host_secret": "...",
  "recipient_peer_id": "<peerId>",
  "signal_type": "offer",
  "payload": { "type": "offer", "sdp": "v=0\\r\\n..." }
}
\`\`\`
**From peer (controller):**
\`\`\`json
{
  "peer_secret": "...",
  "sender_peer_id": "<this peer's id>",
  "recipient_peer_id": "host",
  "signal_type": "answer",
  "payload": { "type": "answer", "sdp": "v=0\\r\\n..." }
}
\`\`\`
\`signal_type\` is one of \`offer | answer | ice_candidate\`. For ICE, \`payload\` is the candidate object (\`{ candidate, sdpMid, sdpMLineIndex }\`).

Response: \`{ "signal_id": <number> }\`. Errors: 400 (bad fields), 403 (wrong secret), 404 (room/peer not found).

### \`GET /api/rooms/{roomId}/signals?recipient_peer_id=...&since_id=...&limit=...\` — poll for signals
- \`recipient_peer_id\` — your \`peer_id\`, or the literal string \`"host"\` if you're the host.
- \`since_id\` — cursor; start at 0, then use the returned \`next_since_id\`.
- \`limit\` — default 20, max 50.

Response:
\`\`\`json
{
  "signals": [
    {
      "signal_id": 123,
      "sender_peer_id": "uuid or 'host'",
      "signal_type": "offer | answer | ice_candidate",
      "payload": { ... },
      "created_at": "ISO 8601"
    }
  ],
  "next_since_id": 124
}
\`\`\`

---

## Signaling sequence

### Host
1. \`POST /api/rooms\` → keep \`room_id\`, \`host_secret\`, \`host_peer_id\`, \`ice_servers\`, \`join_code\`. Surface \`join_code\` to the UI.
2. Start two polling loops:
   - **Signal poll:** \`GET /signals?recipient_peer_id=host&since_id=…\` every ~1500 ms. Drain everything per response before sleeping. Advance \`since_id\` to \`next_since_id\`.
   - **Roster poll:** \`GET /api/rooms/{roomId}\` every ~2000 ms. Compare \`peers[]\` against peers you've already seen; for each new \`peer_id\`, kick off step 3.
3. For each new peer:
   1. Create a PeerConnection using the \`ice_servers\` array.
   2. Create a reliable, ordered data channel (host always creates the channel — controllers only *receive* one).
   3. Wire the "on local ICE candidate" callback to \`POST /signals\` with \`signal_type: "ice_candidate"\`, \`recipient_peer_id: <peerId>\`.
   4. Create an offer → set local description → \`POST /signals\` with \`signal_type: "offer"\`, \`recipient_peer_id: <peerId>\`, payload = \`{ type, sdp }\`.
   5. When the signal poll yields an \`answer\` from this peer: set remote description from \`answer.payload\`.
   6. When the signal poll yields an \`ice_candidate\` from this peer: add it. Buffer incoming candidates until the remote description has been applied (most stacks require this ordering).
   7. When the data channel transitions to \`open\`, stop signal polling *for this peer* (the global poll keeps running to handle new joiners).

### Controller
1. \`GET /api/rooms/lookup?code=<joinCode>\` → get \`room_id\`.
2. \`POST /api/rooms/{roomId}/peers\` → keep \`peer_id\`, \`peer_secret\`, \`ice_servers\`.
3. Create a PeerConnection using the \`ice_servers\` array.
4. Register an "on data channel" callback — the host opens the channel; you receive it.
5. Wire "on local ICE candidate" → \`POST /signals\` with \`peer_secret\`, \`sender_peer_id: <peerId>\`, \`recipient_peer_id: "host"\`, \`signal_type: "ice_candidate"\`.
6. Start signal polling: \`GET /signals?recipient_peer_id=<peerId>&since_id=…\` every ~1500 ms.
7. On incoming \`offer\`: set remote description from \`offer.payload\` → create answer → set local description → \`POST /signals\` with \`signal_type: "answer"\`, \`recipient_peer_id: "host"\`.
8. On incoming \`ice_candidate\`: add it.
9. When the data channel hits \`open\`, \`PATCH /peers/{peerId}\` with \`{ peer_secret, status: "connected" }\` and stop polling.

---

## Polling rules
- 1500 ms interval is a sane default; do not poll faster than 1000 ms.
- Always advance \`since_id\` using the returned \`next_since_id\` — never re-fetch processed signals.
- Drain the full response before sleeping; if you got \`limit\` items, immediately fetch again before sleeping (catch-up).
- Stop signal polling once the data channel is \`open\` (controllers) or once all expected peers are connected (host can keep polling for new joiners).
- On 5xx, back off (e.g. 3s, 6s, 12s capped). On 4xx, fail loudly — these are programmer errors.

## Cleanup
- Controller: send a \`DELETE /peers/{peerId}?peer_secret=…\` on app teardown. Browsers can use \`navigator.sendBeacon\`; native apps can fire-and-forget on app close.
- Host: \`PATCH /api/rooms/{roomId}\` with \`{ host_secret, status: "ended" }\` when shutting down. Close all PeerConnections.

## TURN / NAT traversal — rules
- **You don't need to run a TURN server.** The backend mints ephemeral TURN credentials for every \`POST /api/rooms\` and \`POST /api/rooms/{id}/peers\` response. Use them.
- **TTL is ~10 minutes.** Credentials are signed and short-lived. ICE gathering + connection establishment normally completes in seconds, so the TTL is never a problem during initial connect.
- **Refresh on reconnect.** If a peer disconnects and rejoins (network blip past the 10-min mark, new device, app relaunch), call \`POST /api/rooms/{roomId}/peers\` again — it returns a fresh \`ice_servers\` array. There is no separate "refresh creds" endpoint; re-joining is the refresh.
- **Use the array as-is.** Do not filter, dedupe, or reorder it. WebRTC needs both STUN (for srflx candidates) and TURN (for relay fallback); the order returned is correct.
- **Debug tip:** when testing TURN coverage, temporarily force relay by setting your stack's equivalent of \`iceTransportPolicy: "relay"\` (browser/Unity), \`RTCIceTransportPolicy::Relay\` (webrtc-rs), or the matching enum in your library. If the data channel still opens, TURN is healthy. Remove this in production — the default ("all") lets WebRTC pick the cheapest working path.
- **No silent fallback to STUN-only.** If the backend can't mint TURN creds, the \`ice_servers\` array will contain STUN entries only. Connections behind symmetric NAT will then fail. If you see ICE state stuck at \`checking\` or \`disconnected\` for peers on cellular networks, verify the response contained a \`turn:\` entry.
- **Don't log the TURN \`credential\`.** It's tied to the API key for billing attribution; leaking it lets others draft TURN bandwidth against the account until the TTL expires.

## Worked example — one offer POST

\`\`\`http
POST ${baseUrl}/api/rooms/8f3.../signals
X-API-Key: ${apiKey}
Content-Type: application/json

{
  "host_secret": "11111111-1111-1111-1111-111111111111",
  "recipient_peer_id": "22222222-2222-2222-2222-222222222222",
  "signal_type": "offer",
  "payload": { "type": "offer", "sdp": "v=0\\r\\no=- ... a=end-of-candidates\\r\\n" }
}
\`\`\`

## Worked example — one ICE POST from a controller

\`\`\`http
POST ${baseUrl}/api/rooms/8f3.../signals
X-API-Key: ${apiKey}
Content-Type: application/json

{
  "peer_secret": "33333333-3333-3333-3333-333333333333",
  "sender_peer_id": "22222222-2222-2222-2222-222222222222",
  "recipient_peer_id": "host",
  "signal_type": "ice_candidate",
  "payload": { "candidate": "candidate:1 1 udp 2113937151 ...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
\`\`\`

---

## Build it now

1. **Confirm the target.** If the user hasn't already said, ask them what language/platform they're targeting.
2. **Produce idiomatic code for that target** covering the Host role and the Controller (peer) role, plus a thin signaling client wrapping the REST endpoints. Use the platform's native WebRTC and HTTP libraries — no exotic deps.
3. **Wire in the credentials above.** Don't ask for the API key — it is \`${apiKey}\`. Don't ask for the base URL — it is \`${baseUrl}\`.
4. **Include a tiny runnable example** showing the host printing the join code and the controller connecting to it and exchanging one round-trip message over the data channel.
`;
}
