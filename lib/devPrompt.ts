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
  return `# Build a WebRTC multiplayer client

You are a senior engineer. Build a working WebRTC multiplayer client against the REST signaling API described below. The protocol is host-authoritative: one **host** creates a room and accepts connections from one or more **clients** (other machines) over a peer-to-peer WebRTC data channel. This is general-purpose multiplayer — co-op, competitive, lobby-based, drop-in/drop-out — not limited to any specific game type or device class. The signaling protocol is HTTP/JSON, so host and clients can run on entirely different stacks and still interoperate.

**First, before writing any code:** if the user has not told you what target they want, ask them: *"What language and platform are you building for — browser TypeScript, Godot, Rust, Unity, native Swift/Kotlin, something else? And are you building the host, the client, or both?"* Then write idiomatic code for that target using its standard WebRTC API. Examples:
- **Browser / TypeScript / JavaScript** → \`RTCPeerConnection\` + \`fetch\`
- **Godot 4** → \`WebRTCPeerConnection\` + \`HTTPRequest\`
- **Rust** → \`webrtc-rs\` (or \`webrtc.rs\`) + \`reqwest\`
- **C# / Unity** → \`Unity.WebRTC\` + \`UnityWebRequest\`
- **Swift / iOS** → Google's \`WebRTC.framework\` + \`URLSession\`
- **Kotlin / Android** → Google's \`webrtc\` Android lib + OkHttp / Ktor
- **Python** → \`aiortc\` + \`httpx\`
- **C++ / native** → \`libdatachannel\` or \`libwebrtc\` + any HTTP client

The protocol is identical on every platform; only the API calls differ. Produce runnable, idiomatic code (no pseudocode) covering **both** roles unless the user specified only one:

- A **Host** module — creates rooms, accepts incoming clients, owns the authoritative data channel(s), broadcasts game state.
- A **Client** module — joins a room by code, exchanges messages with the host over WebRTC.
- A thin **signaling client** that wraps the REST endpoints below.

---

${credentialsHeading}

- **API key:** \`${apiKey}\`
- **Base URL:** \`${baseUrl}\`
- **Auth header on every request:** \`X-API-Key: <the api key above>\`

${credentialsFooter}

---

## Core concepts

- **Room** — a multiplayer session created by the host. Identified by \`room_id\` (uuid). Also has a 6-char alphanumeric \`join_code\` that clients use to find it.
- **Host** — the authoritative machine that created the room. Receives \`host_secret\` and \`host_peer_id\` exactly **once** at creation time.
- **Client (peer)** — any other machine that joined the room via \`join_code\`. Receives \`peer_id\` and \`peer_secret\` exactly **once** at join time. The protocol calls these "peers" on the wire (\`peer_id\`, \`peer_secret\`, \`/peers\` endpoint, etc.) — same thing as a client.
- **Secrets** — \`host_secret\` and \`peer_secret\` must be kept in memory by the originating machine only. They authenticate mutating actions (sending signals, updating status, ending the room). **Never** expose them to other peers, never log them, never persist them beyond the session.
- **ICE servers (STUN + TURN, provided for you)** — \`POST /api/rooms\` and \`POST /api/rooms/{id}/peers\` both return an \`ice_servers\` array containing **STUN** entries *and* a **TURN** entry with short-lived \`username\` + \`credential\` (HMAC-signed, ~10 min TTL). The TURN server is hosted by the backend — you do not need to run your own. Pass the array straight into your platform's PeerConnection config (\`RTCConfiguration.iceServers\` in browser/Unity, \`add_ice_server()\` in Godot, \`RTCConfiguration::ice_servers\` in webrtc-rs, etc). Never hard-code STUN/TURN URLs and never strip the TURN entry — without it, machines behind symmetric NAT (most cellular networks, many corporate Wi-Fi) will fail to connect.
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
Use this from a client before joining.

### \`GET /api/rooms/{roomId}\` — get full room + peer roster
The host should poll this every ~2s to discover new peers it hasn't sent an offer to yet (there is no push channel for roster changes).

### \`PATCH /api/rooms/{roomId}\` — update room (host-only)
\`\`\`json
{ "host_secret": "...", "status": "ended" }
\`\`\`
Call with \`{ status: "ended" }\` when the host shuts down.

### \`POST /api/rooms/{roomId}/peers\` — join as a client
Request:
\`\`\`json
{
  "kind": "client",
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
  "kind": "client",
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
**From a client (peer):**
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
   2. Create a reliable, ordered data channel (host always creates the channel — clients only *receive* one).
   3. Wire the "on local ICE candidate" callback to \`POST /signals\` with \`signal_type: "ice_candidate"\`, \`recipient_peer_id: <peerId>\`.
   4. Create an offer → set local description → \`POST /signals\` with \`signal_type: "offer"\`, \`recipient_peer_id: <peerId>\`, payload = \`{ type, sdp }\`.
   5. When the signal poll yields an \`answer\` from this peer: set remote description from \`answer.payload\`.
   6. When the signal poll yields an \`ice_candidate\` from this peer: add it. Buffer incoming candidates until the remote description has been applied (most stacks require this ordering).
   7. When the data channel transitions to \`open\`, stop signal polling *for this peer* (the global poll keeps running to handle new joiners).

### Client
1. \`GET /api/rooms/lookup?code=<joinCode>\` → get \`room_id\`.
2. \`POST /api/rooms/{roomId}/peers\` → keep \`peer_id\`, \`peer_secret\`, \`ice_servers\`.
3. Create a PeerConnection using the \`ice_servers\` array.
4. Register an "on data channel" callback — the host opens the channel; you receive it.
5. Wire "on local ICE candidate" → \`POST /signals\` with \`peer_secret\`, \`sender_peer_id: <peerId>\`, \`recipient_peer_id: "host"\`, \`signal_type: "ice_candidate"\`.
6. Start signal polling: \`GET /signals?recipient_peer_id=<peerId>&since_id=…\` every ~1500 ms.
7. On incoming \`offer\`: set remote description from \`offer.payload\` → create answer → set local description → \`POST /signals\` with \`signal_type: "answer"\`, \`recipient_peer_id: "host"\`.
8. On incoming \`ice_candidate\`: add it.
9. When the data channel hits \`open\`, \`PATCH /peers/{peerId}\` with \`{ peer_secret, status: "connected" }\`. Then KEEP the signal poll running (you may slow it to ~3000 ms) for the rest of the session — do NOT stop it. ICE-restart offers during recovery arrive on this same channel; if you stop polling you can never recover from a network blip. See **Connection recovery** below.

---

## Polling rules
- 1500 ms interval is a sane default; do not poll faster than 1000 ms.
- Always advance \`since_id\` using the returned \`next_since_id\` — never re-fetch processed signals.
- Drain the full response before sleeping; if you got \`limit\` items, immediately fetch again before sleeping (catch-up).
- Do NOT stop signal polling when the data channel opens. Slow it (e.g. to ~3000 ms) but keep it alive for the session: ICE-restart offers during recovery ride the same channel, and the host also needs it to discover new joiners. (See **Connection recovery**.)
- On 5xx, back off (e.g. 3s, 6s, 12s capped). On 4xx, fail loudly — these are programmer errors.

## Cleanup
- Client: send a \`DELETE /peers/{peerId}?peer_secret=…\` on app teardown. Browsers can use \`navigator.sendBeacon\`; native apps can fire-and-forget on app close.
- Host: \`PATCH /api/rooms/{roomId}\` with \`{ host_secret, status: "ended" }\` when shutting down. Close all PeerConnections.

## TURN / NAT traversal — rules
- **You don't need to run a TURN server.** The backend mints ephemeral TURN credentials for every \`POST /api/rooms\` and \`POST /api/rooms/{id}/peers\` response. Use them.
- **TTL is ~10 minutes.** Credentials are signed and short-lived. ICE gathering + connection establishment normally completes in seconds, so the TTL is never a problem during initial connect.
- **Refresh on reconnect.** If a peer disconnects and rejoins (network blip past the 10-min mark, new device, app relaunch), call \`POST /api/rooms/{roomId}/peers\` again — it returns a fresh \`ice_servers\` array. There is no separate "refresh creds" endpoint; re-joining is the refresh.
- **Use the array as-is.** Do not filter, dedupe, or reorder it. WebRTC needs both STUN (for srflx candidates) and TURN (for relay fallback); the order returned is correct.
- **Debug tip:** when testing TURN coverage, temporarily force relay by setting your stack's equivalent of \`iceTransportPolicy: "relay"\` (browser/Unity), \`RTCIceTransportPolicy::Relay\` (webrtc-rs), or the matching enum in your library. If the data channel still opens, TURN is healthy. Remove this in production — the default ("all") lets WebRTC pick the cheapest working path.
- **No silent fallback to STUN-only.** If the backend can't mint TURN creds, the \`ice_servers\` array will contain STUN entries only. Connections behind symmetric NAT will then fail. If you see ICE state stuck at \`checking\` or \`disconnected\` for peers on cellular networks, verify the response contained a \`turn:\` entry.
- **Don't log the TURN \`credential\`.** It's tied to the API key for billing attribution; leaking it lets others draft TURN bandwidth against the account until the TTL expires.

---

## Connection recovery & reconnection (REQUIRED — do not skip)

A live WebRTC connection WILL briefly drop on real networks — phones switching Wi-Fi↔cellular, NAT rebinds, airport / hotel / corporate Wi-Fi. Your platform surfaces this as \`iceConnectionState\` / \`connectionState\` transitioning to \`disconnected\` or \`failed\`. **These states are RECOVERABLE.** The single most common integration bug is treating the first \`disconnected\`/\`failed\` as fatal and tearing the peer down (kicking the player, ending the room) — that turns a one-second blip into a lost session. Do not do this.

Implement the following on both roles:

1. **Never tear down on the first drop.** On \`disconnected\`/\`failed\`, do NOT close the PeerConnection or remove the peer. Enter a recovery window instead.
2. **Grace window (~10s).** Arm a single timer (~10000 ms — generous, because the restart offer/answer rides the poll-based signaling and adds a round trip). Only fire a real disconnect (kick the peer / show "connection lost") if the link is still down when it elapses.
3. **ICE restart, driven by the host (offerer).** Immediately create a fresh offer with the ICE-restart flag — \`pc.createOffer({ iceRestart: true })\` in the browser, the equivalent on your stack — \`setLocalDescription\`, and POST it as a normal \`offer\` signal to that peer. This forces BOTH ends to re-gather candidates, crucially a fresh TURN relay allocation, so ICE can fail over to the relay when the direct path has died.
4. **The client (answerer) just answers it.** A restart offer is identical to the initial offer: \`setRemoteDescription\` → \`createAnswer\` → \`setLocalDescription\` → POST \`answer\`. No special-casing — but it means the client MUST still be polling for signals (see the polling fix above), otherwise it never receives the restart offer.
5. **Recovered = reset.** When state returns to \`connected\`/\`completed\`, cancel the grace timer and reset the restart counter so a future blip earns a fresh budget.
6. **Cap restarts** at ~2 per drop episode so a permanently dead network can't spin the signaling channel forever; reset the count once healthy.
7. **Genuine terminal loss → re-join.** If the grace window elapses unrecovered (or you're past the ~10-min TURN TTL), re-join with \`POST /api/rooms/{roomId}/peers\` to get a fresh \`ice_servers\` array and redo the handshake — don't reuse dead state.

State names differ by platform, same semantics: browser/Unity \`pc.connectionState\` + \`oniceconnectionstatechange\`; Godot \`WebRTCPeerConnection\` + \`get_connection_state()\`; webrtc-rs \`on_peer_connection_state_change\`. Treat \`closed\` (only ever from your own teardown) as terminal; \`disconnected\`/\`failed\` as recoverable.

### Reference implementation (TypeScript / browser — port the state-enum names for other stacks)

This is the exact recovery state machine our own games ship. Call \`attachRecovery()\` right after you create the \`RTCPeerConnection\`. It is transport-agnostic: you supply how to POST a restart offer and what to do on a real disconnect.

\`\`\`ts
const RECOVERY_GRACE_MS = 10_000;
const MAX_ICE_RESTARTS = 2;

// role: "host" (offerer) drives the ICE restart; "client" (answerer) recovers
//   by answering the restart offer it receives on its signal poll.
// sendRestartOffer(offer): POST it as a normal { signal_type: "offer" } signal.
// onTerminalDisconnect(reason): only called if recovery genuinely fails.
function attachRecovery(
  pc: RTCPeerConnection,
  role: "host" | "client",
  sendRestartOffer: (offer: RTCSessionDescriptionInit) => Promise<void>,
  onTerminalDisconnect: (reason: string) => void,
) {
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let iceRestarts = 0;
  let fired = false;

  const healthy = () => {
    if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    iceRestarts = 0;
  };

  const fireOnce = (reason: string) => {
    if (fired) return;
    fired = true;
    onTerminalDisconnect(reason);
  };

  const tryIceRestart = async () => {
    if (role !== "host") return;                 // offerer drives it; client answers
    if (iceRestarts >= MAX_ICE_RESTARTS) return;
    iceRestarts++;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await sendRestartOffer(offer);
    } catch { /* a later state change re-enters recovery, capped */ }
  };

  const startRecovery = (reason: string) => {
    if (fired || recoveryTimer) return;          // already recovering
    void tryIceRestart();
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      const s = pc.connectionState, i = pc.iceConnectionState;
      if (s === "connected" || i === "connected" || i === "completed") return;
      fireOnce(reason);
    }, RECOVERY_GRACE_MS);
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") healthy();
    else if (s === "closed") fireOnce("closed");
    else if (s === "failed" || s === "disconnected") startRecovery("connectionState=" + s);
  };
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === "connected" || s === "completed") healthy();
    else if (s === "failed" || s === "disconnected") startRecovery("iceConnectionState=" + s);
  };
}
\`\`\`

Your existing "incoming offer" handler already covers restart offers — just make sure it runs for offers that arrive AFTER the channel is open, not only the first one.

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

## Worked example — one ICE POST from a client

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
2. **Produce idiomatic code for that target** covering the Host role and the Client (peer) role, plus a thin signaling client wrapping the REST endpoints. Use the platform's native WebRTC and HTTP libraries — no exotic deps.
3. **Wire in the credentials above.** Don't ask for the API key — it is \`${apiKey}\`. Don't ask for the base URL — it is \`${baseUrl}\`.
4. **Include a tiny runnable example** showing the host printing the join code and a client connecting to it and exchanging one round-trip message over the data channel.
5. **Implement Connection recovery (the REQUIRED section above).** A \`disconnected\`/\`failed\` ICE/connection state must trigger a grace window + host-driven ICE restart, NOT a teardown — and the client must keep polling so it receives the restart offer. This is not optional: without it, players get kicked on every transient network blip. Port the reference \`attachRecovery()\` to your target.
`;
}
