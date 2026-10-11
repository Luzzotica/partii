# partii platform v1: design

The goal (owner, 2026-10-11): partii becomes an AI-friendly game platform
(connect, accounts, saves, purchases, store, phone controllers) driven by a
CLI. tankii is sold and played on it from desktop and phones. bouncy-blobs
runs on it with no new platform code.

This doc pins the architecture. Everything new lives under `platform/` in
the partii repo. The legacy Next.js site (arcade, courses, the old Lobbii
REST rooms) is left alone and keeps serving old clients.

## Pieces

| Piece | Where | What |
|---|---|---|
| Edge | `platform/edge` | One Cloudflare Worker: the HTTP API (Hono) plus Durable Objects for live sessions and rooms. D1 holds records, R2 holds builds, saves and content. |
| Engine | `platform/crates/partii-engine` | The one connection engine (Rust): session socket, rooms, peer links with path selection, reliability, recovery. Native and wasm. |
| CLI | `platform/crates/partii-cli` | `partii`: every developer action, the local platform (`partii dev`), bots and the torture harness. |
| API spec | `platform/api/openapi.yaml` | The source of truth for HTTP routes. It generates the edge's types, the CLI's client and the docs. |
| Store | `platform/apps/store` | A Vite + React SPA: game pages, checkout, library. Plain React so it can ship later as a Tauri app. |
| Controller | `platform/apps/controller` | A small React page a phone opens from a QR code. It joins as a `phone` peer through the wasm engine. |
| Torture harness | `platform/torture` | Docker topologies (real Linux NAT, iptables, netem) that run CLI bots through bad networks and write a report. |

Why Workers and D1 instead of Vercel and Supabase:
- `partii dev` is one process (`wrangler dev`, with local D1, R2 and Durable Objects).
- Tests run inside the real runtime.
- There are no cold starts on the hot path.
- Staging deploys with one command.

The identity verifiers (Apple, Google, Game Center, Steam, Discord) port
over from `lib/api/identity`, since they are plain `jose`/`fetch` code.

## Live connections

```
client ──WebSocket──▶ Session DO (one per client launch, near the client)
                         │  RPC
                         ▼
                      Room DO (one per room, near the host): members, seats, host
Session A ──RPC──▶ Session B   (signaling and relayed packets go session to session)
```

- **Session socket.** A client opens `wss://<edge>/v1/connect/<conn_id>` at launch and keeps it.
  - `conn_id` is random per launch. Reconnecting with the same id resumes the session, which buffers messages during a grace window. That covers phones switching networks and coming back from the background.
  - The first frame is `hello`: a publishable key plus an optional player token.
  - Publishable keys are signed (`pk_<project>_<sig>`), so checking one needs no database. Revocations come from a list cached per isolate.
- **Rooms.** `create` and `join` are messages on the session socket.
  - A Room DO is named by `project:code`, so a join needs no lookup.
  - The Room DO gets created next to the host's session, which keeps creates fast.
  - Room records are written to D1 in the background, never awaited.
- **ICE servers** are minted when the session connects and refreshed before they expire, so `join` returns them with no outbound call.
  - Cloudflare TURN is the only relay. The list always includes `turns:…:443`.
  - A project over its relay cap is throttled (a lower relay rate), never handed a STUN-only list.
- **Seats.** If a member's session drops, the Room keeps the seat for a grace window (default 20 s). Peers see `peer_suspended`, then either `peer_resumed` or `peer_left`.

## Peer links (engine)

Every peer pair has one **link** with up to three **paths**:

1. `ws`: packets relayed session to session over the sockets the clients already have. Ready the instant both are in the room, and works on any network that allows 443. This is the last rung, and it carries play while the others come up.
2. `turn`: a WebRTC peer connection restricted to relay candidates (Cloudflare TURN). Usually up within a few hundred milliseconds.
3. `direct`: a WebRTC peer connection that uses host and server-reflexive candidates only. It's tried in the background and used only if it measures faster.

Each path is a datagram pipe. The link pings every path (250 ms), keeps an RTT/loss estimate, and sends on the best healthy one with hysteresis:
- It switches to a better path only when that path is faster by at least 10% and 5 ms for 1 s.
- It fails over immediately when the current path misses pongs for 1 s.

Reliability lives in the link, not in the paths:
- Reliable messages carry sequence numbers, cumulative plus bitfield acks, retransmit on RTO, ordered delivery, and fragmentation (≤1150-byte datagrams).
- So switching paths never loses or reorders a reliable message.
- Unreliable messages go straight out on the current path.

The engine is sans-IO at its core:
- Protocol, link, ARQ and path selection are pure state machines driven by `(now, input) → outputs`, tested with a simulated clock.
- Drivers provide sockets and WebRTC per platform: tokio + tungstenite + webrtc-rs natively, web-sys in wasm.

## Control plane (HTTP, D1)

Developers, projects, keys, games, builds, store pages, prices, sales, keys
(codes), entitlements, purchases, players, identities, saves, content
channels, test accounts and connection timings. Every route is in
`openapi.yaml`.

- **Developer auth:** a developer token (`PARTII_TOKEN`) is minted by `partii login`. In dev and tests, a bootstrap admin token creates the first developer.
- **Player auth:** a guest player on first launch (device id). Apple, Google, Discord, Steam and email are linked later. Linking merges a guest into an existing player.
- **Entitlements:** recorded on the player from any of:
  - Stripe Checkout (webhook)
  - Steam ownership (publisher API)
  - App Store transactions (JWS, verified against Apple's root)
  - Google Play purchases (Play Developer API)
  - developer grants or test purchases

  One purchase unlocks every device the player signs in on. A game asks `GET /v1/me/entitlements`. A short-lived signed copy lets it stay unlocked offline.
- **Demo gate:** a game's `demo` setting (for example `{ "free_levels": 20 }`) plus the SKU that lifts it.
- **Saves:** named slots per player per game in R2. Each write carries a base revision; a mismatch returns `409` with both copies, so the game merges and retries. Every write keeps a backup revision.
- **Content channel:** versioned data bundles (levels, elements, brains) per game. Clients fetch the manifest at launch and pull changed files.

## The CLI

- `partii <noun> <verb>`.
- Every command prints one JSON document: `{"ok":true,...}` or `{"ok":false,"error":{"code","message","hint"}}`.
- Nothing is interactive. `--dry-run` works on every mutation, and mutations are idempotent (natural keys or `--id`).
- The token comes from `PARTII_TOKEN` and the endpoint from `PARTII_API` (or `--api`).
- `partii help --json` prints the full command tree with arguments and examples.
- `partii dev` runs the platform locally with fake stores, fake logins and simulated networks.
- `partii bots` starts headless engine peers.
- `partii torture` runs the harness.

## Proof

- Edge: Vitest in the Workers runtime, covering every route and Durable Object.
- Engine: unit tests on the sans-IO core (simulated clock and loss), plus integration tests against `wrangler dev`.
- CLI: a golden test per command against a local edge.
- Torture: a scenario matrix of networks × trials, with p50/p95 phase timings, the rung each connection used, and the success rate. Run locally (coturn in Docker standing in for Cloudflare TURN) and against staging. The report goes in `platform/docs/reports/`.
- Baseline: the same bots driving today's Lobbii REST protocol through `party-kit-native`, before anything is replaced.
