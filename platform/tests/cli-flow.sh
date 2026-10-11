#!/usr/bin/env bash
# End-to-end developer flow through the partii CLI.
set -euo pipefail
P=${PARTII_BIN:-partii}
j() { python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('ok'), d; print(d$1)"; }
step() { echo "· $*" >&2; }
step admin creates developer; export PARTII_TOKEN=$($P admin developers create --email owner$RANDOM@example.com --name Sterling --admin-token ${PARTII_ADMIN_TOKEN:-dev-admin-token} | j "['token']")
step whoami; $P whoami | j "['developer']['name']"
PROJ=studio$RANDOM; step project $PROJ; $P projects put $PROJ --name "Tankii Studio" | j "['project']['id']"
step key; export PARTII_KEY=$($P keys create $PROJ --key-id game --name "tankii game" | j "['key']['key']")
GAME=tankii-$RANDOM; step game $GAME; $P games put $GAME --project $PROJ --title Tankii --tagline "Tiny tanks, big fights" --price-cents 499 --field 'platforms=["macos","windows","ios","android"]' --field 'demo={"free_levels":20}' | j "['game']['price_cents']"
step dry-run price; $P games price $GAME --price-cents 999 --dry-run | j "['dry_run']"
step publish; $P games publish $GAME | j "['game']['status']"
head -c 200000 /dev/urandom > /tmp/tankii-test.dmg
step upload build; $P builds upload $GAME --platform macos --version 0.9.0 --filename tankii.dmg --file /tmp/tankii-test.dmg | j "['build']['size']"
step store page; $P store get $GAME | j "['game']['price_now_cents'], d['builds'][0]['platform']"
step test player; PL=$($P test players create --name Tester); PID=$(echo "$PL" | j "['player']['id']"); export PARTII_PLAYER_TOKEN=$(echo "$PL" | j "['player_token']")
step test purchase; $P test purchase --game $GAME --player $PID | j "['entitlement']['source']"
step player owns it; $P player entitlements --game $GAME | j "['entitlements'][0]['source']"
step download; $P store download $GAME macos --out /tmp/dl.dmg | j "['bytes']"; cmp /tmp/dl.dmg /tmp/tankii-test.dmg
step sales; $P sales $GAME | j "['totals']"
step bad input is a usage error; set +e; $P games price $GAME --price-cents abc >/tmp/bad.json; code=$?; set -e; [ $code = 2 ] && grep -q '"usage"' /tmp/bad.json
echo '{"ok":true,"flow":"complete","game":"'$GAME'"}'
