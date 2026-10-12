# partii API reference

Generated from `api/openapi.yaml` by `api/gen.mjs`. The one source of truth for partii's HTTP API. `api/gen.mjs` generates the

edge's route table, the Rust client the CLI uses, the TypeScript client
the web apps use, and docs/API.md. Every response is JSON:
`{"ok":true,...}` or `{"ok":false,"error":{"code","message","hint"}}`.

Auth (`x-auth`):
- `public`: nothing.
- `key`: a publishable key in `X-Partii-Key` (games and web pages).
- `player`: `X-Partii-Key` plus `Authorization: Bearer <player token>`.
- `developer`: `Authorization: Bearer <developer token>` (`PARTII_TOKEN`).
- `admin`: `Authorization: Bearer <admin token>` (platform operators).
- `stripe`: a Stripe-signed webhook.

`x-cli` is the `partii` command that calls the operation.


| Operation | Method and path | Auth | CLI |
|---|---|---|---|
| `health` | `GET /health` | public | `partii status` |
| `adminCreateDeveloper` | `POST /v1/admin/developers` | admin | `partii admin developers create` |
| `adminUsage` | `GET /v1/admin/usage` | admin | `partii admin usage` |
| `me` | `GET /v1/me` | developer | `partii whoami` |
| `tokensList` | `GET /v1/tokens` | developer | `partii tokens list` |
| `tokensCreate` | `POST /v1/tokens` | developer | `partii tokens create` |
| `tokensRevoke` | `DELETE /v1/tokens/{token_id}` | developer | `partii tokens revoke` |
| `projectsList` | `GET /v1/projects` | developer | `partii projects list` |
| `projectsPut` | `PUT /v1/projects/{project}` | developer | `partii projects put` |
| `projectsGet` | `GET /v1/projects/{project}` | developer | `partii projects get` |
| `keysList` | `GET /v1/projects/{project}/keys` | developer | `partii keys list` |
| `keysCreate` | `POST /v1/projects/{project}/keys` | developer | `partii keys create` |
| `keysRevoke` | `DELETE /v1/projects/{project}/keys/{key_id}` | developer | `partii keys revoke` |
| `timingsList` | `GET /v1/projects/{project}/timings` | developer | `partii timings` |
| `gamesList` | `GET /v1/games` | developer | `partii games list` |
| `gamesPut` | `PUT /v1/games/{game}` | developer | `partii games put` |
| `gamesGet` | `GET /v1/games/{game}` | developer | `partii games get` |
| `gamesPublish` | `POST /v1/games/{game}/publish` | developer | `partii games publish` |
| `gamesUnpublish` | `POST /v1/games/{game}/unpublish` | developer | `partii games unpublish` |
| `gamesPrice` | `PUT /v1/games/{game}/price` | developer | `partii games price` |
| `gamesSale` | `PUT /v1/games/{game}/sale` | developer | `partii games sale` |
| `gamesSaleEnd` | `DELETE /v1/games/{game}/sale` | developer | `partii games sale-end` |
| `buildsList` | `GET /v1/games/{game}/builds` | developer | `partii builds list` |
| `buildsUpload` | `POST /v1/games/{game}/builds` | developer | `partii builds upload` |
| `buildsUploadStart` | `POST /v1/games/{game}/builds/uploads` | developer | `partii builds upload-start` |
| `buildsUploadFinish` | `POST /v1/games/{game}/builds/uploads/{upload}` | developer | `partii builds upload-finish` |
| `codesList` | `GET /v1/games/{game}/codes` | developer | `partii codes list` |
| `codesCreate` | `POST /v1/games/{game}/codes` | developer | `partii codes create` |
| `entitlementsList` | `GET /v1/games/{game}/entitlements` | developer | `partii entitlements list` |
| `entitlementsGrant` | `POST /v1/games/{game}/entitlements` | developer | `partii entitlements grant` |
| `entitlementsRevoke` | `DELETE /v1/games/{game}/entitlements/{player}` | developer | `partii entitlements revoke` |
| `salesList` | `GET /v1/games/{game}/sales` | developer | `partii sales` |
| `contentPush` | `POST /v1/games/{game}/content` | developer | `partii content push` |
| `testPlayersCreate` | `POST /v1/test/players` | developer | `partii test players create` |
| `testPurchase` | `POST /v1/test/purchases` | developer | `partii test purchase` |
| `playersGuest` | `POST /v1/players/guest` | key | `partii player guest` |
| `playersEmailStart` | `POST /v1/players/email/start` | key | `partii player email-start` |
| `playersLogin` | `POST /v1/players/login` | key | `partii player login` |
| `playersMe` | `GET /v1/players/me` | player | `partii player me` |
| `playersUpdate` | `PATCH /v1/players/me` | player | `partii player rename` |
| `playersDelete` | `DELETE /v1/players/me` | player | `partii player delete` |
| `playersEntitlements` | `GET /v1/players/me/entitlements` | player | `partii player entitlements` |
| `playersRedeem` | `POST /v1/players/me/redeem` | player | `partii player redeem` |
| `playersReceipt` | `POST /v1/players/me/receipts` | player | `partii player receipt` |
| `savesList` | `GET /v1/saves/{game}` | player | `partii saves list` |
| `savesGet` | `GET /v1/saves/{game}/{slot}` | player | `partii saves get` |
| `savesPut` | `PUT /v1/saves/{game}/{slot}` | player | `partii saves put` |
| `savesHistory` | `GET /v1/saves/{game}/{slot}/history` | player | `partii saves history` |
| `savesRestore` | `POST /v1/saves/{game}/{slot}/restore` | player | `partii saves restore` |
| `contentManifest` | `GET /v1/content/{game}/manifest` | key | `partii content manifest` |
| `contentFile` | `GET /v1/content/{game}/files/{sha}` | key | `partii content file` |
| `storeGames` | `GET /v1/store/games` | public | `partii store list` |
| `storeGame` | `GET /v1/store/games/{game}` | public | `partii store get` |
| `storeCheckout` | `POST /v1/store/games/{game}/checkout` | player | `partii store checkout` |
| `storeDownload` | `GET /v1/store/games/{game}/download/{platform}` | player | `partii store download` |
| `storeLibrary` | `GET /v1/store/library` | player | `partii store library` |
| `webhookStripe` | `POST /v1/webhooks/stripe` | stripe | – |

