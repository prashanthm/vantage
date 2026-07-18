#!/bin/sh
# ICT Scanner hourly cron — fires once/hour via launchd; self-gates to RTH so
# off-hours ticks are cheap no-ops. Runs the scan (seeding fresh 60m bars for the
# universe) inside the backend container and Telegrams any FRESH A+ setup.
set -u
cd "$(dirname "$0")"
LOG="logs/scanner-cron.log"
mkdir -p logs

# RTH gate: weekday (Mon-Fri) AND 09:30-16:00 America/New_York.
DOW=$(TZ=America/New_York date +%u)          # 1=Mon .. 7=Sun
HHMM=$(TZ=America/New_York date +%H%M)        # e.g. 1030
if [ "$DOW" -gt 5 ]; then exit 0; fi
if [ "$HHMM" -lt 0930 ] || [ "$HHMM" -gt 1600 ]; then exit 0; fi

STAMP="$(TZ=America/New_York date +%Y-%m-%dT%H:%M)"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2097152 ]; then mv "$LOG" "$LOG.1"; fi

CONTAINER="${VANTAGE_BACKEND_CONTAINER:-vantage-vantage-backend-1}"
OUT=$(docker exec "$CONTAINER" python -m vantage_server.scanner --scanner ict_htf 2>&1 || true)
printf '%s scanner: %s\n' "$STAMP" "$OUT" >> "$LOG"
