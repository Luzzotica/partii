# Torture report: 2026-10-11-after-staging

- Client: `engine`
- Platform: `https://partii-edge-staging.partii-games.workers.dev`
- When: 2026-10-11 18:29 UTC
- Overall: 240/240 trials connected (100.0%)

Times are milliseconds. *Create* is the host's create call until it has a room code (engine hosts create 1.5 s after their socket is up, as an app's player would from a menu). *Join* is the guest's join call until it is in the room. *Connect* is from the guest starting until its first message comes back from the host. *Rung* is the path the connection used.

| Scenario | Connected | Connected on | Settled on | Create p50 / p95 | Join p50 / p95 | Connect p50 / p95 | RTT p50 | Longest stall p95 | Recovered |
|---|---|---|---|---|---|---|---|---|---|
| open | 30/30 | ws 30 | direct 30 | 56 / 62 | 91 / 108 | 167 / 199 | 0 | 179 | – |
| home-nat | 30/30 | ws 30 | direct 30 | 54 / 61 | 96 / 112 | 174 / 199 | 1 | 154 | – |
| cgnat | 30/30 | ws 30 | turn 30 | 54 / 81 | 95 / 102 | 171 / 211 | 48 | 265 | – |
| udp-blocked | 30/30 | ws 30 | ws 30 | 53 / 64 | 94 / 102 | 170 / 186 | 68 | 310 | – |
| tcp443-only | 30/30 | ws 30 | ws 30 | 58 / 69 | 92 / 104 | 173 / 220 | 69 | 293 | – |
| lossy | 30/30 | ws 30 | turn 29, ws 1 | 54 / 65 | 230 / 983 | 579 / 1295 | 228 | 957 | – |
| network-switch | 30/30 | ws 30 | turn 30 | 57 / 65 | 94 / 101 | 174 / 198 | 51 | 2909 | 30/30 |
| background | 30/30 | ws 30 | direct 30 | 52 / 62 | 94 / 101 | 169 / 187 | 1 | 11093 | 30/30 |

## Scenarios

- **open**: both peers straight on the internet
- **home-nat**: both peers behind home routers
- **cgnat**: both peers behind carrier-grade NAT (symmetric, twice)
- **udp-blocked**: the guest's network drops UDP
- **tcp443-only**: the guest's network only lets TCP 443 out
- **lossy**: the guest is on a bad link: 60±20 ms each way, 5% loss
- **network-switch**: the guest switches networks mid-game
- **background**: the guest is frozen for 10 s mid-game

## Notes

- **What was measured.** The partii engine (`partii bot`) against the staging edge: Cloudflare Workers + Durable Objects, with Cloudflare TURN. Both peers ran in Docker on one Mac, behind each scenario's real Linux NAT and filters, over the internet. A staging deploy happened mid-run; sessions resumed through it.
- **Compared with the baseline** (`2026-10-11-baseline.md`, today's partii driven by the party-kit TS client in Chromium, same scenarios):

| | Baseline | After |
|---|---|---|
| Create (p50) | 1,300–1,650 ms | 52–58 ms |
| Join call to first message (p50) | 5,500–6,100 ms | 167–174 ms (lossy: 579) |
| Join call to first message (p95, worst scenario) | 11,296 ms (lossy) | 1,295 ms (lossy) |
| Connected | 80/80 | 240/240 |
| Network-switch stall (p95) | 5,800 ms | 2,909 ms |

- **Engine timings.** *Join* and *Connect* run from the join call: the engine's socket is opened at launch, before a player presses Join.
- **Why "Connected on" is always ws.** Play starts on the relay over the session socket the moment both peers are in the room. *Settled on* is where it moved:
  - TURN for carrier-grade NAT and lossy networks
  - direct for open networks and home NATs
  - ws when UDP is blocked. Native webrtc-rs has no TCP/TLS TURN client, so the ws relay on 443 is the rung that works there.
- **Background stall.** The 11 s stall is the 10 s freeze itself; play resumes on the same path.
