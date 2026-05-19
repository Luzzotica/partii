# arcade-turn — coturn on Fly.io

[coturn](https://github.com/coturn/coturn) TURN/STUN server with HMAC
time-limited credentials and per-API-key bandwidth attribution. Plain
`turn:` over 3478/udp + 3478/tcp; no TURNS.

## Architecture

```
Browser  ─── stun/turn ──▶  arcade-turn (Fly)
                                │
                                ├─ coturn validates HMAC, allocates relay
                                │
                                └─ usage-reporter.mjs parses coturn stdout
                                       │
                                       ▼  POST /api/turn/usage (bearer)
                                Vercel/Next.js  ──▶  Supabase turn_usage
```

Two-layer auth:

- **Next.js gates API keys.** No valid key → no TURN cred. Revoke a key →
  future credentials stop being minted.
- **coturn validates HMAC.** It doesn't know what an API key is; the
  embedded `k=<apiKeyId>` is purely for billing attribution.

Usage attribution is trustworthy because the TURN username (which contains
the API key id) is HMAC-signed by Vercel — only Vercel can mint a username
coturn will accept.

## One-time setup

```bash
cd hexii/deploy/fly/turn

fly apps create arcade-turn
fly ips allocate-v4 -a arcade-turn          # dedicated IPv4 (required for UDP)
fly ips allocate-v6 -a arcade-turn

# Shared TURN secret. Same value goes on Vercel as TURN_SHARED_SECRET.
TURN_SECRET="$(openssl rand -hex 32)"
fly secrets set TURN_SHARED_SECRET="$TURN_SECRET" -a arcade-turn
echo "Vercel TURN_SHARED_SECRET = $TURN_SECRET"

# Vercel→Fly usage-reporter bearer token. Same value goes on Vercel as
# TURN_USAGE_TOKEN.
USAGE_TOKEN="$(openssl rand -hex 32)"
fly secrets set USAGE_API_TOKEN="$USAGE_TOKEN" -a arcade-turn
echo "Vercel TURN_USAGE_TOKEN = $USAGE_TOKEN"

# Where to POST usage events.
fly secrets set USAGE_API_URL="https://hexii.vercel.app" -a arcade-turn
```

### Optional: custom hostname

```bash
fly ips list -a arcade-turn         # note v4 + v6
# DNS:  A turn.sterlinglong.me → <v4>,  AAAA → <v6>
fly certs add turn.sterlinglong.me -a arcade-turn     # registers hostname for routing
fly secrets set TURN_REALM="turn.sterlinglong.me" -a arcade-turn
# Then on Vercel: TURN_HOST=turn.sterlinglong.me
```

## Apply the Supabase migration

```bash
supabase db push                # or whatever your normal apply flow is
```

This creates `public.turn_usage` (per-session rows) and the
`public.turn_usage_daily` rollup view.

## Deploy

```bash
fly deploy -a arcade-turn -c fly.toml
```

## Verify the relay works

[Trickle ICE test](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/),
hand-mint a cred locally:

```bash
SECRET=...                                          # your TURN_SHARED_SECRET
USERNAME="$(($(date +%s) + 600)):k=test:p=manual"
CREDENTIAL=$(echo -n "$USERNAME" | openssl dgst -sha1 -hmac "$SECRET" -binary | base64)
echo "URL: turn:arcade-turn.fly.dev:3478"
echo "Username: $USERNAME"
echo "Credential: $CREDENTIAL"
```

Paste into the page and click **Gather candidates** — expect both `srflx`
and `relay` candidates.

## Verify usage reporting

Run the Trickle ICE test, close the page (which ends the session), then:

```sql
-- in Supabase SQL editor
select * from turn_usage order by ended_at desc limit 10;
```

You should see a row whose `peer_tag = 'manual'` and bytes are nonzero.

Watch the reporter in real time:

```bash
fly logs -a arcade-turn | grep reporter
# [reporter] flushed (tick): 3 events, inserted=3
```

## Billing query example

```sql
-- Bytes per API key, last 30 days
select
  k.key_prefix,
  k.name,
  sum(u.bytes_sent + u.bytes_received) as bytes_total,
  count(*) as sessions
from turn_usage u
join api_keys k on k.id = u.api_key_id
where u.ended_at > now() - interval '30 days'
group by k.id, k.key_prefix, k.name
order by bytes_total desc;
```

The `turn_usage_daily` view does the same with day-level granularity for
dashboards.

## Revoking access

1. Revoke the API key in Next.js (`api_keys.revoked_at`).
2. `requireApiKey` immediately stops issuing new TURN creds for that key.
3. Existing creds expire on TTL (~10 min). Existing TURN allocations keep
   relaying until the client closes the peer connection. If you need to
   force-disconnect live sessions, restart the Fly app:
   `fly machine restart -a arcade-turn` (drops all allocations and the
   reporter flushes their final usage on exit).

## Logs

```bash
fly logs -a arcade-turn
```

The wrapper mirrors coturn's stdout verbatim, so raw coturn diagnostics
are still right there. Reporter messages are prefixed `[reporter]`.
