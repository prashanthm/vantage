#!/bin/sh
# Bundle the Astryx app shell: react19 + @astryxdesign/core + src/main.jsx
# -> app.js (+ app.css via the esbuild css loader). Same strangler-cell
# pattern as cockpit-astryx; served at /next/.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npx --yes esbuild src/main.jsx --bundle --jsx=automatic --minify \
  --external:/fonts/* --outfile=app.js --log-level=warning
VER="$(date +%s)"
sed -i.bak -E "s/app\.(js|css)\?v=[0-9]+/app.\1?v=${VER}/g" index.html && rm -f index.html.bak
echo "built app-astryx (app.js?v=${VER})"
