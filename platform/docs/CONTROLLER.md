# Phone controllers

A phone joins a game's room as a member of kind `phone`, from a page opened by scanning a QR code or typing the room code. The game treats each phone as one more gamepad. Nothing about this is specific to one game.

## Joining

The game shows a QR code for:

```
<controller page>/c/<ROOM CODE>?k=<publishable key>&e=<edge url>&g=<game id>
```

`g` lets the page put on the game's theme before it first shows (see "Looking like the game"). Without it the page shows partii's look until it has joined, then switches.

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

## Looking like the game

A game can give the controller page its own look: colours, fonts, corner radius, button lips, a logo and a background. Upload the files, then set the theme, which names them:

```
partii theme file tankii heading.woff2 --file fonts/heading.woff2
partii theme file tankii logo.png --file art/logo.png
partii theme set tankii --body @theme.json
partii theme get tankii
```

```json
{
  "name": "Tankii",
  "colors": {
    "background": "#EFE6D4", "surface": "#E3D6BD", "border": "#8B6F47", "ink": "#3A2F1F", "muted": "#8B6F47",
    "primary": "#4F8EF7", "primary_lip": "#2F64C4", "primary_ink": "#FFFFFF",
    "secondary": "#E3D6BD", "secondary_lip": "#C9B894", "secondary_ink": "#3A2F1F",
    "stick": "#E3D6BD", "stick_ring": "#8B6F47", "knob": "#6D5536", "error": "#C8403A"
  },
  "fonts": { "heading": "heading.woff2", "body": "Trebuchet MS, sans-serif" },
  "radius": 12,
  "border": 3,
  "lip": 4,
  "caps": true,
  "letter_spacing": 0.08,
  "background_image": "paper.webp",
  "logo": "logo.png"
}
```

| Field | Meaning |
|---|---|
| `colors` | `#rgb`, `#rrggbb` or `#rrggbbaa` per role. `background`: the page. `surface`: inputs and quiet fills. `border`: outlines. `ink`, `muted`: text. `primary*`: FIRE and the join button (fill, the lip under it, its text). `secondary*`: the other buttons. `stick`, `stick_ring`, `knob`: the sticks. `error`: error text. |
| `fonts.heading`, `fonts.body` | An uploaded font file (`.woff2` best), or a font-family list (`"Trebuchet MS, sans-serif"`; only fonts the phone has). Headings cover buttons, labels and the status line. |
| `radius`, `border`, `lip` | Pixels: corner radius (0–40), outline width (0–8), and the darker lip under buttons (0–12) that they press down into. |
| `caps`, `letter_spacing` | Capital letters on buttons, labels and headings; spacing in em (0–0.4). |
| `background_image`, `logo` | Uploaded images (png, webp, jpg). The logo sits at the top left, 32 px tall. |

Every field is optional; whatever a theme leaves out stays partii's. The seat colour from `{"t":"seat"}` stays the player's own: it outlines the pad, colours the status line, and is the knob and FIRE colour unless the theme sets `knob` or `primary`.

Files: up to 1 MB each, 12 files, 4 MB in all; fonts are woff2, woff, ttf or otf, and images png, webp or jpg (no SVG). Uploading a file again under the same name replaces it. Only the game's developer can change the theme; anyone can read it. Phones cache it and refresh it on every visit, so a change shows from the next time a phone opens the page (the edge caches it for a minute). `partii theme delete <game>` goes back to partii's look.

Check a font's licence before uploading it: the file is served to every phone. Trebuchet MS, for example, may be used by name (phones that have it show it) but not uploaded.
