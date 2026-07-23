#!/bin/sh
# Intraday refresh — fires every 5 min via launchd; self-gates to RTH so off-hours
# ticks are cheap no-ops. Two jobs each cycle:
#   1. /api/spx/refresh for SPX/QQQ/IWM 1m bars → forecast + coach levels stay current.
#   2. /api/refresh for the broker accounts → trade history (equity + option fills)
#      syncs through the day, so the journal isn't stale until a manual refresh.
set -u
cd "$(dirname "$0")"
API="${VANTAGE_API:-http://localhost:8641}"
LOG="logs/intraday-refresh.log"
mkdir -p logs

# RTH gate: weekday (Mon-Fri) AND 09:30-16:00 America/New_York.
DOW=$(TZ=America/New_York date +%u)          # 1=Mon .. 7=Sun
HHMM=$(TZ=America/New_York date +%H%M)        # e.g. 0935
if [ "$DOW" -gt 5 ]; then exit 0; fi

# auto-loop (15-min forecast + analyze-on-close) gets a WIDER window than the
# bar refresh: it keeps draining post-close so EOD trades get their desk
# reviews. Lock-protected + backgrounded — never delays the bar jobs.
if [ "$HHMM" -ge 0930 ] && [ "$HHMM" -le 1645 ]; then
  nohup python3 "$(dirname "$0")/deploy/auto_loop.py" >> logs/auto-loop.log 2>&1 &
fi

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

# every ~15 min: re-pull the CBOE SPX chain + rebuild GEX/levels at live spot
# (0DTE book included during RTH). Stored under SPX:intraday — the overnight
# plan of record is never touched; the snapshot/forecaster prefer the fresh
# map automatically. Script fires every 5 min, so gate on the minute bucket.
MIN=$(TZ=America/New_York date +%M)
if [ $((10#$MIN % 15)) -lt 5 ]; then
  OUT=$(curl -s --max-time 90 -X POST "$API/api/spx/playbook/recompute" \
    -H 'Content-Type: application/json' -d '{"symbol":"SPX"}' || true)
  OK=$(printf '%s' "$OUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("available"))
except Exception: print("err")' 2>/dev/null || echo "err")
  echo "[$STAMP] gex/levels recompute SPX -> $OK" >> "$LOG"
fi

# sync broker-account trade history so today's fills (equity + option) reach the
# journal automatically. The broker fetch is SLOW (~45s/account: it pages every
# order), so give it a generous timeout — a truncated fetch reads as an error and
# leaves trades missing. A broker hiccup is logged, never fatal (|| true). Override
# the list via VANTAGE_SYNC_ACCTS.
# record the current 0DTE option chains (SPY/QQQ via Alpaca data API) into the
# chain_snaps archive — the self-built intraday chain history. Cheap (one call
# per underlying), never fatal.
OUT=$(curl -s --max-time 60 -X POST "$API/api/chains/snapshot" \
  -H 'Content-Type: application/json' -d '{}' || true)
ROWS=$(printf '%s' "$OUT" | grep -o '"rows":[0-9]*' | paste -sd, -)
echo "[$STAMP] chains -> ${ROWS:-err}" >> "$LOG"

for ACCT in ${VANTAGE_SYNC_ACCTS:-rh-main rh-margin}; do
  OUT=$(curl -s --max-time 120 -X POST "$API/api/refresh" \
    -H 'Content-Type: application/json' -d "{\"account\":\"$ACCT\"}" || true)
  # extract new_transactions with a plain grep (no fragile inline-python quoting)
  NEW=$(printf '%s' "$OUT" | grep -o '"new_transactions":[0-9]*' | head -1 | cut -d: -f2)
  ERRS=$(printf '%s' "$OUT" | grep -o '"errors":\[[^]]*\]' | head -1)
  echo "[$STAMP] sync $ACCT -> ${NEW:-err} new · ${ERRS:-errors=?}" >> "$LOG"
done
