#!/bin/zsh
# Double-click in Finder to start Spotdrop and open it in your browser.
cd "${0:A:h}"
[ -d node_modules ] || npm install
npm run build >/dev/null && (sleep 2; open "http://localhost:5280") &
exec npm start
