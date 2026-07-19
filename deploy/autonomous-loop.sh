#!/usr/bin/env bash
# Drives the AUTONOMOUS strategy lifecycle (ADR-015) against the DOCKERIZED backend.
#
# One pass = POST /api/lifecycle/tick: for every LIVE (promoted) strategy, recompute
# its orders and route them through the four gates. This ONLY acts on strategies an
# operator has promoted to live; paper/eligible/paused strategies are skipped, so
# running this before any promotion is a harmless no-op.
#
# SAFETY — this loop cannot move money on its own:
#   * A strategy must be manually PROMOTED (gate passed) to be driven at all.
#   * Even then, orders are DRY-RUN unless VANTAGE_LIVE_OK=1 AND VANTAGE_AUTONOMOUS_OK=1
#     are set in the backend env AND the kill switch file is absent. This script sends
#     live=true, but the backend's gates decide — an unarmed backend records dry-run.
#   * The kill switch (deploy/.env VANTAGE_KILL_SWITCH_FILE, default /data/AUTONOMOUS_KILL):
#         docker compose exec vantage-backend touch /data/AUTONOMOUS_KILL   # HALT NOW
#         docker compose exec vantage-backend rm   /data/AUTONOMOUS_KILL    # resume
#
#   nohup deploy/autonomous-loop.sh >> logs/autonomous-loop.log 2>&1 &
#   Stop:  pkill -f autonomous-loop.sh
set -u
BACKEND="${VANTAGE_BACKEND:-http://localhost:8641}"
INTERVAL="${INTERVAL:-60}"

in_market_hours() {
  local dow hm
  dow=$(TZ=America/New_York date +%u)   # 1=Mon .. 7=Sun
  hm=$(TZ=America/New_York date +%H%M)
  [ "$dow" -le 5 ] && [ "$hm" -ge 0925 ] && [ "$hm" -le 1610 ]
}

echo "[$(date '+%F %T')] autonomous loop: ${BACKEND} every ${INTERVAL}s (market hours only)"
while true; do
  if in_market_hours; then
    out=$(curl -s -X POST --max-time 110 -H 'Content-Type: application/json' \
          -d '{"live":true}' "${BACKEND}/api/lifecycle/tick" || echo '{"error":"unreachable"}')
    summary=$(printf '%s' "$out" | python3 -c "import json,sys
try:
    v=json.load(sys.stdin)
    if not v.get('available'): print(v.get('note') or v.get('error') or 'unavailable'); raise SystemExit
    rows=v.get('strategies',[])
    acted=[r for r in rows if r.get('submitted') or r.get('dry_run') or r.get('paused')]
    print('; '.join(f\"{r['strategy_id']}: {r.get('submitted',0)} live/{r.get('dry_run',0)} dry\" + (f\" PAUSED({r['paused']})\" if r.get('paused') else '') for r in acted) or 'no live strategies')
except SystemExit: pass
except Exception: print('bad response')" 2>/dev/null)
    [ "$summary" != "no live strategies" ] && echo "[$(date '+%F %T')] tick: ${summary}"
  fi
  sleep "$INTERVAL"
done
