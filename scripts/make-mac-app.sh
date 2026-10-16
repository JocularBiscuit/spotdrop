#!/bin/zsh
# Builds ~/Applications/Spotdrop.app: starts the background service if it's stopped, then opens Spotdrop.
set -e
cd "${0:A:h}/.."
APP="$HOME/Applications/Spotdrop.app"
TMP="$(mktemp -d)"
mkdir -p "$HOME/Applications" "$TMP/Spotdrop.iconset"
node -e '
const sharp = require("sharp"); const fs = require("fs");
const svg = fs.readFileSync("web/public/favicon.svg");
const out = process.argv[1];
const sizes = [[16,"16x16"],[32,"16x16@2x"],[32,"32x32"],[64,"32x32@2x"],[128,"128x128"],[256,"128x128@2x"],[256,"256x256"],[512,"256x256@2x"],[512,"512x512"],[1024,"512x512@2x"]];
Promise.all(sizes.map(([s, n]) => sharp(svg, { density: 1200 }).resize(s, s).png().toFile(`${out}/icon_${n}.png`)));
' "$TMP/Spotdrop.iconset"
sleep 1
iconutil -c icns "$TMP/Spotdrop.iconset" -o "$TMP/Spotdrop.icns"
rm -rf "$APP"
osacompile -o "$APP" -e '
set uid to do shell script "id -u"
try
  do shell script "curl -s -o /dev/null --max-time 1 http://localhost:5280/api/status"
on error
  do shell script "launchctl kickstart gui/" & uid & "/com.spotdrop.app"
  repeat 20 times
    delay 0.5
    try
      do shell script "curl -s -o /dev/null --max-time 1 http://localhost:5280/api/status"
      exit repeat
    end try
  end repeat
end try
open location "http://localhost:5280"'
cp "$TMP/Spotdrop.icns" "$APP/Contents/Resources/applet.icns"
rm -f "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
touch "$APP"
rm -rf "$TMP"
echo "Created $APP"