## Operations

### health

`GET /health` (auth: public) · `partii status`

Is the edge up?

### adminCreateDeveloper

`POST /v1/admin/developers` (auth: admin) · `partii admin developers create`

Create a developer and their first token (platform operators).

Body fields: `email` (required), `name`

### adminUsage

`GET /v1/admin/usage` (auth: admin) · `partii admin usage`

Live sessions and rooms, peaks, rate-limit hits and recent alerts, per project (platform operators).

Parameters:
- `project` (query)

### me

`GET /v1/me` (auth: developer) · `partii whoami`

The developer this token belongs to.

### tokensList

`GET /v1/tokens` (auth: developer) · `partii tokens list`

Your developer tokens (without secrets).

### tokensCreate

`POST /v1/tokens` (auth: developer) · `partii tokens create`

Make another developer token (shown once).

Body fields: `name`

### tokensRevoke

`DELETE /v1/tokens/{token_id}` (auth: developer) · `partii tokens revoke`

Revoke a developer token.

Parameters:
- `token_id` (path, required)

### projectsList

`GET /v1/projects` (auth: developer) · `partii projects list`

Your projects.

### projectsPut

`PUT /v1/projects/{project}` (auth: developer) · `partii projects put`

Create or update a project (idempotent on its id).

Parameters:
- `project` (path, required)

Body fields: `name`

### projectsGet

`GET /v1/projects/{project}` (auth: developer) · `partii projects get`

One project.

Parameters:
- `project` (path, required)

### keysList

`GET /v1/projects/{project}/keys` (auth: developer) · `partii keys list`

A project's publishable keys.

Parameters:
- `project` (path, required)

### keysCreate

`POST /v1/projects/{project}/keys` (auth: developer) · `partii keys create`

Make a publishable key (idempotent on key_id).

Parameters:
- `project` (path, required)

Body fields: `key_id`, `name`

### keysRevoke

`DELETE /v1/projects/{project}/keys/{key_id}` (auth: developer) · `partii keys revoke`

Revoke a publishable key (clients using it are refused within a minute).

Parameters:
- `project` (path, required)
- `key_id` (path, required)

### timingsList

`GET /v1/projects/{project}/timings` (auth: developer) · `partii timings`

Recent connection timings clients reported (create, join, connect, path).

Parameters:
- `project` (path, required)
- `limit` (query)

### gamesList

