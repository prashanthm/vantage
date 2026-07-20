#!/usr/bin/env bash
# Reconciles scanner debit spreads against Alpaca PAPER: confirms entry fills and
# closes on the invalidation (stop-loss) or target. Like signal-bot-loop.sh, this
# just pokes a backend ENDPOINT once a minute during market hours — the reconcile
# logic (scanner_exec.tick) runs in the DOCKERIZED backend where the data dir and
# Alpaca creds live. Do NOT run `python -m vantage_server.scanner_exec` on the host
# beside a docker deploy (it would read a different data dir).
#
#   nohup deploy/scanner-exec-loop.sh >> logs/scanner-exec-loop.log 2>&1 &
#
# Stop:  pkill -f scanner-exec-loop.sh
set -u
BACKEND="${VANTAGE_BACKEND:-http://localhost:8641}"
INTERVAL="${INTERVAL:-60}"
in_market_hours() {
  local dow hm
  dow=$(TZ=America/New_York date +%u)   # 1=Mon .. 7=Sun
  hm=$(TZ=America/New_York date +%H%M)
  [ "$dow" -le 5 ] && [ "$hm" -ge 0925 ] && [ "$hm" -le 1610 ]
}
echo "[$(date '+%F %T')] scanner-exec loop: ${BACKEND} every ${INTERVAL}s (market hours only)"
while true; do
  if in_market_hours; then
    out=$(curl -s -X POST --max-time 110 "${BACKEND}/api/scanner/reconcile" || echo '{"error":"unreachable"}')
    n=$(printf '%s' "$out" | python3 -c "import json,sys
try: v=json.load(sys.stdin); print(v.get('n') if v.get('available') else v.get('note') or v.get('error') or 'error')
except Exception: print('bad response')" 2>/dev/null)
    [ "$n" != "0" ] && echo "[$(date '+%F %T')] reconcile: ${n} action(s)"
  fi
  sleep "$INTERVAL"
done
