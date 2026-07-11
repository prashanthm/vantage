#!/usr/bin/env bash
# Vantage nightly EOD pipeline — the deterministic sync + analysis run.
#
# Order matters: pull fresh EOD bars (read-only broker), re-run the position
# analyzer over them so the decision journal reflects the latest close, then
# rebuild the ML trade-analysis journal (round-trips + condition/edge stats) so
# Trade Analytics + the advisor's grounded lessons refresh nightly. Everything
# writes to data-local/ (never the fixture oracle).
#
#   ./nightly.sh          run the pipeline now (bars → analyze → ML build)
#   ./nightly.sh --backfill   deep-refresh all held tickers first (one-off)
#
# The ML build needs a Vantage account id and its broker-side account number.
# Both default from the environment / the imported history journal so no secret
# is hardcoded here:
#   ML_ACCOUNT         Vantage account id            (default: rh-margin)
#   ML_BROKER_ACCOUNT  broker-side account number     (default: resolved from
#                      history.json's broker_account column for ML_ACCOUNT)
# If neither resolves, the ML build is skipped with a notice (bars + analyze
# still ran) — never a hard failure of the nightly job.
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
# Only forward $1 when it's actually set (e.g. --backfill) — an empty string
# would reach the CLI as a blank positional symbol.
"$PY" -m vantage_server.snapshot_bars --broker robinhood --from-lots ${1:+"$1"} 2>&1 \
  | grep -v 'Session termination' || true

echo "[$STAMP] nightly: position analysis"
"$PY" -m vantage_server.analyze 2>&1 | grep -v 'Session termination' || true

# Earnings-calendar refresh for held symbols (read-only broker). Conditional:
# only symbols with no cached FUTURE date are re-fetched, so quiet nights cost
# zero broker calls. Keeps vantage.earnings' forward calendar fresh.
echo "[$STAMP] nightly: earnings calendar refresh"
"$PY" -m vantage_server.ml.fetch_earnings --broker robinhood --from-lots 2>&1 \
  | grep -v 'Session termination' || true

# Per-ticker journal snapshot (price + P&L + recommendation per held underlying)
# so each notebook's timeline accrues nightly. Idempotent per day; never fails
# the pipeline.
echo "[$STAMP] nightly: notebook journal snapshot"
"$PY" -m vantage_server.snapshot_journal 2>&1 | grep -v 'Session termination' || true

# ── ML trade-analysis build (round-trips → condition/edge features) ──────────
# Read-only broker fetch for realized P/L, data-local writes to data-local/ml/.
# build_features reuses the just-built round-trips (--from-roundtrips) so it
# never issues a second broker fetch. Resolve the broker account number from the
# imported history journal when not supplied via the environment.
ML_ACCOUNT="${ML_ACCOUNT:-rh-margin}"
ML_BROKER_ACCOUNT="${ML_BROKER_ACCOUNT:-$(
  "$PY" - "$ML_ACCOUNT" <<'PYEOF' 2>/dev/null || true
import sys
from vantage_server.store import Store, resolve_data_dir
account = sys.argv[1]
try:
    rows = Store(resolve_data_dir(None)).load_history()
except Exception:
    rows = []
for r in rows:
    if r.get("account") == account and r.get("broker_account"):
        print(str(r["broker_account"]))
        break
PYEOF
)}"

if [ -z "$ML_BROKER_ACCOUNT" ]; then
  echo "[$STAMP] nightly: ML build skipped — no broker account for '$ML_ACCOUNT'" \
       "(set ML_BROKER_ACCOUNT or import history first)"
else
  echo "[$STAMP] nightly: ML round-trips build ($ML_ACCOUNT)"
  "$PY" -m vantage_server.ml.build_roundtrips \
    --broker robinhood --account "$ML_ACCOUNT" --broker-account "$ML_BROKER_ACCOUNT" 2>&1 \
    | grep -v 'Session termination' || true

  echo "[$STAMP] nightly: ML condition/edge features build ($ML_ACCOUNT)"
  "$PY" -m vantage_server.ml.build_features \
    --account "$ML_ACCOUNT" --from-roundtrips 2>&1 \
    | grep -v 'Session termination' || true
fi

echo "[$STAMP] nightly: done"
