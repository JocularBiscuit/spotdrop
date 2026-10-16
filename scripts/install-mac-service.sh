#!/bin/zsh
# Run Spotdrop in the background on this Mac: starts at login, restarts if it stops.
# Afterwards it's always at http://localhost:5280 (no terminal needed).
set -e
cd "${0:A:h}/.."
APP_DIR="$PWD"
NODE="$(command -v node)"
LABEL="com.spotdrop.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[ -n "$NODE" ] || { echo "Node.js not found. Install it first: brew install node"; exit 1; }
[ -d node_modules ] || npm install
npm run build
mkdir -p "$HOME/Library/LaunchAgents" data

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>server/index.ts</string></array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$APP_DIR/data/spotdrop.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/spotdrop.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# Unloading finishes asynchronously; retry loading for a few seconds.
for i in 1 2 3 4 5; do
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break
  sleep 1
done
sleep 2
echo ""
echo "  ✅ Spotdrop now runs in the background: http://localhost:5280"
echo "     Logs: data/spotdrop.log · Update after code changes: npm run service:restart · Remove: npm run service:uninstall"
open "http://localhost:5280"
