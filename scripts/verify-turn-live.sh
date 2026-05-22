#!/usr/bin/env bash
# Live smoke test for the production TURN pipeline.
#
# Probes:
#   1. arcade-turn Fly app: TCP/3478 reachable on the public IP
#   2. Vercel `/api/rooms` returns valid ice_servers
#   3. The credential coturn would compute for that username matches the
#      credential Vercel returned (HMAC math sanity, validates that Vercel's
#      TURN_SHARED_SECRET matches Fly's)
#   4. Prints a ready-to-paste Trickle ICE test snippet for browser verification
#
# Usage:
#   ARCADE_API_KEY=mpk_live_xxx scripts/verify-turn-live.sh
#   ARCADE_API_KEY=... ARCADE_BASE=https://other.example scripts/verify-turn-live.sh

set -euo pipefail

API_KEY="${ARCADE_API_KEY:-}"
BASE_URL="${ARCADE_BASE:-https://sterlinglong.me}"
TURN_HOST_DEFAULT="arcade-turn.fly.dev"

if [[ -z "$API_KEY" ]]; then
  echo "error: set ARCADE_API_KEY to one of your developer-portal API keys" >&2
  exit 1
fi
for bin in curl jq openssl nc; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: missing required tool: $bin" >&2; exit 1
  fi
done

HEX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HEX_DIR/.env"
TURN_SECRET=""
if [[ -f "$ENV_FILE" ]]; then
  TURN_SECRET=$(grep -E "^TURN_SHARED_SECRET=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/' || true)
fi

step() { printf "\n\e[36m▶ %s\e[0m\n" "$*"; }
ok()   { printf "  \e[32m✓\e[0m %s\n" "$*"; }
warn() { printf "  \e[33m⚠\e[0m %s\n" "$*"; }
fail() { printf "  \e[31m✗\e[0m %s\n" "$*"; exit 1; }

# ─── 1. Vercel returns ice_servers from /api/rooms ───────────────────────────

step "Asking Vercel to mint a room + ice_servers"

ROOM_JSON=$(curl -sSf -X POST "$BASE_URL/api/rooms" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"game_id":"_smoke-test"}')

ROOM_ID=$(echo "$ROOM_JSON" | jq -r .room_id)
HOST_PEER_ID=$(echo "$ROOM_JSON" | jq -r .host_peer_id)
HOST_SECRET=$(echo "$ROOM_JSON" | jq -r .host_secret)
ICE=$(echo "$ROOM_JSON" | jq -c .ice_servers)

[[ "$ROOM_ID" == "null" ]] && fail "no room_id in response: $ROOM_JSON"
ok "room_id      = $ROOM_ID"
ok "host_peer_id = $HOST_PEER_ID"

# Extract TURN entry (the one with a username / credential)
TURN_ENTRY=$(echo "$ICE" | jq -c '.[] | select(.username != null)')
[[ -z "$TURN_ENTRY" ]] && fail "no TURN entry in ice_servers: $ICE"

USERNAME=$(echo "$TURN_ENTRY" | jq -r .username)
CREDENTIAL=$(echo "$TURN_ENTRY" | jq -r .credential)
TURN_URLS=$(echo "$TURN_ENTRY" | jq -r '.urls | if type == "array" then join(",") else . end')

ok "TURN urls    = $TURN_URLS"
ok "username     = $USERNAME"

# Sanity-check username shape: <expiry>:k=<apiKeyId>:p=<peerId>
if [[ ! "$USERNAME" =~ ^[0-9]+:k=[A-Za-z0-9_.-]+:p=[A-Za-z0-9_.-]+$ ]]; then
  fail "username doesn't match expected shape '<expiry>:k=<id>:p=<peer>'"
fi
ok "username has the expected <expiry>:k=<id>:p=<peer> shape"

# Verify expiry is in the future
EXP=$(echo "$USERNAME" | cut -d: -f1)
NOW=$(date +%s)
if (( EXP <= NOW )); then
  fail "credential already expired (expiry=$EXP, now=$NOW)"
fi
ok "expiry in $((EXP - NOW))s — credential is fresh"

# ─── 2. Fly TURN endpoint reachable ──────────────────────────────────────────

TURN_HOST=$(echo "$TURN_URLS" | tr ',' '\n' | grep -E '^turn:' | head -1 | sed -E 's|turn:([^:]+):.*|\1|')
[[ -z "$TURN_HOST" ]] && TURN_HOST="$TURN_HOST_DEFAULT"

step "Probing TURN reachability at $TURN_HOST:3478"

if nc -zv -w 5 "$TURN_HOST" 3478 >/dev/null 2>&1; then
  ok "TCP/3478 accepted a connection"
else
  fail "TCP/3478 did NOT accept a connection — Fly app down?"
fi

# ─── 3. HMAC roundtrip (Vercel ↔ Fly share the same secret) ──────────────────

if [[ -n "$TURN_SECRET" ]]; then
  step "Verifying Vercel's HMAC matches the local TURN_SHARED_SECRET"
  EXPECTED=$(printf '%s' "$USERNAME" \
    | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary \
    | base64)
  if [[ "$EXPECTED" == "$CREDENTIAL" ]]; then
    ok "Local HMAC reproduces Vercel's credential — both share TURN_SHARED_SECRET"
  else
    warn "Local HMAC does NOT match Vercel — your .env's TURN_SHARED_SECRET differs from prod"
    echo "    local = $EXPECTED"
    echo "    prod  = $CREDENTIAL"
  fi
else
  warn "skipping HMAC roundtrip — TURN_SHARED_SECRET not in $ENV_FILE"
fi

# ─── 4. Clean up the smoke-test room ─────────────────────────────────────────

step "Ending the smoke-test room ($ROOM_ID)"
curl -sSf -X PATCH "$BASE_URL/api/rooms/$ROOM_ID" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"host_secret\":\"$HOST_SECRET\",\"status\":\"ended\"}" >/dev/null || \
  warn "couldn't end room — it'll auto-expire in 2h"
ok "smoke-test room marked ended"

# ─── 5. Hand to Trickle ICE for the actual relay test ────────────────────────

cat <<EOF

────────────────────────────────────────────────────────────────────────
  Final step (manual) — verify actual relay candidates appear:

  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

  STUN/TURN URI:  turn:$TURN_HOST:3478?transport=udp
  Username:       $USERNAME
  Password:       $CREDENTIAL

  Paste those in, click "Add Server", then "Gather candidates".
  You should see lines with Component = "1" and Type = "relay".

  After closing that page, this row should appear in Supabase:

    select * from turn_usage
     where peer_tag = '${HOST_PEER_ID}'
     order by ended_at desc limit 1;
────────────────────────────────────────────────────────────────────────
EOF
