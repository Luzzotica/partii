# partii platform goal, stages 1–2: status (2026-10-11)

Each "done when" line of the goal is listed with its evidence. Branches: partii `platform-v1`, tankii `partii-v1`, bouncy-blobs-bevy `partii-v1`. Nothing has been merged to main. The API runs only on staging; the websites are on Vercel production (owner-approved).

## Connections: before and after

| | Baseline (old party-kit, staging) | After: staging, 120 trials | After: local, 1000 trials | After: local, 2000 trials |
|---|---|---|---|---|
| Connected | 80/80 | **120/120** | **1000/1000** | **2000/2000** |
| Create p50 / p95 | 1400 / 2200 ms | **55 / 121 ms** | 2 / 23 ms | 1–2 / 3–5 ms |
| Join→connected p50 / p95 (normal networks) | 5500–5900 / 5700–6000 ms | **166–237 / 183–473 ms** | 5–14 / 9–53 ms | 8–13 / 11–22 ms |
| Join→connected on the lossy network p50 / p95 | 6128 / 11296 ms | 565 / 856 ms | 368 / 775 ms | 346 / 703 ms |
| Network switch recovered | 10/10, 5.8 s stall | 15/15 | 125/125 (2.6 s stall p95) | 250/250 (2.6 s stall p95) |
| Backgrounding recovered | 10/10 | 15/15 | 125/125 | 250/250 |

Targets: create <150 ms (met: 121 ms p95); join→connected <1 s typical and <3 s p95 (met: 856 ms worst p95); 99.9% connect success (**3120/3120** across all three runs; with zero failures in 3120 attempts, the 95% upper bound on the failure rate is 0.096%, so success is ≥ 99.9% at 95% confidence).

Reports: `2026-10-11-baseline.md`, `after-staging-2.md`, `after-local-1000.md`, `after-local-2000.md`; raw data in `raw/`. Routes taken: `open` and `home-nat` go direct; `cgnat` uses TURN, or the ws relay when TURN is slower; `udp-blocked` and `tcp443-only` use the ws relay on 443.

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
| Small green commits; no merge to main or prod deploy | ✅ | every change is a small commit on the branches above; the API runs only as the `partii-edge-staging` Worker; the websites went to Vercel production with the owner's go-ahead |

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

## Since the first status (same day)

| Goal item | Status | Evidence |
|---|---|---|
| tankii versus/co-op over partii on **Windows** | ✅ networking / ⚠️ rendering not verifiable here | Windows store build (`build-windows.sh --partii`, cargo-xwin) runs in the Parallels Windows 11 VM: it reaches partii, joins the staging room, syncs live content and starts WebRTC. The VM's only Direct3D 12 adapter is Microsoft's software WARP ("Basic Render Driver"), and WARP access-violates on the renderer (fault module `d3d10warp.dll`; GL backend: no adapter). Real hardware GPUs don't take this path. Networking was verified headless with `partii_peer`: a Windows guest in the VM ↔ Mac host over staging, joined + connected 816 ms, 50/50 reliable + 50/50 input echoes, `PEER OK on windows`. A full rendered run needs a Windows PC with a GPU (owner hardware). |
| tankii **sold and played on phones** | ✅ Android via the store | gated Android store build (98 MB APK, native lib compressed) uploaded with `partii builds upload tankii --platform android`; downloaded from the store by a paying player (HTTP 200, sha256 matches); fresh install keeps one guest across launches; `partii test purchase` (Stripe test mode, $5) for that guest; next launch: `full game unlocked`. iOS store distribution needs signing/TestFlight (owner step); iOS unlock by purchase was shown on the simulator. |
| Bug found: Android guest identity | fixed | `partii-account` made the device id with a hard link, which Android SELinux forbids; every launch became a new guest. Now `O_EXCL` create (still race-safe; tests pass). |
| 99.9% connect success | ✅ | `after-local-2000.md`: 2000/2000, every scenario 250/250. With the 1000 local + 120 staging runs: 3120/3120. (A first try of this run was void: the harness never waited on killed `docker exec` children, and after ~1800 trials the zombies hit the macOS per-user process cap, so the last 193 trials could not start. Fixed in the harness; no platform change.) |
| Direct-to-R2 uploads | ✅ | `partii builds upload` signs a direct PUT to R2 with a sha256 checksum (R2 rejects bad bytes); the 100 MB Workers request cap no longer limits builds. tankii Windows 0.4.49 (173 MB) went up this way. |
| Websites on Vercel | ✅ (owner-approved production) | store, tankii controller and bouncy-blobs controller are production Vercel projects tied to git (main = production, branches = previews). The API stays on Cloudflare (`partii-edge-staging`). |

## Owner items (not part of done)

- Roll the Luzzotica Stripe test key; it leaked into the session transcript. Then re-run `stripe login` so the staging secret can be refreshed.
- App Store / Play accounts, TestFlight and review; production deploy; real phones on carrier networks.
- A Windows PC with a GPU (or a VM with hardware Direct3D 12) for a rendered Windows playtest.
- Old replays recorded before the deterministic-math change (2026-10-11) desync: accept, or version the sim math.
- Linux build machine connection details.
