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
| `ugcUploadStart` | `POST /v1/games/{game}/ugc/uploads` | player | `partii ugc upload-start` |
| `ugcBlob` | `GET /v1/games/{game}/ugc/blobs/{sha256}` | public | `partii ugc blob` |
| `ugcBlobPut` | `PUT /v1/games/{game}/ugc/blobs/{sha256}` | public | – |
| `ugcList` | `GET /v1/games/{game}/ugc` | key | `partii ugc list` |
| `ugcPublish` | `POST /v1/games/{game}/ugc` | player | `partii ugc publish` |
| `ugcByCode` | `GET /v1/games/{game}/ugc/code/{code}` | key | `partii ugc code` |
| `ugcByHash` | `GET /v1/games/{game}/ugc/hash/{sha256}` | key | `partii ugc hash` |
| `ugcReports` | `GET /v1/games/{game}/ugc/reports` | developer | `partii ugc reports` |
| `ugcGet` | `GET /v1/ugc/{id}` | key | `partii ugc get` |
| `ugcUpdate` | `PATCH /v1/ugc/{id}` | player | `partii ugc update` |
| `ugcDelete` | `DELETE /v1/ugc/{id}` | player | `partii ugc delete` |
| `ugcVersion` | `POST /v1/ugc/{id}/versions` | player | `partii ugc version` |
| `ugcVote` | `PUT /v1/ugc/{id}/vote` | player | `partii ugc vote` |
| `ugcPlay` | `POST /v1/ugc/{id}/plays` | player | `partii ugc play` |
| `ugcReport` | `POST /v1/ugc/{id}/report` | player | `partii ugc report` |
| `ugcModerate` | `POST /v1/ugc/{id}/moderate` | developer | `partii ugc moderate` |
| `adminUgcModerate` | `POST /v1/admin/ugc/{id}/moderate` | admin | `partii admin ugc moderate` |
| `adminUgcReview` | `GET /v1/admin/ugc/review` | admin | `partii admin ugc review` |
| `adminUgcReviewDecide` | `POST /v1/admin/ugc/review/{seq}` | admin | `partii admin ugc decide` |
| `adminUgcBlob` | `GET /v1/admin/ugc/blobs/{game}/{sha256}` | admin | `partii admin ugc blob` |
| `ugcMine` | `GET /v1/players/me/ugc` | player | `partii ugc mine` |
| `secretsList` | `GET /v1/games/{game}/secrets` | developer | `partii secrets list` |
| `secretsSet` | `PUT /v1/games/{game}/secrets/{name}` | developer | `partii secrets set` |
| `secretsDelete` | `DELETE /v1/games/{game}/secrets/{name}` | developer | `partii secrets delete` |
| `webDeploysList` | `GET /v1/games/{game}/web/deploys` | developer | `partii web list` |
| `webDeployStart` | `POST /v1/games/{game}/web/deploys` | developer | `partii web deploy-start` |
| `webDeployUploads` | `POST /v1/games/{game}/web/deploys/{deploy}/uploads` | developer | `partii web deploy-uploads` |
| `webDeployFinish` | `POST /v1/games/{game}/web/deploys/{deploy}/finish` | developer | `partii web deploy-finish` |
| `webActivate` | `POST /v1/games/{game}/web/deploys/{deploy}/activate` | developer | `partii web activate` |
| `webTakeDown` | `DELETE /v1/games/{game}/web` | developer | `partii web take-down` |
| `webBlobPut` | `PUT /v1/games/{game}/web/blobs/{sha256}` | public | – |
| `themeGet` | `GET /v1/games/{game}/theme` | public | `partii theme get` |
| `themeSet` | `PUT /v1/games/{game}/theme` | developer | `partii theme set` |
| `themeDelete` | `DELETE /v1/games/{game}/theme` | developer | `partii theme delete` |
| `themeFilePut` | `PUT /v1/games/{game}/theme/uploads/{name}` | developer | `partii theme file` |
| `themeFileDelete` | `DELETE /v1/games/{game}/theme/uploads/{name}` | developer | `partii theme file-delete` |
| `themeFile` | `GET /v1/games/{game}/theme/files/{sha256}` | public | – |
| `steamOpenidStart` | `POST /v1/players/steam/openid/start` | key | `partii player steam-start` |
| `steamOpenidPoll` | `POST /v1/players/steam/openid/poll` | key | `partii player steam-poll` |
| `steamOpenidReturn` | `GET /v1/players/steam/openid/return` | public | – |
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

