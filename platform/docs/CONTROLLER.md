# Phone controllers

A phone joins a game's room as a member of kind `phone`, from a page opened by scanning a QR code or typing the room code. The game treats each phone as one more gamepad. Nothing about this is specific to one game.

## Joining

The game shows a QR code for:

```
<controller page>/c/<ROOM CODE>?k=<publishable key>&e=<edge url>
```

The page connects with the engine (wasm) and joins with `kind: "phone"` and `meta: {"name": "..."}`. Signing in on the page adds a player token, so the game can use that player's name and look.

## Phone to game

**Input frames** go about 30 times a second, unreliable, 10 bytes:

| Bytes | Field |
|---|---|
| 0 | `0x50` ("P") |
| 1–2 | sequence, u16 LE (stale frames are dropped) |
| 3 | left stick x, i8 (−127..127) |
| 4 | left stick y, i8 (+ is down) |
| 5 | right stick x, i8 |
| 6 | right stick y, i8 |
| 7–8 | buttons, u16 LE |
| 9 | reserved (0) |

Buttons:

| Bit | Button |
|---|---|
| 0 | primary (fire) |
| 1 | secondary |
| 2 | start (join, respawn) |
| 3 | leave |
| 4 | confirm |
| 5 | back |

**Hello** goes once, reliable, as JSON: `{"t": "hello", "name": "Sam", "player": "<player id or null>", "profile": {…} | null}`.

A phone can sign in (email code; `/signin` on the controller page). A signed-in phone sends its player id and the player's `profile` save for the room's game: whatever JSON the game keeps in the `profile` slot (tankii: `{name, color, skin_id, hat_id, tread_id}`). Write that slot from the game (`acct.write_save("profile", …)`) and apply it to the phone's seat when the hello arrives. The phone's login token never leaves the phone.

## Game to phone

All of these are reliable JSON:

- `{"t": "seat", "label": "P2", "color": "#3B82F6"}`: which seat the phone has (the phone tints itself).
- `{"t": "layout", "buttons": ["FIRE", "MINE"]}`: labels for the buttons.
- `{"t": "rumble", "ms": 120}`: vibrate if the phone can.

A phone that stops sending for 3 s counts as a pad that went idle. When its member leaves the room, the pad disconnects.
