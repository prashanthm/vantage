#!/bin/sh
# Intraday 1m-bar refresh — fires every 5 min via launchd; self-gates to RTH so
# off-hours ticks are cheap no-ops. Curls /api/spx/refresh for the playbook
# symbols so the snapshot (and thus the forecast + coach levels) stays ~current.
set -u
cd "$(dirname "$0")"
API="${VANTAGE_API:-http://localhost:8641}"
LOG="logs/intraday-refresh.log"
mkdir -p logs

# RTH gate: weekday (Mon-Fri) AND 09:30-16:00 America/New_York.
DOW=$(TZ=America/New_York date +%u)          # 1=Mon .. 7=Sun
HHMM=$(TZ=America/New_York date +%H%M)        # e.g. 0935
if [ "$DOW" -gt 5 ]; then exit 0; fi
if [ "$HHMM" -lt 0930 ] || [ "$HHMM" -gt 1600 ]; then exit 0; fi

STAMP="$(TZ=America/New_York date +%Y-%m-%dT%H:%M)"
# roll the log if it gets big
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2097152 ]; then mv "$LOG" "$LOG.1"; fi

for SYM in SPX QQQ IWM; do
  OUT=$(curl -s --max-time 25 -X POST "$API/api/spx/refresh" \
    -H 'Content-Type: application/json' -d "{\"symbol\":\"$SYM\"}" || true)
  AS_OF=$(printf '%s' "$OUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("as_of"))
except Exception: print("err")' 2>/dev/null || echo "err")
  echo "[$STAMP] refresh $SYM -> as_of=$AS_OF" >> "$LOG"
done
