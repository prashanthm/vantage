#!/bin/sh
# Compile src/app.jsx (+ its data import) to app.js. React/LookeyDS stay page globals.
set -e
cd "$(dirname "$0")"
npx --yes esbuild src/app.jsx --bundle --jsx=transform --outfile=app.js --log-level=warning
echo "built app.js"
