#!/bin/sh
# Compile src/app.jsx (+ its data import) to app.js. React/LookeyDS stay page globals.
set -e
cd "$(dirname "$0")"
npx --yes esbuild src/app.jsx --bundle --jsx=transform --outfile=app.js --log-level=warning
# Bump the app.js cache-bust version so browsers fetch the fresh bundle instead
# of a stale cached copy. Uses the build epoch as the version.
VER="$(date +%s)"
if [ -f index.html ]; then
  sed -i.bak -E "s/app\.js\?v=[0-9]+/app.js?v=${VER}/" index.html && rm -f index.html.bak
  echo "bumped index.html -> app.js?v=${VER}"
fi
echo "built app.js"
