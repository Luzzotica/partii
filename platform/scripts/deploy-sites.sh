#!/usr/bin/env bash
# Build the partii web apps and deploy them to Vercel (static sites; the API
# stays on Cloudflare). Each app builds here (the controller bundles the
# wasm engine from sdk/engine-web), then its dist/ is deployed as a Vercel
# project with a single-page-app rewrite.
#
#   scripts/deploy-sites.sh                 # store + controller, staging projects
#   scripts/deploy-sites.sh controller      # one app
#
# Projects: partii-store-<env>, partii-controller-<env> (ENV=staging default).
# The store bakes VITE_PARTII_API / VITE_PARTII_KEY (staging: from
# ~/.config/partii/staging.env). Needs `vercel login` once.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${ENV:-staging}"
APPS=("${@:-store controller}")
[ "${#APPS[@]}" -eq 1 ] && read -r -a APPS <<< "${APPS[0]}"
if [ "$ENV" = staging ] && [ -f "$HOME/.config/partii/staging.env" ]; then
  set -a; . "$HOME/.config/partii/staging.env"; set +a
  export VITE_PARTII_API="${VITE_PARTII_API:-$STAGING_EDGE}"
  export VITE_PARTII_KEY="${VITE_PARTII_KEY:-${STAGING_STORE_KEY:-}}"
fi
for app in "${APPS[@]}"; do
  dir="$ROOT/apps/$app"
  echo "== $app"
  (cd "$dir" && npm run -s build)
  printf '{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }\n' > "$dir/dist/vercel.json"
  (cd "$dir/dist" && vercel link --yes --project "partii-$app-$ENV" >/dev/null && vercel deploy --prod --yes 2>&1 | tail -1)
done
