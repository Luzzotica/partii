# partii live protocol (v1)

How a client talks to the edge over its one persistent socket. The engine
(`crates/partii-engine`) implements the client side; `edge/src/session.ts`
and `edge/src/room.ts` implement the server side. `test/protocol.test.ts`
covers every message.

## Connecting

```
wss://<edge>/v1/connect?conn=<conn_id>
```

- `conn_id`: 16–64 characters of `[A-Za-z0-9_-]`, random per app launch.
- Reconnecting with the same `conn_id` within the grace window (20 s) **resumes** the session: room membership is kept and events that arrived while the socket was down are replayed in order.
- After the grace window the session is gone, and the room drops the member.

The first frame must be `hello`. Until the server answers `welcome`, nothing else is accepted.

## Frames

- **Text frames** carry JSON control messages, `{"t": "<type>", ...}`.
  - Requests include an `id` (any string or number). Each one gets exactly one reply: `{"t":"ok","id":…}` or `{"t":"err","id":…,"code":…,"message":…}`.
  - Events from the server have no `id`.
- **Binary frames** carry relayed game packets (the `ws` path):
  - Client to server: `[0x01][to: u16 BE][payload…]` sends to member `to`. `0xFFFF` means every other member.
  - Server to client: `[0x01][from: u16 BE][payload…]`.
  - Payloads are opaque to the edge, up to 64 KiB.

## Client to server

| `t` | Fields | Reply |
|---|---|---|
| `hello` | `key` (publishable key), `v: 1`, `player_token?`, `client?` (free-form, e.g. `"tankii/0.9 macos"`) | `welcome`: `conn`, `project`, `resumed`, `ice_servers`, `ice_expires_at`, `server_time`, `room?` (when resumed in a room) |
| `create` | `id`, `game`, `max_members?` (default 8, max 32), `kind?` (default `"game"`), `name?`, `meta?` | `ok`: `room` |
| `join` | `id`, `code`, `kind?`, `name?`, `meta?` | `ok`: `room`. Errors: `not_found`, `full`, `closed`, `not_joinable`, `already_in_room` |
| `leave` | `id` | `ok` |
| `update` | `id`, `joinable?`, `meta?`, `max_members?` (host only) | `ok`: `room` |
| `kick` | `id`, `mid` (host only) | `ok` |
| `signal` | `to` (mid), `data` (any JSON) | none. The target gets `signal {from, data}` |
| `ping` | `id` | `ok`: `server_time` |
| `report` | `metrics` (object: connect timings, rung, RTT) | none |

## Server to client

| `t` | Fields |
|---|---|
| `welcome` | see `hello` |
| `member_joined` | `member` |
| `member_left` | `mid`, `reason` (`left`, `kicked`, `timeout`) |
| `member_suspended` | `mid`: its socket dropped; the seat is held for the grace window |
| `member_resumed` | `mid` |
| `room_updated` | `room` |
| `room_closed` | `reason` (`host_left`, `ended`) |
| `signal` | `from`, `data` |
| `ice` | `ice_servers`, `ice_expires_at` (fresh relay credentials before the old ones expire) |

A **room** is `{code, game, host: mid, you: mid, joinable, max_members, meta, members: [member]}`.
A **member** is `{mid, kind, name, meta, status: "active" | "suspended"}`.

`ice_servers` always contains `turns:` on port 443 when relay is available.
If the relay can't be reached, it is empty and `relay` is `"ws"`, and the
client relies on the `ws` path. The edge never hands out a STUN-only list.

## Errors

`err` codes: `bad_request`, `unauthorized`, `not_found`, `full`, `closed`, `not_joinable`, `already_in_room`, `not_in_room`, `not_host`, `rate_limited`, `internal`.

### Limits

Staging and production limit each IP (sized far above real play; `LIMITS` in `edge/src/limits.ts`, switched on by the `RATE_LIMITS` var):

| What | Per IP | Refused with |
|---|---|---|
| WebSocket upgrades on `/v1/connect` | 120 / min | HTTP 429, before any session |
| New sessions (a `hello` that is not a resume) | 30 / min | `err` `rate_limited` (no `id`), then the socket closes with code 4029; clients back off and reconnect |
| `create` | 30 / min | `err` `rate_limited` |
| `join` | 60 / min | `err` `rate_limited` |

Relayed packets on the `ws` path have a budget per session: 2000 deliveries a second (one frame to one member is one delivery; a broadcast to seven members is seven), with a burst of 4000. Over budget, frames are dropped and counted; the engine's link resends what is reliable.