`GET /v1/games` (auth: developer) · `partii games list`

Your games.

### gamesPut

`PUT /v1/games/{game}` (auth: developer) · `partii games put`

Create or update a game's store page and settings (idempotent).

Parameters:
- `game` (path, required)

Body fields: `id`, `project`, `title`, `tagline`, `description`, `price_cents`, `currency`, `sale`, `demo`, `platforms`, `store`, `status`, `updated_at`

### gamesGet

`GET /v1/games/{game}` (auth: developer) · `partii games get`

One of your games (drafts too).

Parameters:
- `game` (path, required)

### gamesPublish

`POST /v1/games/{game}/publish` (auth: developer) · `partii games publish`

Put the game on the store.

Parameters:
- `game` (path, required)

### gamesUnpublish

`POST /v1/games/{game}/unpublish` (auth: developer) · `partii games unpublish`

Take the game off the store (owners keep it).

Parameters:
- `game` (path, required)

### gamesPrice

`PUT /v1/games/{game}/price` (auth: developer) · `partii games price`

Set the price.

Parameters:
- `game` (path, required)

Body fields: `price_cents` (required), `currency`

### gamesSale

`PUT /v1/games/{game}/sale` (auth: developer) · `partii games sale`

Start a sale (percent off between two times).

Parameters:
- `game` (path, required)

Body fields: `percent` (required), `starts_at`, `ends_at`

### gamesSaleEnd

`DELETE /v1/games/{game}/sale` (auth: developer) · `partii games sale-end`

End the sale.

Parameters:
- `game` (path, required)

### buildsList

`GET /v1/games/{game}/builds` (auth: developer) · `partii builds list`

A game's uploaded builds.

Parameters:
- `game` (path, required)

### buildsUpload

`POST /v1/games/{game}/builds` (auth: developer) · `partii builds upload`

Upload a build (the request body is the file).

Parameters:
- `game` (path, required)
- `platform` (query, required)
- `version` (query, required)
- `channel` (query)
- `filename` (query)

Body: the file's bytes.

### buildsUploadStart

`POST /v1/games/{game}/builds/uploads` (auth: developer) · `partii builds upload-start`

Start a direct upload; returns a signed URL to PUT the file to storage (no size cap). `partii builds upload` uses this when the platform has R2.

Parameters:
- `game` (path, required)

Body fields: `platform` (required), `version` (required), `channel`, `filename`, `size` (required), `sha256` (required)

### buildsUploadFinish

`POST /v1/games/{game}/builds/uploads/{upload}` (auth: developer) · `partii builds upload-finish`

Record a build after its direct upload (checks the stored size).

Parameters:
- `game` (path, required)
- `upload` (path, required)

Body fields: `platform` (required), `version` (required), `channel`, `filename`, `size` (required), `sha256` (required)

### codesList

`GET /v1/games/{game}/codes` (auth: developer) · `partii codes list`

The game's redeemable keys.

Parameters:
- `game` (path, required)

### codesCreate

`POST /v1/games/{game}/codes` (auth: developer) · `partii codes create`

Make redeemable keys (for press, bundles, friends).

Parameters:
- `game` (path, required)

Body fields: `count`, `note`

### entitlementsList

`GET /v1/games/{game}/entitlements` (auth: developer) · `partii entitlements list`

Who owns the game, and how.

Parameters:
- `game` (path, required)

### entitlementsGrant

`POST /v1/games/{game}/entitlements` (auth: developer) · `partii entitlements grant`

Give a player the game (support, gifts, testers).

Parameters:
- `game` (path, required)

Body fields: `player` (required), `note`

### entitlementsRevoke

`DELETE /v1/games/{game}/entitlements/{player}` (auth: developer) · `partii entitlements revoke`

Take the game back from a player (refunds).

Parameters:
- `game` (path, required)
- `player` (path, required)

### salesList

`GET /v1/games/{game}/sales` (auth: developer) · `partii sales`

Purchases of the game.

Parameters:
- `game` (path, required)

### contentPush

`POST /v1/games/{game}/content` (auth: developer) · `partii content push`

Publish a live content version (levels, data, scripts) to a channel.

Parameters:
- `game` (path, required)

Body fields: `version` (required), `channel`, `files` (required)

### testPlayersCreate

`POST /v1/test/players` (auth: developer) · `partii test players create`

