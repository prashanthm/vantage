#!/usr/bin/env bash
# Vantage nightly EOD pipeline — DOCKER deployment variant.
#
# The host `nightly.sh` runs against server/data-local/. But the running Compose
# stack reads the `vantage_vantage-data` volume mounted at /data inside the
# backend container (which also has the Robinhood token mounted). So the nightly
# refresh MUST run inside that container to land in the DB the UI actually reads.
# This wrapper does exactly that, in order:
#   bars -> position analysis -> notebook journal -> GEX (native) ->
#   0DTE SPX playbook -> futures re-import.
#
#   ./nightly-docker.sh            run the pipeline now
#   ./nightly-docker.sh --backfill deep-refresh all held tickers first (one-off)
#
# Install/uninstall the weeknight launchd schedule with:
#   ./stack cron-install-docker   (17:45 ET, after close)
#   ./stack cron-uninstall-docker
#
# It exits non-zero only if the backend container isn't running — each pipeline
# step is best-effort (a flaky broker fetch never fails the whole run).
set -uo pipefail
cd "$(dirname "$0")"

SERVICE="vantage-backend"           # compose service name
LOG_DIR=logs
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H:%M:%S)"

# Resolve the running container id for the backend service (compose v2).
CID="$(docker compose -f deploy/docker-compose.yml ps -q "$SERVICE" 2>/dev/null || true)"
if [ -z "$CID" ]; then
  echo "[$STAMP] nightly-docker: ERROR — $SERVICE container not running; start the stack first" >&2
  exit 1
fi

# Run one pipeline step inside the container against the /data volume.
run() {
  echo "[$STAMP] nightly-docker: $1"
  shift
  docker exec -e VANTAGE_DATA_DIR=/data "$CID" python -m "$@" 2>&1 \
    | grep -v 'Session termination' || true
}

# 1) EOD bars (read-only broker fetch) so the analyzer sees the latest close.
#    --from-lots covers every held underlying; forward --backfill only when set.
if [ "${1:-}" = "--backfill" ]; then
  run "EOD bar snapshot (--from-lots --backfill)" \
    vantage_server.snapshot_bars --broker robinhood --from-lots --backfill
else
  run "EOD bar snapshot (--from-lots)" \
    vantage_server.snapshot_bars --broker robinhood --from-lots
fi

# 2) Position analysis -> decision journal (what the UI's AI recommendations read).
run "position analysis" vantage_server.analyze

# 3) Per-ticker journal snapshot so each notebook timeline accrues nightly.
run "notebook journal snapshot" vantage_server.snapshot_journal

# 4) Dealer-gamma (GEX) snapshot — computed NATIVELY in Vantage from the yfinance
#    option chain (no longer depends on Sentinel writing its file first). Runs
#    BEFORE the playbook so the playbook bakes fresh GEX. OI-based, blind to 0DTE.
run "GEX snapshot (native)" vantage_server.gex

# 5) Daily 0DTE SPX playbook — fuses Vantage's own GEX (step 4) with SPX 15m chart
#    structure + Sentinel's zones/breadth/macro (mounted read-only at /sentinel).
#    Runs after GEX + bars so it reads the freshest of both.
run "0DTE SPX playbook" vantage_server.spx_playbook

# 6) Futures analysis — re-import the AMP CSV export in /data/ampfutures (if any)
#    so stored fills stay current. Idempotent (Order-ID dedupe); a no-op when the
#    export is unchanged. AMP is not API-connected, so this refreshes from whatever
#    CSVs you've dropped in — it can't pull new fills on its own.
if docker exec "$CID" sh -c 'ls /data/ampfutures/*.csv >/dev/null 2>&1'; then
  run "futures re-import (ampfutures)" \
    vantage_server.futures --data-dir /data --import ampfutures --no-alignment
else
  echo "[$STAMP] nightly-docker: futures re-import skipped — no CSVs in /data/ampfutures"
fi

echo "[$STAMP] nightly-docker: done"
