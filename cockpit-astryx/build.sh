#!/bin/sh
# Bundle the Astryx cockpit: react19 + @astryxdesign/core (ESM) + src/main.jsx
# -> app.js + app.css. Unlike the buildless root SPA, this greenfield surface
# uses npm deps (the astryx-eval verdict: adopt Astryx wholesale on standalone
# surfaces only).
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npx --yes esbuild src/main.jsx --bundle --jsx=automatic --minify \
  --outfile=app.js --log-level=warning
VER="$(date +%s)"
sed -i.bak -E "s/app\.(js|css)\?v=[0-9]+/app.\1?v=${VER}/g" index.html && rm -f index.html.bak
echo "built cockpit-astryx (app.js?v=${VER})"
