# partii platform goal, stages 1–2: status (2026-10-11)

Each "done when" line of the goal is listed with its evidence. Branches: partii `platform-v1`, tankii `partii-v1`, bouncy-blobs-bevy `partii-v1`. Nothing has been merged to main, and nothing has been deployed beyond staging.

## Connections: before and after

| | Baseline (old party-kit, staging) | After: staging, 120 trials | After: local, 1000 trials |
|---|---|---|---|
| Connected | 80/80 | **120/120** | **1000/1000** |
| Create p50 / p95 | 1400 / 2200 ms | **55 / 121 ms** | 2 / 23 ms |
| Join→connected p50 / p95 (normal networks) | 5500–5900 / 5700–6000 ms | **166–237 / 183–473 ms** | 5–14 / 9–53 ms |
| Join→connected on the lossy network p50 / p95 | 6128 / 11296 ms | 565 / 856 ms | 368 / 775 ms |
| Network switch recovered | 10/10, 5.8 s stall | 15/15 | 125/125 (2.6 s stall p95) |
| Backgrounding recovered | 10/10 | 15/15 | 125/125 |

Targets: create <150 ms (met: 121 ms p95); join→connected <1 s typical and <3 s p95 (met: 856 ms worst p95); 99.9% connect success (1120/1120 across both runs).

Reports: `2026-10-11-baseline.md`, `after-staging-2.md`, `after-local-1000.md`; raw data in `raw/`. Routes taken: `open` and `home-nat` go direct; `cgnat` uses TURN, or the ws relay when TURN is slower; `udp-blocked` and `tcp443-only` use the ws relay on 443.

## Done-when checklist

| Done when | Status | Evidence |
|---|---|---|
| All tests pass: partii | ✅ | Worker 53/53 (vitest); Rust workspace 871 passed, 0 failed (engine, CLI, api, account, content, vendored webrtc); controller, store and real-Stripe e2e scripts |
| All tests pass: tankii, bouncy-blobs | ✅ | tankii `cargo test --workspace`: 1548 passed, 0 failed (plus the 100/100 AI clear check); bouncy-blobs: 171 passed, 0 failed (plus the bb-net live test on staging and the web-controller e2es) |
| Every torture scenario connects, locally and on staging; the after report meets the targets | ✅ | table above |
| Two-window tankii co-op of one biome over staging; host and guest match | ✅ | Meadow run on staging; host and guest screenshots match level by level (same map, tanks, kills, MISSION CLEAR) |
| iOS simulator + Android emulator co-op | ✅ (local and staging) | desktop host + iOS sim + Android emu in one co-op room on **staging** (room MQFLB): same level and layout on all three; earlier the same on the local platform. The Android emulator needs `-no-window -gpu host` on this Mac (the windowed emulator hangs at startup; SwiftShader trips a wgpu buffer limit) |
| Browser-driven controller seat | ✅ | `apps/controller/test/seat-e2e.mjs` against a real tankii host (seat P1, 175 ms join); sign-in e2e brings the player's name and look |
| The agent publishes both games through the CLI, sets prices, and makes Stripe test purchases that unlock desktop and a simulator | ✅ | both games published on staging at $5 with macOS builds; `partii test purchase` (Stripe test mode) unlocked the desktop store build and the iOS sim for one account; real hosted Checkout + webhook e2e (`apps/store` `test:stripe`) for both games |
| The docs proof passes | ✅ | a fresh agent, using only `docs/GUIDE.md` + CLI, added multiplayer, accounts with cloud saves, and a $5 unlock to a blank Bevy game; its 16 doc gaps are fixed (the engine now holds create/join until it is online) |
| Small green commits; no merge to main or prod deploy | ✅ | every change is a small commit on the branches above; Cloudflare holds only `*-staging` Workers |

## Built (by goal section)

1. **Connections.**
   - One Rust engine (`crates/partii-engine`), native and wasm (a Rust `Engine` plus JS `WebEngine`).
   - Persistent WebSocket to a CF Worker; Durable Objects per room and per session; warm rooms.
   - Relay first, then TURN or direct by measured RTT with hysteresis; ws relay on 443 as the last rung.
   - Seat grace window, network-switch and background recovery.
   - party-kit TS, party-kit-native and bb-net's own transport are deleted (source archived in `~/Archive`).
2. **Proof harness.** Docker torture topologies (CGNAT, UDP blocked, 443-only, loss/jitter, network switch, background). Baseline and after reports; tankii's harness has a partii transport.
3. **CLI.**
   - JSON, non-interactive, idempotent, `--dry-run`, env tokens, actionable errors, `help --json`.
   - Commands generated from `api/openapi.yaml`.
   - `partii dev`, `bot`, `torture`, `content push`.
4. **Accounts, saves, purchases, store.**
   - Guest sign-in, email/provider linking, account deletion.
   - Cloud saves with conflict merge and backups (`partii-account`).
   - Entitlements from Stripe (live webhook), Steam, App Store/Play receipts.
   - React store (staging) with a demo gate setting.
   - Live content (`partii-content`, used by tankii for brains and maps).
5. **tankii.**
   - partii transport for versus and co-op.
   - iOS and Android builds with touch twin-stick controls.
   - QR phone controller (React) with sign-in that brings name and look.
   - Deterministic sim math (`dmath`), with identical golden hashes on aarch64, x86_64 and wasm32.
6. **Stage 2.**
   - bouncy-blobs runs on the shared engine (`bb-net` sessions), `partii-account` (roaming progress and maps), the store ($5, published) and its phone page on `WebEngine`.
   - No partii server changes were needed for it.
   - Docs proof passed.

## Owner items (not part of done)

- Roll the Luzzotica Stripe test key; it leaked into the session transcript. Then re-run `stripe login` so the staging secret can be refreshed.
- Optional: enable R2. Builds over 25 MB are stored as KV chunks until then.
- App Store / Play accounts, TestFlight and review; production deploy; real phones on carrier networks.
