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
| `hello` | `key` (publishable key), `v: 1`, `player_token?`, `client?` (free-form, e.g. `"tankii/0.9 macos"`), `caps?` (`["reset"]`: this engine restarts its link to a member that comes back fresh), `fresh?` (this engine is new, e.g. a reloaded page reusing its `conn`) | `welcome`: `conn`, `project`, `resumed`, `ice_servers`, `ice_expires_at`, `server_time`, `room?` (when resumed in a room) |
| `create` | `id`, `game`, `max_members?` (default 8, max 32), `kinds?` (see below), `reclaim?` (`{code, token}`, see below), `kind?` (default `"game"`), `name?`, `meta?` | `ok`: `room` (with `reclaim`, the host's token), `reclaimed?` (when `reclaim` was asked) |
| `join` | `id`, `code`, `kind?`, `name?`, `meta?` | `ok`: `room` (and `resumed: true` when your session is already in that room: same seat, no new member). Errors: `not_found`, `full` (the room, or your kind's `max`), `closed`, `not_joinable` (the room, or your kind), `already_in_room` |
| `leave` | `id` | `ok` |
| `update` | `id`, `joinable?`, `meta?`, `max_members?`, `kinds?` (host only) | `ok`: `room` |
| `member_update` | `id`, `name?`, `meta?`: your own member | `ok`: `member`. The others get `member_updated` |
| `kick` | `id`, `mid` (host only) | `ok` |
| `signal` | `to` (mid), `data` (any JSON) | none. The target gets `signal {from, data}` |
| `ping` | `id` | `ok`: `server_time` |
| `report` | `metrics` (object: connect timings, rung, RTT) | none |

## Server to client

| `t` | Fields |
|---|---|
| `welcome` | see `hello` |
| `member_joined` | `member` |
| `member_updated` | `member` (it changed its own name or meta) |
| `member_left` | `mid`, `reason` (`left`, `kicked`, `timeout`) |
| `member_suspended` | `mid`: its socket dropped; the seat is held for the grace window |
| `member_resumed` | `mid`, `reset?` (true: it came back as a new engine, so restart your reliable link to it from zero) |
| `room_updated` | `room` |
| `room_closed` | `reason` (`host_left`: the host left; `host_lost`: the host's connection timed out and it may reclaim the code, so phones can keep trying to rejoin for a few minutes; `kicked`, `ended`) |
| `signal` | `from`, `data` |
| `ice` | `ice_servers`, `ice_expires_at` (fresh relay credentials before the old ones expire) |

A **room** is `{code, game, host: mid, you: mid, joinable, max_members, kinds?, meta, members: [member]}`.

**Fresh resume.** A `hello` with `fresh: true` on a session that is in a room means a new engine took over (a reloaded page): its reliable links start from zero. If every other member's engine sent `caps: ["reset"]`, they get `member_resumed {mid, reset: true}` and restart their link to it, so the seat is kept. Otherwise the stale member leaves at once (`member_left`), the welcome has no room, and the client's next `join` makes it a new member.

**Reclaim.** The host's `create` reply carries `room.reclaim`, a token only the host gets. If the host's session times out (not when it leaves), the room closes with `host_lost` and its code is held for 10 minutes: a `create` with `reclaim: {code, token}` from any new session gets that same code back (`reclaimed: true`, and a new token). Anything else (wrong token, expired, the host left on purpose) makes a fresh code with `reclaimed: false`. This keeps printed and on-screen QR codes working through a host's network drop.

**Kinds.** `kinds` sets rules per member kind: `{"game": {"joinable": false}, "phone": {"max": 16}}`. A join of a kind with `joinable: false` gets `not_joinable`; a join when that kind already has `max` members gets `full`. Kinds without a rule follow the room's `joinable` and `max_members`, which still apply to everyone. On `update`, `kinds` merges per kind, and a kind set to `null` drops its rule (`"kinds": null` drops all). At most 8 kinds. Typical home room: phones always welcome, games only while hosting: create with `{"game": {"joinable": false}}`, then `update` `{"kinds": {"game": {"joinable": true}}}` on HOST.
A **member** is `{mid, kind, name, meta, status: "active" | "suspended"}`.

`ice_servers` always contains `turns:` on port 443 when relay is available.
If the relay can't be reached, it is empty and `relay` is `"ws"`, and the
client relies on the `ws` path. The edge never hands out a STUN-only list.

## Errors

`err` codes: `bad_request`, `unauthorized`, `not_found`, `full`, `closed`, `not_joinable`, `already_in_room`, `not_in_room`, `not_host`, `rate_limited`, `internal`.

`rate_limited` always carries `retry_after_ms`: wait that long (plus a little jitter) before trying again. Show the player that the network is busy, and give up after about a minute.

(The edge has an internal `reserved` code, for a join racing a brand-new room. It retries that itself and answers `not_found` if it persists; clients never see it.)

### Limits

Staging and production limit each IP (sized far above real play; `LIMITS` in `edge/src/limits.ts`, switched on by the `RATE_LIMITS` var):

| What | Per IP | Refused with |
|---|---|---|
| WebSocket upgrades on `/v1/connect` | 120 / min | HTTP 429 with `retry-after` (seconds) and `error.retry_after_ms`, before any session |
| New sessions (a `hello` that is not a resume) | 60 / min | `err` `rate_limited` (no `id`), then the socket closes with code 4029; clients back off and reconnect |
| `create` | 30 / min | `err` `rate_limited` |
| `join` | 60 / min | `err` `rate_limited` |

Relayed packets on the `ws` path have a budget per session: 2000 deliveries a second (one frame to one member is one delivery; a broadcast to seven members is seven), with a burst of 4000. Over budget, frames are dropped and counted; the engine's link resends what is reliable.
