export const HEXII_API_KEY_PLACEHOLDER = "YOUR_HEXII_API_KEY";

export function buildWebRTCPrompt(opts: { apiKey: string; baseUrl: string }): string {
  const { apiKey, baseUrl } = opts;
  const isPlaceholder = apiKey === HEXII_API_KEY_PLACEHOLDER;
  const credentialsHeading = isPlaceholder
    ? "## Credentials (you must fill in the API key)"
    : "## Credentials (already filled in for you)";
  const credentialsFooter = isPlaceholder
    ? `Before running anything, replace \`${HEXII_API_KEY_PLACEHOLDER}\` with a real API key from https://sterlinglong.me/developer. If the user hasn't given you one, ask for it before writing code.`
    : "Hard-code these into a `config.ts` or accept them via constructor — your call — but the user does not need to provide them again.";
  return `# Build a Hexii WebRTC party-session client

You are a senior TypeScript engineer. Build a working **browser TypeScript** client against the Hexii party-session REST API described below. Output runnable code (no pseudocode, no placeholders) and explain only what's necessary. Use plain \`fetch\` and the browser's \`RTCPeerConnection\` — no extra dependencies. TypeScript strict mode.

When the user asks you to "build it", produce three modules covering **both** the host (TV/desktop, creates rooms) and the controller (phone/web, joins via code):

- \`signaling.ts\` — typed \`fetch\` helpers for every endpoint listed in this prompt.
- \`host.ts\` — exports \`createHostSession({ gameId, displayName }) => Promise<HostSession>\` where \`HostSession\` has \`{ joinCode, onPeerConnect(cb), onPeerMessage(cb), broadcast(data), close() }\`.
- \`controller.ts\` — exports \`joinAsController({ joinCode, displayName }) => Promise<ControllerSession>\` where \`ControllerSession\` has \`{ send(data), onMessage(cb), onClose(cb), close() }\`.

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
- **Peer (controller)** — a phone/browser that joined via \`join_code\`. Receives \`peer_id\` and \`peer_secret\` exactly **once** at join time.
- **Secrets** — \`host_secret\` and \`peer_secret\` must be kept in memory by the originating client only. They authenticate mutating actions (sending signals, updating peer status, ending the room). **Never** put them on \`window\`, never log them, never send them to anyone else.
- **ICE servers** — \`POST /api/rooms\` and \`POST /api/rooms/{id}/peers\` both return an \`ice_servers\` array. Pass it straight into \`new RTCPeerConnection({ iceServers })\`. Don't hard-code STUN/TURN.
- **Signaling transport** — REST only. There is **no WebSocket**. Both sides POST signals and GET-poll for incoming signals.

---

## Endpoints

All endpoints require \`X-API-Key: ${apiKey}\`. All return JSON. All accept JSON bodies (\`Content-Type: application/json\`). Base URL is \`${baseUrl}\`.

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
  "ice_servers": [{ "urls": "stun:...", "username": "?", "credential": "?" }]
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
  "ice_servers": [...]
}
\`\`\`

### \`PATCH /api/rooms/{roomId}/peers/{peerId}\` — update peer status
\`\`\`json
{ "peer_secret": "...", "status": "connected" }
\`\`\`
Status values: \`joined | connected | disconnected\`. Set \`connected\` when the data channel opens.

### \`DELETE /api/rooms/{roomId}/peers/{peerId}?peer_secret=...\` — leave room
Call on unload / page close.

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
   1. \`new RTCPeerConnection({ iceServers })\`.
   2. \`pc.createDataChannel("hexii", { ordered: true })\` — host always creates the channel.
   3. Wire \`pc.onicecandidate\` → \`POST /signals\` with \`signal_type: "ice_candidate"\`, \`recipient_peer_id: <peerId>\`.
   4. \`pc.createOffer()\` → \`pc.setLocalDescription(offer)\` → \`POST /signals\` with \`signal_type: "offer"\`, \`recipient_peer_id: <peerId>\`, payload = \`{ type, sdp }\`.
   5. When the signal poll yields an \`answer\` from this peer: \`pc.setRemoteDescription(answer.payload)\`.
   6. When the signal poll yields an \`ice_candidate\` from this peer: \`pc.addIceCandidate(candidate.payload)\`. Buffer them until \`setRemoteDescription\` has resolved.
   7. When the data channel hits \`open\`, stop signal polling for this peer (you may keep the global poll running to handle new joiners).

### Controller
1. \`GET /api/rooms/lookup?code=<joinCode>\` → get \`room_id\`.
2. \`POST /api/rooms/{roomId}/peers\` → keep \`peer_id\`, \`peer_secret\`, \`ice_servers\`.
3. \`new RTCPeerConnection({ iceServers })\`.
4. Register \`pc.ondatachannel = e => { channel = e.channel; ... }\` — the host opens the channel; you receive it.
5. Wire \`pc.onicecandidate\` → \`POST /signals\` with \`peer_secret\`, \`sender_peer_id: <peerId>\`, \`recipient_peer_id: "host"\`, \`signal_type: "ice_candidate"\`.
6. Start signal polling: \`GET /signals?recipient_peer_id=<peerId>&since_id=…\` every ~1500 ms.
7. On incoming \`offer\`: \`pc.setRemoteDescription(offer.payload)\` → \`pc.createAnswer()\` → \`pc.setLocalDescription(answer)\` → \`POST /signals\` with \`signal_type: "answer"\`, \`recipient_peer_id: "host"\`.
8. On incoming \`ice_candidate\`: \`pc.addIceCandidate(...)\`.
9. When the data channel hits \`open\`, \`PATCH /peers/{peerId}\` with \`{ peer_secret, status: "connected" }\` and stop polling.

---

## Polling rules
- 1500 ms interval is a sane default; do not poll faster than 1000 ms.
- Always advance \`since_id\` using the returned \`next_since_id\` — never re-fetch processed signals.
- Drain the full response before sleeping; if you got \`limit\` items, immediately fetch again before sleeping (catch-up).
- Stop signal polling once the data channel is \`open\` (controllers) or once all expected peers are connected (host can keep polling for new joiners).
- On 5xx, back off (e.g. 3s, 6s, 12s capped). On 4xx, fail loudly — these are programmer errors.

## Cleanup
- Controller: \`addEventListener("beforeunload", () => navigator.sendBeacon(...))\` is fine, but a plain \`DELETE /peers/{peerId}?peer_secret=…\` in \`close()\` works for explicit teardown.
- Host: \`PATCH /api/rooms/{roomId}\` with \`{ host_secret, status: "ended" }\` in \`close()\`. Close all \`RTCPeerConnection\`s.

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

Produce \`signaling.ts\`, \`host.ts\`, \`controller.ts\` as described above, plus a 10-line \`example.ts\` that:
1. Calls \`createHostSession({ gameId: "demo" })\` and \`console.log\`s the join code.
2. (In a separate snippet meant for a different tab) calls \`joinAsController({ joinCode: "PASTE_ME" })\` and logs every received message.

Do not ask for the API key — it is \`${apiKey}\`. Do not ask for the base URL — it is \`${baseUrl}\`. Start coding.
`;
}
