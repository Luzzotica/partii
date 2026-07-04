import { PROTOCOL_MD } from "@/content/protocolDoc";

export const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

// ─────────────────────────────────────────────────────────────────────────────
// The Lobbii customer AI prompt.
//
// One self-contained Markdown document a developer pastes into an LLM to get a
// working multiplayer client on any platform, in under an hour. Composition:
//   1. Role framing + ask-the-platform-first table
//   2. Credentials (real key inlined, or placeholder mode)
//   3. The FULL wire spec — injected verbatim from content/protocolDoc.ts,
//      which is GENERATED from packages/party-kit/PROTOCOL.md (single source
//      of truth; edit there, run scripts/sync-party-kit.mjs)
//   4. Prompt-specific build requirements (recovery machine, push signaling,
//      telemetry, worked examples, acceptance checklist)
//   5. An OPTIONAL hardening appendix the LLM is told to SKIP unless asked —
//      the zero-config path (API key alone) must never be burdened.
// ─────────────────────────────────────────────────────────────────────────────

export function buildWebRTCPrompt(opts: { apiKey: string; baseUrl: string }): string {
  const { apiKey, baseUrl } = opts;
  const isPlaceholder = apiKey === API_KEY_PLACEHOLDER;
  const credentialsHeading = isPlaceholder
    ? "## Credentials (you must fill in the API key)"
    : "## Credentials (already filled in for you)";
  const credentialsFooter = isPlaceholder
    ? `Before running anything, replace \`${API_KEY_PLACEHOLDER}\` with a real API key from the developer dashboard at \`${baseUrl}/developer\`. If the user hasn't given you one, ask for it before writing code.`
    : "Hard-code these into a config module or accept them via constructor — the user does not need to provide them again.";

  return `# Build a multiplayer game client (WebRTC + Lobbii signaling)

You are a senior engineer. Build a working multiplayer client against the signaling API specified below. The model is host-authoritative: one **host** creates a room and accepts connections from one or more **clients** over peer-to-peer WebRTC data channels. This is general-purpose multiplayer — co-op, competitive, lobby-based, drop-in/drop-out — on any stack; the wire protocol is HTTP/JSON + an optional WebSocket push channel, so host and clients can run on entirely different platforms and interoperate.

**First, before writing any code:** if the user has not told you what target they want, ask: *"What language and platform are you building for — browser TypeScript, Godot, Rust, Unity, native Swift/Kotlin, something else? And are you building the host, the client, or both?"* Then write idiomatic code for that target using its standard WebRTC API:
- **Browser / TypeScript / JavaScript** → \`RTCPeerConnection\` + \`fetch\` + \`WebSocket\`
- **Godot 4** → \`WebRTCPeerConnection\` + \`HTTPRequest\` + \`WebSocketPeer\`
- **Rust** → \`webrtc-rs\` + \`reqwest\` + \`tokio-tungstenite\`
- **C# / Unity** → \`Unity.WebRTC\` + \`UnityWebRequest\` + \`ClientWebSocket\`
- **Swift / iOS** → Google's \`WebRTC.framework\` + \`URLSession\`
- **Kotlin / Android** → Google's \`webrtc\` Android lib + OkHttp / Ktor
- **Python** → \`aiortc\` + \`httpx\` + \`websockets\`
- **C++ / native** → \`libdatachannel\` or \`libwebrtc\` + any HTTP/WS client

The protocol is identical on every platform; only the API calls differ. Produce runnable, idiomatic code (no pseudocode) covering **both** roles unless the user specified only one:

- A **Host** module — creates rooms, accepts incoming clients, owns the authoritative data channel(s), broadcasts game state.
- A **Client** module — joins a room by code, exchanges messages with the host over WebRTC.
- A thin **signaling client** wrapping the REST endpoints + the optional push socket.

**Keep it simple.** The API key alone is a complete auth setup — there is no account system, no OAuth, no token dance required to ship a working game. Sections 1.2 (token exchange), 7 (players), and 8 (player content) of the spec, plus the appendices at the end, are OPTIONAL; skip them unless the user explicitly asks for sign-in, cloud saves/sharing, or launch hardening.

---

${credentialsHeading}

- **API key:** \`${apiKey}\`
- **Base URL:** \`${baseUrl}\`
- **Auth header on every request:** \`X-API-Key: <the api key above>\`

${credentialsFooter}

---

# THE WIRE SPEC (authoritative — implement exactly this)

Notes for reading it as a customer of the hosted service:
- Wherever the spec mentions per-game configuration, your values are the credentials above.
- \`kind\` values in §4.1 are just labels: use \`"screen"\` for game instances (gets a reliable \`state\` + unreliable \`input\` channel) or the default single \`data\` channel if your game is turn-based/low-rate. Pick ONE topology and use it consistently.
- §1.2 (token exchange) and anything about attestation is OPTIONAL hardening — covered in the appendix at the end. Everything else works with the raw API key.

${PROTOCOL_MD}

---

# Build requirements (in addition to the spec)

## 1. Push signaling with poll fallback (strongly recommended)

Room create/join responses include \`signal_gw\` (a WSS URL) and \`room_token\`. Implement §5 of the spec: hold the socket for the whole session, relax polling to 5000ms while it's open, snap back to 1500ms when it drops, and route BOTH delivery paths through one dedupe-by-\`signal_id\` function. If the platform has no WebSocket client, polling alone is fully correct — just slower to connect.

## 2. Connection recovery (REQUIRED — do not skip)

A live WebRTC connection WILL briefly drop on real networks — phones switching Wi-Fi↔cellular, NAT rebinds, hotel/corporate Wi-Fi. Your platform surfaces this as \`iceConnectionState\`/\`connectionState\` hitting \`disconnected\` or \`failed\`. **These states are RECOVERABLE.** The most common integration bug is treating the first one as fatal and tearing the peer down — turning a one-second blip into a lost session.

Implement the full §4.3 ladder on both roles:

1. **Never tear down on the first drop.** Enter a recovery window instead.
2. **Grace window ~10s**, one timer, only fire a real disconnect if still down when it elapses.
3. **ICE restart driven by the offerer** (\`createOffer({ iceRestart: true })\` → POST as a normal offer signal). The answerer just answers it — which means it MUST still be listening for signals mid-game.
4. **Tier-2, once per outage:** if the grace window expires, call \`POST /api/rooms/{roomId}/refresh-ice\` for a FRESH \`ice_servers\` array (the originals expire ~10 min after join — this is why plain restarts fail deep into a match), build a brand-new peer connection, and re-offer with \`"renegotiate": true\` in the offer payload. An answerer receiving a \`renegotiate\` offer while already connected mirrors: refresh-ice, rebuild, answer.
5. **Recovered = reset** the restart budget; **cap restarts at 2** per outage.

### Reference implementation (TypeScript — port the state-enum names to your stack)

\`\`\`ts
const RECOVERY_GRACE_MS = 10_000;
const MAX_ICE_RESTARTS = 2;

// role "host" = offerer (drives restarts + renegotiation); "client" answers.
// rebuildWithFreshIce(): call refresh-ice, construct a NEW RTCPeerConnection
//   from the returned servers, recreate channels, send an offer with
//   { renegotiate: true } merged into the payload. Resolve when sent.
function attachRecovery(
  pc: RTCPeerConnection,
  role: "host" | "client",
  sendRestartOffer: (offer: RTCSessionDescriptionInit) => Promise<void>,
  rebuildWithFreshIce: () => Promise<void>,
  onTerminalDisconnect: (reason: string) => void,
) {
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let iceRestarts = 0;
  let renegotiated = false;
  let fired = false;

  const healthy = () => {
    if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    iceRestarts = 0;
  };
  const fireOnce = (reason: string) => { if (!fired) { fired = true; onTerminalDisconnect(reason); } };

  const tryIceRestart = async () => {
    if (role !== "host" || iceRestarts >= MAX_ICE_RESTARTS) return;
    iceRestarts++;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await sendRestartOffer(offer);
    } catch { /* re-entered by the next state change, capped */ }
  };

  const startRecovery = (reason: string) => {
    if (fired || recoveryTimer) return;
    void tryIceRestart();
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      const s = pc.connectionState, i = pc.iceConnectionState;
      if (s === "connected" || i === "connected" || i === "completed") return;
      if (role === "host" && !renegotiated) {
        renegotiated = true;                     // tier-2: fresh relays, new pc
        try { await rebuildWithFreshIce(); return; } catch { /* fall through */ }
      }
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

Your "incoming offer" handler must run for offers arriving AFTER the channel is open (restart offers), and rebuild the peer connection first when the offer payload carries \`renegotiate: true\`.

## 3. Report connection telemetry (small, do it)

After every attempt, fire-and-forget \`POST /api/telemetry/connect\` per §6 of the spec (outcome, connect_ms, selected candidate type from getStats, signaling_path). Never block gameplay on it, never retry it. This is how connection bugs in the wild actually get found and fixed.

## Worked example — create a room

\`\`\`http
POST ${baseUrl}/api/rooms
X-API-Key: ${apiKey}
Content-Type: application/json

{ "game_id": "my-game", "display_name": "Dave's room", "max_peers": 4 }
\`\`\`

Response (note the FULL ice_servers ladder — STUN, self-hosted TURN, and Cloudflare TURN incl. \`turns:…:443\` for firewalled networks; pass the whole array into your PeerConnection config, never filter it):

\`\`\`json
{
  "room_id": "e742f30d-…", "join_code": "AB12CD",
  "host_secret": "…", "host_peer_id": "…", "host_peer_secret": "…",
  "room_token": "eyJ…", "signal_gw": "wss://arcade-signal.fly.dev",
  "expires_at": "2026-07-03T20:00:00Z",
  "ice_servers": [
    { "urls": ["stun:arcade-turn.fly.dev:3478", "stun:stun.l.google.com:19302"] },
    { "urls": ["turn:arcade-turn.fly.dev:3478?transport=udp", "turn:arcade-turn.fly.dev:3478?transport=tcp"],
      "username": "1783…:k=…:p=…", "credential": "…" },
    { "urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:80?transport=tcp",
               "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"],
      "username": "…", "credential": "…" }
  ]
}
\`\`\`

## Worked example — one ICE candidate POST from a client

\`\`\`http
POST ${baseUrl}/api/rooms/e742f30d-…/signals
X-API-Key: ${apiKey}
Content-Type: application/json

{ "recipient_peer_id": "host", "signal_type": "ice_candidate",
  "sender_peer_id": "<my peer_id>", "peer_secret": "<my peer_secret>",
  "payload": { "candidate": "candidate:842163049 1 udp …", "sdpMid": "0", "sdpMLineIndex": 0 } }
\`\`\`

## Acceptance checklist (verify before declaring done)

1. Host creates a room; a second instance joins by \`join_code\`; a reliable message round-trips.
2. If you implemented the unreliable \`input\` channel: a 30Hz counter stream runs 60s without head-of-line stalls.
3. Kill one side's network ~5s mid-session → the survivor recovers via ICE restart (no disconnect callback fired).
4. Kill ~15s → tier-2 renegotiation with refresh-ice fires; only if THAT fails does the app see a disconnect.
5. Append \`?relay=1\` (browser) or force \`iceTransportPolicy: relay\` → still connects (via TURN).
6. Signals are never applied twice (log dedupe hits while the push socket AND polling are both live).
7. Telemetry rows appear for every outcome.
8. Secrets (\`host_secret\`, \`peer_secret\`) never leave the machine that received them; never logged.

---

# APPENDIX (OPTIONAL): player accounts & sign-in — SKIP unless the user asks

Implement only if the user wants player identity (profiles, cross-device
accounts, "sign in with Steam/Apple/Google/Discord"). Spec §7 is authoritative.
The recommended integration ladder:

1. **Silent anonymous account (zero UI):** on first launch, generate + persist
   a device UUID, then \`POST /api/players/login {"provider":"anon","device_id":…}\`.
   Store the returned \`player_token\` (24h — re-login silently on 401). Every
   player now has an identity; cloud saves work with no sign-in screen.
2. **Bind multiplayer sessions to the player:** exchange
   \`POST /api/auth/token {"platform":"player","attestation":"<player_token>"}\`
   and use that session token for room/signaling calls.
3. **Optional "sign in" button:** when the user's game offers real sign-in,
   call \`POST /api/players/link\` with the platform proof (Steam ticket, Apple
   identity token, Google ID token, Game Center signature, Discord code — see
   the §7.1 table for exact fields and what the developer must configure in
   the dashboard). Linking makes the anonymous account recoverable on other
   devices: logging in there with the same provider returns the SAME player.
4. Handle \`409 identity_already_linked\` by asking the player whether they want
   to switch to their existing account (just \`login\` with that provider instead).

# APPENDIX (OPTIONAL): cloud saves & sharing — SKIP unless the user asks

Implement only if the user wants replays, shareable levels, or cloud saves.
Spec §8 is authoritative. Notes that make it good:

- Content is owned by the player (needs a \`player_token\` — the silent
  anonymous account from the previous appendix is enough; no sign-in UI).
- Small JSON (levels, most saves): one \`POST /api/player-content\` with the
  \`data\` inline. Big/binary (replays): \`upload-url\` → PUT bytes → \`finalize\`.
- **Replays for deterministic games:** store \`{seed, inputsPerTick}\` — a few
  KB — and replay by re-simulating. Never record per-frame state.
- Sharing: set \`visibility: "public"\` (browsable by everyone in the game) or
  \`"unlisted"\` + give players the \`share_code\` to exchange (fetch with
  \`GET /api/player-content?share_code=XXXX\`).
- Quotas return 402 — surface "storage full" to the player gracefully.

# APPENDIX (OPTIONAL): hardening for launched games — SKIP unless the user asks

Do not implement any of this by default. It adds no gameplay value; it protects a popular game's API key from abuse. If the user asks about "someone stealing my key", rate abuse, or launch hardening, walk them up this ladder (each rung is independent, configured in the developer dashboard at ${baseUrl}/developer under the project's Settings):

1. **Origin allowlist** — list the exact web origins your game runs on. Zero client code. Browsers from other origins can't exchange the key for tokens.
2. **Session tokens with Turnstile (web)** — create a free Cloudflare Turnstile widget for YOUR domains; paste the widget SECRET into project settings; render the widget (invisible mode) in your game with YOUR site key; implement §1.2 of the spec: exchange \`{ platform: "web", attestation: <turnstile token>, device_id: <persisted uuid> }\` for a Bearer session token, refresh before expiry, back off ≥60s on failure and fall back to the raw key.
3. **Steam builds** — paste your Steam PUBLISHER Web API key + App ID into project settings; exchange \`{ platform: "steam", attestation: <hex auth session ticket>, steam_id }\` instead. Gives every player a verified \`steam:<id64>\` identity.
4. **Enforcement toggle** — once your shipped clients all exchange tokens, flip "Require session tokens" in project settings. Raw keys then stop working for gameplay routes; a leaked key becomes nearly worthless.
`;
}
