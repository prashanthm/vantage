#!/usr/bin/env bash
# Point this repo's git at the checked-in hooks (so the CodeGraph auto-sync survives
# clones — .git/hooks isn't versioned). Run once: `bash .githooks/install.sh`.
set -eu
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/post-commit
echo "hooks installed: core.hooksPath -> .githooks (CodeGraph auto-sync on commit)"
