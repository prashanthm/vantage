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

# Simple size-based rotation so logs never grow unbounded (launchd appends).
for f in "$LOG_DIR"/*.log; do
  [ -f "$f" ] || continue
  if [ "$(wc -c < "$f")" -gt 5242880 ]; then mv "$f" "$f.1"; fi
done

# Run one pipeline step inside the container against the /data volume.
# Failures are tolerated (a flaky broker fetch never aborts the night) but
# RECORDED — the final line names every failed step instead of a false "done".
FAILED_STEPS=""
run() {
  local label="$1"; shift
  echo "[$STAMP] nightly-docker: $label"
  local out rc
  out=$(docker exec -e VANTAGE_DATA_DIR=/data "$CID" python -m "$@" 2>&1); rc=$?
  printf '%s\n' "$out" | grep -v 'Session termination' || true
  if [ "$rc" -ne 0 ]; then FAILED_STEPS="$FAILED_STEPS [$label]"; fi
  return 0
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

# 1b) Benchmark bars for relative-strength decomposition (SPY + sector ETFs).
run "benchmark bars (relative strength)" \
  vantage_server.snapshot_bars --source yfinance SPY XLK XLF XLC XLV XLE XLRE XLY

# 2) Position analysis -> decision journal (what the UI's AI recommendations read).
run "position analysis" vantage_server.analyze

# 2b) Earnings-calendar refresh for held underlyings (read-only broker).
#     Conditional: only underlyings with no cached FUTURE date are re-fetched,
#     so quiet nights cost zero broker calls. Feeds vantage.earnings (the
#     analyze flow's catalyst gate).
run "earnings calendar refresh" vantage_server.ml.fetch_earnings --broker robinhood --from-lots

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

# 7) Settle open PAPER trades — fill pending reclaims (3x5m closes), expire
#    the never-filled, close target/stop touches on 5m bars. Writes only our
#    store (ADR-010).
run "paper-trade settle" vantage_server.paper --data-dir /data --settle

# 8) ML trade-analysis build (round-trips -> condition/edge features), so
#    Trade Analytics + the advisor's grounded lessons refresh in the SAME
#    data dir the UI and MCP read (parity with the host nightly). The broker
#    account number resolves from the imported history inside the container.
ML_ACCOUNT="${ML_ACCOUNT:-rh-margin}"
ML_BROKER_ACCOUNT="${ML_BROKER_ACCOUNT:-$(docker exec "$CID" python -c "
from vantage_server.store import Store
rows = []
try: rows = Store('/data').load_history()
except Exception: pass
for r in rows:
    if r.get('account') == '${ML_ACCOUNT:-rh-margin}' and r.get('broker_account'):
        print(str(r['broker_account'])); break
" 2>/dev/null || true)}"
if [ -z "$ML_BROKER_ACCOUNT" ]; then
  echo "[$STAMP] nightly-docker: ML build skipped — no broker account for '$ML_ACCOUNT'"
else
  run "ML round-trips build ($ML_ACCOUNT)" vantage_server.ml.build_roundtrips \
    --broker robinhood --account "$ML_ACCOUNT" --broker-account "$ML_BROKER_ACCOUNT"
  run "ML condition/edge features build ($ML_ACCOUNT)" vantage_server.ml.build_features \
    --account "$ML_ACCOUNT" --from-roundtrips
fi

# Nightly Telegram digest (signal outcomes + playbook freshness + open book),
# sent AFTER the pipeline so a failed step rides along in the same message.
# Best-effort like every other step; unconfigured telegram → backend logs it.
if [ -n "$FAILED_STEPS" ]; then
  NOTE="⚠ pipeline failures:$FAILED_STEPS"
else
  NOTE=""
fi
DIGEST=$(curl -s -X POST --max-time 60 "http://localhost:8641/api/reclaim-bot/nightly-report" \
  -H 'Content-Type: application/json' \
  -d "$(printf '%s' "$NOTE" | python3 -c 'import json,sys; print(json.dumps({"note": sys.stdin.read()}))')" || true)
echo "[$STAMP] nightly-docker: digest sent=$(printf '%s' "$DIGEST" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("sent"))
except Exception: print("error")' 2>/dev/null)"

if [ -n "$FAILED_STEPS" ]; then
  echo "[$STAMP] nightly-docker: done WITH FAILURES:$FAILED_STEPS"
else
  echo "[$STAMP] nightly-docker: done (all steps ok)"
fi