Body fields: `provider` (required), `email`, `code`, `id_token`, `ticket`, `identity`, `app_id`, `game`, `subject`

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

### ugcUploadStart

`POST /v1/games/{game}/ugc/uploads` (auth: player) · `partii ugc upload-start`

Start uploading a file or thumbnail by its hash. Returns where to PUT the bytes, or exists=true when that hash is already stored.

Parameters:
- `game` (path, required)

Body fields: `kind`, `size` (required), `sha256` (required)

### ugcBlob

`GET /v1/games/{game}/ugc/blobs/{sha256}` (auth: public) · `partii ugc blob`

A stored file or thumbnail, by its hash (cache forever). The download_url and thumbnail_url in item views point here.

Parameters:
- `game` (path, required)
- `sha256` (path, required)

### ugcBlobPut

`PUT /v1/games/{game}/ugc/blobs/{sha256}` (auth: public)

Upload the bytes to a url from ugcUploadStart when the platform has no direct uploads (the url carries a signed ticket).

Parameters:
- `game` (path, required)
- `sha256` (path, required)
- `ticket` (query, required)

Body: the file's bytes.

### ugcList

`GET /v1/games/{game}/ugc` (auth: key) · `partii ugc list`

Browse and search public items. sort is new, top or played; tags is comma-separated (all must match); pass next_cursor as cursor for the next page.

Parameters:
- `game` (path, required)
- `kind` (query)
- `tags` (query)
- `q` (query)
- `author` (query)
- `sort` (query)
- `limit` (query)
- `cursor` (query)

### ugcPublish

`POST /v1/games/{game}/ugc` (auth: player) · `partii ugc publish`

Publish an item from uploaded files (signed-in players, not guests). refs lists the hashes a World pins.

Parameters:
- `game` (path, required)

Body fields: `kind` (required), `title` (required), `description`, `tags`, `visibility`, `sha256` (required), `client_version` (required), `thumbnail_sha256`, `refs`, `notes`

### ugcByCode

`GET /v1/games/{game}/ugc/code/{code}` (auth: key) · `partii ugc code`

The item with this share code (works for unlisted items).

Parameters:
- `game` (path, required)
- `code` (path, required)

### ugcByHash

`GET /v1/games/{game}/ugc/hash/{sha256}` (auth: key) · `partii ugc hash`

