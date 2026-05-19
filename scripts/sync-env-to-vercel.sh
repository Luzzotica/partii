#!/usr/bin/env bash
# Push every key in a .env file up to Vercel for one or more environments.
#
# Usage:
#   scripts/sync-env-to-vercel.sh                       # default: .env → production
#   scripts/sync-env-to-vercel.sh preview               # .env → preview
#   scripts/sync-env-to-vercel.sh production .env.prod  # custom file
#   scripts/sync-env-to-vercel.sh all                   # production + preview + development
#
# Lines starting with `#` are skipped. Lines starting with `#vercel-skip:` mark
# the *next* key as local-only and skip it on the push (handy for dev-only
# secrets you don't want in production).
#
# Existing values on Vercel are overwritten — the script does `vercel env rm`
# then `vercel env add` for each key.

set -euo pipefail

TARGET="${1:-production}"
ENV_FILE="${2:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "error: vercel CLI not found. brew install vercel-cli" >&2
  exit 1
fi

case "$TARGET" in
  production|preview|development) TARGETS=("$TARGET") ;;
  all) TARGETS=(production preview development) ;;
  *)
    echo "error: target must be production|preview|development|all, got $TARGET" >&2
    exit 1
    ;;
esac

# Confirm before clobbering production.
if [[ " ${TARGETS[*]} " == *" production "* ]] && [[ "${YES:-0}" != "1" ]]; then
  read -rp "About to overwrite Vercel production env vars from $ENV_FILE. Continue? [y/N] " ans
  [[ "$ans" =~ ^[yY] ]] || { echo "aborted"; exit 1; }
fi

skip_next=0
pushed=0
skipped=0

while IFS= read -r raw || [[ -n "$raw" ]]; do
  # trim CR + leading/trailing whitespace
  line="${raw%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"

  if [[ -z "$line" ]]; then continue; fi

  if [[ "$line" == \#vercel-skip:* ]]; then
    skip_next=1; continue
  fi
  if [[ "$line" == \#* ]]; then continue; fi
  if [[ "$line" != *=* ]]; then continue; fi

  key="${line%%=*}"
  value="${line#*=}"

  # strip matching surrounding quotes
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  if [[ "$skip_next" == "1" ]]; then
    echo "↷  $key  (skipped: #vercel-skip)"
    skip_next=0
    skipped=$((skipped + 1))
    continue
  fi

  for env in "${TARGETS[@]}"; do
    # Remove silently if present (rm exits non-zero if absent).
    vercel env rm "$key" "$env" --yes >/dev/null 2>&1 || true
    # Pipe value via stdin so secrets never appear in argv / process list.
    printf '%s' "$value" | vercel env add "$key" "$env" >/dev/null
    echo "↑  $key  →  $env"
  done
  pushed=$((pushed + 1))
done < "$ENV_FILE"

echo
echo "Done. pushed=$pushed skipped=$skipped targets=${TARGETS[*]}"
echo "Tip: redeploy to pick up the new values:  vercel --prod"
