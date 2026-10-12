# Torture report: after-local-1000

- Client: `engine`
- Platform: `http://host.docker.internal:443`
- When: 2026-10-12 00:15 UTC
- Overall: 1000/1000 trials connected (100.0%)

Times are milliseconds. *Create* is the host's create call until it has a room code (engine hosts create 1.5 s after their socket is up, as an app's player would from a menu). *Join* is the guest's join call until it is in the room. *Connect* is from the guest starting until its first message comes back from the host. *Rung* is the path the connection used.

| Scenario | Connected | Connected on | Settled on | Create p50 / p95 | Join p50 / p95 | Connect p50 / p95 | RTT p50 | Longest stall p95 | Recovered |
|---|---|---|---|---|---|---|---|---|---|
| open | 125/125 | ws 125 | direct 125 | 2 / 3 | 4 / 6 | 9 / 12 | 1 | 61 | – |
| home-nat | 125/125 | ws 125 | direct 125 | 2 / 3 | 4 / 6 | 8 / 13 | 1 | 61 | – |
| cgnat | 125/125 | ws 125 | turn 90, ws 35 | 1 / 2 | 2 / 4 | 5 / 9 | 1 | 66 | – |
| udp-blocked | 125/125 | ws 125 | ws 125 | 1 / 3 | 2 / 4 | 5 / 9 | 2 | 92 | – |
| tcp443-only | 125/125 | ws 125 | ws 125 | 2 / 17 | 5 / 13 | 14 / 53 | 5 | 478 | – |
| lossy | 125/125 | ws 125 | direct 1, turn 90, ws 34 | 1 / 23 | 135 / 510 | 368 / 775 | 164 | 1037 | – |
| network-switch | 125/125 | ws 125 | direct 1, turn 99, ws 25 | 1 / 11 | 3 / 10 | 6 / 32 | 1 | 2590 | 125/125 |
| background | 125/125 | ws 125 | direct 124, turn 1 | 1 / 8 | 3 / 18 | 8 / 53 | 0 | 10367 | 125/125 |

## Scenarios

- **open**: both peers straight on the internet
- **home-nat**: both peers behind home routers
- **cgnat**: both peers behind carrier-grade NAT (symmetric, twice)
- **udp-blocked**: the guest's network drops UDP
- **tcp443-only**: the guest's network only lets TCP 443 out
- **lossy**: the guest is on a bad link: 60±20 ms each way, 5% loss
- **network-switch**: the guest switches networks mid-game
- **background**: the guest is frozen for 10 s mid-game
