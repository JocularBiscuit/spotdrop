#!/bin/zsh
# Stop the background Spotdrop and remove it from login items. Your data in data/ is untouched.
LABEL="com.spotdrop.app"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Spotdrop background service removed (your data in data/ is kept)."
