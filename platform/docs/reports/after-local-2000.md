# Torture report: after-local-2000

- Client: `engine`
- Platform: `http://host.docker.internal:443`
- When: 2026-10-12 07:49 UTC
- Overall: 2000/2000 trials connected (100.0%)

Times are milliseconds. *Create* is the host's create call until it has a room code (engine hosts create 1.5 s after their socket is up, as an app's player would from a menu). *Join* is the guest's join call until it is in the room. *Connect* is from the guest starting until its first message comes back from the host. *Rung* is the path the connection used.

| Scenario | Connected | Connected on | Settled on | Create p50 / p95 | Join p50 / p95 | Connect p50 / p95 | RTT p50 | Longest stall p95 | Recovered |
|---|---|---|---|---|---|---|---|---|---|
| open | 250/250 | ws 250 | direct 250 | 2 / 5 | 4 / 7 | 8 / 15 | 1 | 62 | – |
| home-nat | 250/250 | ws 250 | direct 250 | 2 / 5 | 4 / 6 | 8 / 11 | 1 | 61 | – |
| cgnat | 250/250 | ws 250 | turn 160, ws 90 | 1 / 4 | 4 / 7 | 8 / 14 | 1 | 98 | – |
| udp-blocked | 250/250 | ws 250 | ws 250 | 2 / 4 | 4 / 6 | 8 / 15 | 3 | 104 | – |
| tcp443-only | 250/250 | ws 250 | ws 250 | 1 / 3 | 4 / 6 | 9 / 13 | 3 | 102 | – |
| lossy | 250/250 | ws 250 | turn 173, ws 77 | 1 / 3 | 131 / 425 | 346 / 703 | 157 | 906 | – |
| network-switch | 250/250 | ws 250 | direct 3, turn 201, ws 46 | 1 / 4 | 6 / 10 | 13 / 21 | 1 | 2554 | 250/250 |
| background | 250/250 | ws 250 | direct 250 | 1 / 4 | 6 / 11 | 13 / 22 | 1 | 10167 | 250/250 |

## Scenarios

- **open**: both peers straight on the internet
- **home-nat**: both peers behind home routers
- **cgnat**: both peers behind carrier-grade NAT (symmetric, twice)
- **udp-blocked**: the guest's network drops UDP
- **tcp443-only**: the guest's network only lets TCP 443 out
- **lossy**: the guest is on a bad link: 60±20 ms each way, 5% loss
- **network-switch**: the guest switches networks mid-game
- **background**: the guest is frozen for 10 s mid-game