The items and versions stored under this hash (a World's pinned Levels).

Parameters:
- `game` (path, required)
- `sha256` (path, required)

### ugcReports

`GET /v1/games/{game}/ugc/reports` (auth: developer) · `partii ugc reports`

Reported items of your game, most reported first (unresolved reports only).

Parameters:
- `game` (path, required)

### ugcGet

`GET /v1/ugc/{id}` (auth: key) · `partii ugc get`

One item with all its versions. With a player token, my_vote is included.

Parameters:
- `id` (path, required)

### ugcUpdate

`PATCH /v1/ugc/{id}` (auth: player) · `partii ugc update`

Change an item's title, description, tags, visibility or thumbnail (author only).

Parameters:
- `id` (path, required)

Body fields: `title`, `description`, `tags`, `visibility`, `thumbnail_sha256`

### ugcDelete

`DELETE /v1/ugc/{id}` (auth: player) · `partii ugc delete`

Unpublish an item (author only). Its files stay downloadable by hash while Worlds pin them.

Parameters:
- `id` (path, required)

### ugcVersion

`POST /v1/ugc/{id}/versions` (auth: player) · `partii ugc version`

Publish a new version of an item (author only). Old versions stay downloadable by hash.

Parameters:
- `id` (path, required)

Body fields: `sha256` (required), `client_version` (required), `notes`, `refs`

### ugcVote

`PUT /v1/ugc/{id}/vote` (auth: player) · `partii ugc vote`

Vote an item up (1), down (-1) or clear your vote (0). One vote per player per item.

Parameters:
- `id` (path, required)

Body fields: `value` (required)

### ugcPlay

`POST /v1/ugc/{id}/plays` (auth: player) · `partii ugc play`

Count a play (fire and forget). plays counts players, so repeats by the same player don't add.

Parameters:
- `id` (path, required)

### ugcReport

`POST /v1/ugc/{id}/report` (auth: player) · `partii ugc report`

Report an item to the game's moderators.

Parameters:
- `id` (path, required)

Body fields: `reason` (required)

### ugcModerate

`POST /v1/ugc/{id}/moderate` (auth: developer) · `partii ugc moderate`

Hide an item (and its files) or bring it back, as the game's developer. Resolves its reports.

Parameters:
- `id` (path, required)

Body fields: `action` (required), `reason`

### adminUgcModerate

`POST /v1/admin/ugc/{id}/moderate` (auth: admin) · `partii admin ugc moderate`

Hide an item (and its files) or bring it back, as a platform operator (takedowns). Admin or moderator token.

Parameters:
- `id` (path, required)

Body fields: `action` (required), `reason`

### adminUgcReview

`GET /v1/admin/ugc/review` (auth: admin) · `partii admin ugc review`

The moderation queue, oldest first. Every new item, new version, edit and report is an entry; pending only unless all=1. Each has the item, file_url and thumbnail_url (they work while hidden) and open reports. Admin or moderator token.

Parameters:
- `after` (query)
- `limit` (query)
- `all` (query)

### adminUgcReviewDecide

`POST /v1/admin/ugc/review/{seq}` (auth: admin) · `partii admin ugc decide`

Decide an entry: ok (visible; undoes an automatic hide) or hide (reason required: the rule it breaks, which the author sees). Settles every open entry and report for that item. Admin or moderator token.

Parameters:
- `seq` (path, required)

Body fields: `verdict` (required), `reason`

### adminUgcBlob

`GET /v1/admin/ugc/blobs/{game}/{sha256}` (auth: admin) · `partii admin ugc blob`

A player content file or thumbnail, hidden or not (for review). Admin or moderator token.

Parameters:
- `game` (path, required)
- `sha256` (path, required)

### ugcMine

`GET /v1/players/me/ugc` (auth: player) · `partii ugc mine`

The player's own items, hidden ones included (unpublished ones are not).

Parameters:
- `game` (query)

### secretsList

`GET /v1/games/{game}/secrets` (auth: developer) · `partii secrets list`

The game's secrets and config. Secret values are never shown (only set, last 4, updated); config values are.

Parameters:
- `game` (path, required)

### secretsSet

`PUT /v1/games/{game}/secrets/{name}` (auth: developer) · `partii secrets set`

Store or replace a secret or config value (steam.web_api_key, steam.app_ids). From the CLI, --value - reads it from stdin.

Parameters:
- `game` (path, required)
- `name` (path, required)

Body fields: `value` (required)

### secretsDelete

`DELETE /v1/games/{game}/secrets/{name}` (auth: developer) · `partii secrets delete`

Delete a secret or config value.

Parameters:
- `game` (path, required)
- `name` (path, required)

### webDeploysList

`GET /v1/games/{game}/web/deploys` (auth: developer) · `partii web list`

The game's site (https://<game>.partii.games) and its deploys, newest first, with which is live and each one's preview_url.

Parameters:
- `game` (path, required)

### webDeployStart

`POST /v1/games/{game}/web/deploys` (auth: developer) · `partii web deploy-start`

Start a deploy: files is {path: {sha256, size}} for the whole folder (index.html at the top). Returns the hashes the platform doesn't have yet (missing). Options: spa (unknown paths serve the nearest index.html), isolated (cross-origin isolation for threaded wasm), note. `partii web deploy <game> <dir>` does every step.

Parameters:
- `game` (path, required)

Body fields: `files` (required), `spa`, `isolated`, `note`

### webDeployUploads

`POST /v1/games/{game}/web/deploys/{deploy}/uploads` (auth: developer) · `partii web deploy-uploads`

Where to PUT missing files (up to 100 hashes per call); each upload URL checks the bytes against the hash.

Parameters:
- `game` (path, required)
- `deploy` (path, required)

Body fields: `sha256` (required)

### webDeployFinish

`POST /v1/games/{game}/web/deploys/{deploy}/finish` (auth: developer) · `partii web deploy-finish`

Check the uploads (a batch per call; call again while done is false) and, unless activate is false, make the deploy live.

Parameters:
- `game` (path, required)
- `deploy` (path, required)

Body fields: `activate`

### webActivate

`POST /v1/games/{game}/web/deploys/{deploy}/activate` (auth: developer) · `partii web activate`

Make a finished deploy the live site (a rollback, or going live after a preview).

Parameters:
- `game` (path, required)
- `deploy` (path, required)

### webTakeDown

`DELETE /v1/games/{game}/web` (auth: developer) · `partii web take-down`

Take the game's site offline (deploys are kept; activate one to bring it back).

Parameters:
- `game` (path, required)

### webBlobPut

`PUT /v1/games/{game}/web/blobs/{sha256}` (auth: public)

Upload one file to a URL from webDeployUploads when the platform has no direct uploads (the URL carries a signed ticket).

Parameters:
- `game` (path, required)
- `sha256` (path, required)
- `ticket` (query, required)

Body: the file's bytes.

### themeGet

`GET /v1/games/{game}/theme` (auth: public) · `partii theme get`

The game's look on partii's pages (the phone controller), with file names replaced by URLs. Public; theme is null when none is set.

Parameters:
- `game` (path, required)

### themeSet

`PUT /v1/games/{game}/theme` (auth: developer) · `partii theme set`

Set the game's theme (replaces it): name, colors {role: #hex}, fonts {heading, body} (an uploaded font file or a font-family list), radius, border, lip, caps, letter_spacing, background_image, logo. Upload files first. From the CLI: --body @theme.json. See docs/CONTROLLER.md.

Parameters:
- `game` (path, required)

### themeDelete

`DELETE /v1/games/{game}/theme` (auth: developer) · `partii theme delete`

Remove the game's theme and its files (pages go back to partii's look).

