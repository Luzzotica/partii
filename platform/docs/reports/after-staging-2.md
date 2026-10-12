# Torture report: after-staging-2

- Client: `engine`
- Platform: `https://partii-edge-staging.partii-games.workers.dev`
- When: 2026-10-12 00:27 UTC
- Overall: 120/120 trials connected (100.0%)

Times are milliseconds. *Create* is the host's create call until it has a room code (engine hosts create 1.5 s after their socket is up, as an app's player would from a menu). *Join* is the guest's join call until it is in the room. *Connect* is from the guest starting until its first message comes back from the host. *Rung* is the path the connection used.

| Scenario | Connected | Connected on | Settled on | Create p50 / p95 | Join p50 / p95 | Connect p50 / p95 | RTT p50 | Longest stall p95 | Recovered |
|---|---|---|---|---|---|---|---|---|---|
| open | 15/15 | ws 15 | direct 15 | 55 / 121 | 92 / 100 | 166 / 190 | 1 | 86 | – |
| home-nat | 15/15 | ws 15 | direct 15 | 55 / 61 | 94 / 104 | 167 / 183 | 1 | 60 | – |
| cgnat | 15/15 | ws 15 | turn 15 | 57 / 79 | 96 / 178 | 170 / 452 | 49 | 209 | – |
| udp-blocked | 15/15 | ws 15 | ws 15 | 58 / 69 | 100 / 229 | 172 / 451 | 70 | 207 | – |
| tcp443-only | 15/15 | ws 15 | ws 15 | 61 / 77 | 111 / 242 | 237 / 473 | 108 | 166 | – |
| lossy | 15/15 | ws 15 | turn 13, ws 2 | 54 / 74 | 215 / 526 | 565 / 856 | 248 | 1141 | – |
| network-switch | 15/15 | ws 15 | turn 15 | 55 / 83 | 97 / 213 | 175 / 440 | 51 | 3021 | 15/15 |
| background | 15/15 | ws 15 | direct 15 | 55 / 74 | 102 / 188 | 172 / 447 | 1 | 10582 | 15/15 |

## Scenarios

- **open**: both peers straight on the internet
- **home-nat**: both peers behind home routers
- **cgnat**: both peers behind carrier-grade NAT (symmetric, twice)
- **udp-blocked**: the guest's network drops UDP
- **tcp443-only**: the guest's network only lets TCP 443 out
- **lossy**: the guest is on a bad link: 60±20 ms each way, 5% loss
- **network-switch**: the guest switches networks mid-game
- **background**: the guest is frozen for 10 s mid-game
