#!/bin/sh
# Install (or reinstall) partii watch as a LaunchAgent: starts at login,
# restarts if it stops. Logs: ~/Library/Logs/partii-watch.log.
# Needs ~/.config/partii/watch.env (see watch.mjs). Remove: install.sh --remove
set -eu
LABEL=me.sterlinglong.partii-watch
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then rm -f "$PLIST"; echo "removed"; exit 0; fi
[ -f "$HOME/.config/partii/watch.env" ] || { echo "missing ~/.config/partii/watch.env" >&2; exit 1; }
NODE=$(command -v node)
K2DIR=$(dirname "$(command -v k2)")
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/watch.mjs</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$K2DIR:$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>WATCH_K2_WORKSPACE</key><string>$REPO</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/partii-watch.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/partii-watch.log</string>
</dict></plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (logs: ~/Library/Logs/partii-watch.log)"
