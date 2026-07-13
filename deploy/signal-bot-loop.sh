#!/usr/bin/env bash
# Drives the reclaim signal bot against the DOCKERIZED backend.
#
# The bot's brain lives in the backend container (POST /api/reclaim-bot/poll
# runs one pass against the volume DB, where the UI-saved Telegram creds and
# the playbooks live) — do NOT run `python -m vantage_server.signal_bot` on
# the host beside a docker deploy: the host process would read a different
# data dir and see neither. This loop just pokes the endpoint once a minute
# during market hours (the poll itself is also harmless off-hours).
#
#   nohup deploy/signal-bot-loop.sh >> logs/signal-bot-loop.log 2>&1 &
#
# Stop:  pkill -f signal-bot-loop.sh
set -u
BACKEND="${VANTAGE_BACKEND:-http://localhost:8641}"
INTERVAL="${INTERVAL:-60}"

in_market_hours() {
  local dow hm
  dow=$(TZ=America/New_York date +%u)   # 1=Mon .. 7=Sun
  hm=$(TZ=America/New_York date +%H%M)
  [ "$dow" -le 5 ] && [ "$hm" -ge 0925 ] && [ "$hm" -le 1610 ]
}

echo "[$(date '+%F %T')] signal-bot loop: ${BACKEND} every ${INTERVAL}s (market hours only)"
while true; do
  if in_market_hours; then
    out=$(curl -s -X POST --max-time 110 "${BACKEND}/api/reclaim-bot/poll" || echo '{"error":"unreachable"}')
    events=$(printf '%s' "$out" | python3 -c "import json,sys
try: v=json.load(sys.stdin); print(len(v.get('events',[])) if v.get('available') else v.get('note') or v.get('error') or 'error')
except Exception: print('bad response')" 2>/dev/null)
    [ "$events" != "0" ] && echo "[$(date '+%F %T')] poll: ${events} event(s)"
  fi
  sleep "$INTERVAL"
done