Make a test player and its token (for your own games' tests).

Body fields: `name`

### testPurchase

`POST /v1/test/purchases` (auth: developer) · `partii test purchase`

Buy a game as a test player through Stripe test mode (or the fake store in dev).

Body fields: `game` (required), `player` (required)

### playersGuest

`POST /v1/players/guest` (auth: key) · `partii player guest`

Sign in as a guest (one per device; no form to fill).

Body fields: `device_id` (required), `display_name`

### playersEmailStart

`POST /v1/players/email/start` (auth: key) · `partii player email-start`

Send a sign-in code to an email address.

Body fields: `email` (required)

### playersLogin

`POST /v1/players/login` (auth: key) · `partii player login`

Sign in with a provider (email code, apple, google, discord, steam, fake in dev). With a guest token, the guest is merged in.

Body fields: `provider` (required), `email`, `code`, `id_token`, `ticket`, `subject`

### playersMe

`GET /v1/players/me` (auth: player) · `partii player me`

The signed-in player.

### playersUpdate

`PATCH /v1/players/me` (auth: player) · `partii player rename`

Change the display name.

Body fields: `display_name`

### playersDelete

`DELETE /v1/players/me` (auth: player) · `partii player delete`

Delete the account and its data (saves, identities). Purchases are kept as anonymous records.

### playersEntitlements

`GET /v1/players/me/entitlements` (auth: player) · `partii player entitlements`

What the player owns, plus a signed copy a game can trust offline for a week.

Parameters:
- `game` (query)

### playersRedeem

`POST /v1/players/me/redeem` (auth: player) · `partii player redeem`

Redeem a key.

Body fields: `code` (required)

### playersReceipt

`POST /v1/players/me/receipts` (auth: player) · `partii player receipt`

Record a purchase made in a platform store (App Store, Google Play, Steam) after verifying it.

Body fields: `store` (required), `game` (required), `transaction`, `purchase_token`, `product_id`, `steam_id`, `ticket`

### savesList

`GET /v1/saves/{game}` (auth: player) · `partii saves list`

The player's save slots for a game.

Parameters:
- `game` (path, required)

### savesGet

`GET /v1/saves/{game}/{slot}` (auth: player) · `partii saves get`

One save slot.

Parameters:
- `game` (path, required)
- `slot` (path, required)

### savesPut

`PUT /v1/saves/{game}/{slot}` (auth: player) · `partii saves put`

Write a save. Pass the rev you read; a newer save elsewhere returns 409 with both copies so the game can merge.

Parameters:
- `game` (path, required)
- `slot` (path, required)

Body fields: `base_rev`, `data` (required)

### savesHistory

`GET /v1/saves/{game}/{slot}/history` (auth: player) · `partii saves history`

Earlier revisions of a save (backups).

Parameters:
- `game` (path, required)
- `slot` (path, required)

### savesRestore

`POST /v1/saves/{game}/{slot}/restore` (auth: player) · `partii saves restore`

Make an earlier revision current again.

Parameters:
- `game` (path, required)
- `slot` (path, required)

Body fields: `rev` (required)

### contentManifest

`GET /v1/content/{game}/manifest` (auth: key) · `partii content manifest`

The current live content for a channel.

Parameters:
- `game` (path, required)
- `channel` (query)

### contentFile

`GET /v1/content/{game}/files/{sha}` (auth: key) · `partii content file`

One content file, addressed by its hash (cache forever).

Parameters:
- `game` (path, required)
- `sha` (path, required)

### storeGames

`GET /v1/store/games` (auth: public) · `partii store list`

Every published game.

### storeGame

`GET /v1/store/games/{game}` (auth: public) · `partii store get`

A published game's store page.

Parameters:
- `game` (path, required)

### storeCheckout

`POST /v1/store/games/{game}/checkout` (auth: player) · `partii store checkout`

Start a Stripe Checkout for the game; returns the URL to send the buyer to.

Parameters:
- `game` (path, required)

Body fields: `success_url`, `cancel_url`

### storeDownload

`GET /v1/store/games/{game}/download/{platform}` (auth: player) · `partii store download`

Download the current build for a platform (owners, or anyone when the game has a demo).

Parameters:
- `game` (path, required)
- `platform` (path, required)

### storeLibrary

`GET /v1/store/library` (auth: player) · `partii store library`

The player's games.

### webhookStripe

`POST /v1/webhooks/stripe` (auth: stripe)

Stripe events (checkout completed, payment succeeded, refunds).
