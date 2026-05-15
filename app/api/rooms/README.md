# Rooms — WebRTC signaling backend

A general-purpose WebRTC signaling backend. One concept: a **room**. Inside a room there are **peers** — phones, screens, spectators, anything the calling app wants to model. The backend doesn't interpret peer kinds; it just routes signals.

This is the surface to integrate against if you're building a real-time multiplayer or remote-controller experience. Everything below works regardless of whether your peers are phones, laptops, or arbitrary WebRTC clients.

## Auth

Every request needs `X-API-Key: <key>` (or `Authorization: Bearer <key>`). One-time API keys are issued from the hexii developer dashboard. Rate-limited and metered.

## Concepts

| Concept | Role |
|---|---|
| Room | Host-owned container for a multiplayer session. Has a join code, a visibility flag, a peer cap. |
| Peer | A participant in a room. Has a `kind` (app-defined string), a slot, optional metadata. Host gets a peer row too. |
| Signal | A WebRTC offer / answer / ICE candidate sent between two peers. Polled from the backend on a since_id cursor. |

## Endpoints

```
POST   /api/rooms                                   create
GET    /api/rooms?game_id=X                         list public rooms
GET    /api/rooms/lookup?code=ABC123                resolve a join code
GET    /api/rooms/:id                               full room + peer roster
PATCH  /api/rooms/:id                               host-only: status / visibility / joinable / max_peers / metadata
POST   /api/rooms/:id/peers                         join (server generates peer_secret)
PATCH  /api/rooms/:id/peers/:peerId                 peer self-update (status, metadata, display_name)
DELETE /api/rooms/:id/peers/:peerId?peer_secret=X   soft-leave (marks disconnected)
GET    /api/rooms/:id/signals?recipient_peer_id&since_id&limit   poll signals for a peer
POST   /api/rooms/:id/signals                       send a signal (host_secret OR peer_secret+sender_peer_id)
GET    /api/rooms/cleanup                           cron-only; sweeps stale signals + expired rooms
```

## Quick start

Create a room:

```bash
curl -X POST https://your-host/api/rooms \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"game_id":"my-game","display_name":"Test","max_peers":4,"visibility":"private"}'
# → { room_id, join_code, host_secret, host_peer_id, host_peer_secret, expires_at }
```

Join the room as a peer:

```bash
curl -X POST https://your-host/api/rooms/$ROOM_ID/peers \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"kind":"phone","display_name":"Alice","metadata":{"controller_layout":"default"}}'
# → { peer_id, peer_secret, slot, kind, display_name }
```

Send a signal from the host to a peer:

```bash
curl -X POST https://your-host/api/rooms/$ROOM_ID/signals \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"host_secret":"...","recipient_peer_id":"<peer_id>","signal_type":"offer","payload":{"type":"offer","sdp":"..."}}'
```

Poll for signals as a peer:

```bash
curl "https://your-host/api/rooms/$ROOM_ID/signals?recipient_peer_id=$PEER_ID&since_id=0" \
  -H "X-API-Key: $KEY"
# → { signals: [{ signal_id, sender_peer_id, signal_type, payload, created_at }], next_since_id }
```

## Lifecycle + cleanup

- Rooms expire 2 hours after creation by default. Cleanup runs every 5 minutes and marks expired rooms `ended`, then deletes them after a further 10 minutes.
- `room_signals` rows expire 60 seconds after creation — the cleanup cron sweeps them.
- ON DELETE CASCADE: deleting a room removes its peers and signals automatically.

## Error codes

| Status | Meaning |
|---|---|
| 401 | Missing or invalid API key |
| 403 | Wrong host_secret / peer_secret / room password |
| 404 | Room or peer not found |
| 409 | Room is full |
| 410 | Room has ended |
| 423 | Room is not accepting new peers (host set `joinable: false`) |

## Auth modes for signal POST

You're either the host or a peer. Either set of credentials is sufficient:

- Host: `{ host_secret, recipient_peer_id, signal_type, payload }` — sender is recorded as `"host"`.
- Peer: `{ peer_secret, sender_peer_id, recipient_peer_id, signal_type, payload }` — sender is recorded as the peer's id.

## See also

- TypeScript SDK: `bouncy-blobs/web/src/lib/party` (`RoomService`, `PeerManager`) — reference client implementation.
- SQL: `supabase/migrations/20260514000000_rooms.sql` — schema + `room_join` RPC.
