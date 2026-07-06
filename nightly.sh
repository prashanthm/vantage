#!/usr/bin/env bash
# Vantage nightly EOD pipeline — the deterministic sync + analysis run.
#
# Order matters: pull fresh EOD bars (read-only broker), then re-run the
# position analyzer over them so the decision journal reflects the latest
# close. Everything writes to data-local/ (never the fixture oracle).
#
#   ./nightly.sh          run the pipeline now (bars → analyze)
#   ./nightly.sh --backfill   deep-refresh all held tickers first (one-off)
#
# Install/uninstall the weeknight launchd schedule with ./stack cron-install
# / cron-uninstall (17:45 ET, after market close). This script is what the
# job invokes; run it by hand any time to refresh on demand.
set -euo pipefail
cd "$(dirname "$0")"

PY=server/.venv/bin/python
LOG_DIR=logs
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H:%M:%S)"

echo "[$STAMP] nightly: EOD bar snapshot (--from-lots ${1:-})"
"$PY" -m vantage_server.snapshot_bars --broker robinhood --from-lots "${1:-}" 2>&1 \
  | grep -v 'Session termination' || true

echo "[$STAMP] nightly: position analysis"
"$PY" -m vantage_server.analyze 2>&1 | grep -v 'Session termination' || true

echo "[$STAMP] nightly: done"