Parameters:
- `game` (path, required)

### themeFilePut

`PUT /v1/games/{game}/theme/uploads/{name}` (auth: developer) · `partii theme file`

Upload or replace a theme file (woff2, woff, ttf, otf, png, webp, jpg; up to 1 MB, 12 files, 4 MB in all). The theme refers to it by name.

Parameters:
- `game` (path, required)
- `name` (path, required)

Body: the file's bytes.

### themeFileDelete

`DELETE /v1/games/{game}/theme/uploads/{name}` (auth: developer) · `partii theme file-delete`

Delete a theme file the theme no longer uses.

Parameters:
- `game` (path, required)
- `name` (path, required)

### themeFile

`GET /v1/games/{game}/theme/files/{sha256}` (auth: public)

A theme file by its hash (cache forever). The URLs in themeGet point here.

Parameters:
- `game` (path, required)
- `sha256` (path, required)

### steamOpenidStart

`POST /v1/players/steam/openid/start` (auth: key) · `partii player steam-start`

Start "Sign in through Steam" in the browser (needs no Steam key). Open url, then poll. Send the guest's player token too to merge the guest.

Body fields: `game`

### steamOpenidPoll

`POST /v1/players/steam/openid/poll` (auth: key) · `partii player steam-poll`

Poll a browser Steam sign-in. status is pending, done (with player and player_token, once), expired or used.

Body fields: `poll` (required)

### steamOpenidReturn

`GET /v1/players/steam/openid/return` (auth: public)

Where Steam sends the browser back (a page that says to return to the game).

Parameters:
- `state` (query, required)

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
