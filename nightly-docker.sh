#!/usr/bin/env bash
# Vantage nightly EOD pipeline — DOCKER deployment variant.
#
# The host `nightly.sh` runs against server/data-local/. But the running Compose
# stack reads the `vantage_vantage-data` volume mounted at /data inside the
# backend container (which also has the Robinhood token mounted). So the nightly
# refresh MUST run inside that container to land in the DB the UI actually reads.
# This wrapper does exactly that, in order:
#   bars -> position analysis -> notebook journal ->
#   per-underlying GEX + 0DTE playbook (SPX, QQQ, IWM) -> futures re-import ->
#   paper settle.
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

# 4+5) Per-underlying dealer-gamma (GEX) + 0DTE playbook, for SPX, QQQ, IWM.
#    GEX is computed NATIVELY from each underlying's own yfinance option chain
#    (SPX via ^SPX with a SPY-proxy fallback; QQQ/IWM from their own chains), then
#    the playbook fuses it with that underlying's 15m chart structure. SPX runs
#    first (the default view). Per-underlying failures are non-fatal — one bad
#    chain must not abort the rest of the night. OI-based, blind to 0DTE.
#    Columns: "<canonical key>:<GEX chain symbol>".
for PAIR in "SPX:^SPX" "QQQ:QQQ" "IWM:IWM"; do
  KEY="${PAIR%%:*}"; CHAIN="${PAIR##*:}"
  run "GEX snapshot ($KEY)" vantage_server.gex --symbol "$CHAIN" || true
  run "0DTE playbook ($KEY)" vantage_server.spx_playbook --symbol "$KEY" || true
done

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

# 7) Settle open PAPER trades — check SPY bars for target/stop touches and close
#    the ones that filled. No-money simulation; writes only our store (ADR-010).
run "paper-trade settle" vantage_server.paper --data-dir /data --settle

echo "[$STAMP] nightly-docker: done"
