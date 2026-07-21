#!/usr/bin/env python3
"""auto_loop — the cockpit's automation heartbeat (cron-side, stdlib only).

Runs from intraday-refresh.sh every 5 minutes (09:30–16:45 ET window). Two jobs:

  1. AUTO-FORECAST: if the latest stored SPX forecast is older than ~14 min,
     fetch the canonical hardened prompt from the backend, stream Mira, save
     the forecast — so the cockpit's "next 15 minutes" call is always current.
  2. AUTO-ANALYZE: any trade that closed today without a desk review gets one
     (DNA → Mira trade_analyst → stored), max 2 per tick so a busy day drains
     gradually without hammering Mira.

Doctrine: the BACKEND stays Mira-free — this script (like nightly-docker.sh)
owns the LLM calls and posts results to store-only endpoints. Everything it
saves is the same shape the SPA saves, so the UI can't tell the difference.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request

API = os.environ.get("VANTAGE_API", "http://localhost:8641")
MIRA = os.environ.get("MIRA_URL", "http://localhost:8080")
LOCK = "/tmp/vantage-auto-loop.lock"
FORECAST_MAX_AGE_MIN = 14
MAX_ANALYSES_PER_TICK = 2


def get(url: str, timeout: float = 120):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def post(url: str, body: dict, timeout: float = 120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def mira_turn(prompt: str, thread: str, timeout: float = 240) -> str:
    """POST /turn and concatenate the SSE token stream into the final text."""
    req = urllib.request.Request(
        f"{MIRA}/turn", data=json.dumps({"prompt": prompt, "thread_id": thread}).encode(),
        headers={"Content-Type": "application/json"})
    final = ""
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ev = None
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: ") and ev == "token":
                try:
                    t = json.loads(line[6:]).get("text")
                    if t:
                        final += t
                except ValueError:
                    pass
    return final


def extract_json(text: str):
    """First balanced {...} block in the text, parsed — or None."""
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    return None


def et_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).astimezone(
        dt.timezone(dt.timedelta(hours=-4)))


def auto_forecast() -> str:
    latest = get(f"{API}/api/spx/forecast?symbol=SPX&limit=1")
    rows = latest.get("forecasts") or []
    if rows:
        try:
            as_of = dt.datetime.fromisoformat(rows[0]["as_of"])
            age = (dt.datetime.now(dt.timezone.utc) - as_of.astimezone(
                dt.timezone.utc)).total_seconds() / 60
            if age < FORECAST_MAX_AGE_MIN:
                return f"forecast fresh ({age:.0f}m)"
        except (KeyError, ValueError, TypeError):
            pass
    p = get(f"{API}/api/spx/forecast-prompt?symbol=SPX", timeout=180)
    if not p.get("available"):
        return f"forecast-prompt unavailable: {p.get('note')}"
    text = mira_turn(p["prompt"], f"forecast-SPX-{p['as_of']}")
    if not text.strip():
        return "mira returned empty forecast"
    post(f"{API}/api/spx/forecast", {
        "day": p["day"], "as_of": p["as_of"], "symbol": "SPX",
        "snapshot": p.get("snapshot") or {}, "forecast": extract_json(text),
        "forecast_text": text})
    return f"forecast saved @ {p['as_of']}"


def auto_analyze(day: str) -> str:
    keys = set((get(f"{API}/api/journal/analyzed-keys?day={day}") or {}).get("keys") or [])
    tone = get(f"{API}/api/coach/tone?symbol=SPX")
    closed_n = sum(1 for t in (tone.get("trades") or []) if t.get("realized") is not None)
    if closed_n <= len(keys):
        return f"analyses current ({len(keys)})"
    act = get(f"{API}/api/journal/activity?day={day}", timeout=240)
    trades = act.get("trades") or []
    done = 0
    for i, t in enumerate(trades):
        if done >= MAX_ANALYSES_PER_TICK:
            break
        if t.get("status") == "open":
            continue
        key = f"{t.get('opened_at') or i}|{t.get('label')}"
        if key in keys:
            continue
        dna_env = get(f"{API}/api/journal/trade-dna?day={day}&trade={i}"
                      f"&underlying={t.get('ticker') or 'SPX'}", timeout=300)
        if not dna_env.get("available"):
            continue
        dna = dna_env["dna"]
        sf = dna.get("standing_forecast")
        prompt = (
            "Review this options trade AND critique the operator's reasoning "
            "against the tape, the technicals, and best practice. Be a demanding "
            "desk mentor. Use ONLY the DNA below.\n"
            f"TRADE DNA: {json.dumps(dna, default=str)[:14000]}\n"
            + (f"THE STANDING ANALYST FORECAST at entry: {json.dumps(sf)} — judge "
               "whether the operator traded WITH or AGAINST it and who was right.\n"
               if sf else "")
            + 'RESPOND WITH ONLY one JSON object: {"headline": str, "sections": '
              '[{"kind":"keyvals","title":"Entry & exit","rows":[{"k":str,"v":str,'
              '"tone":"good|bad|warn"}]},{"kind":"list","title":"Plan & reasoning",'
              '"items":[{"point":str}]},{"kind":"donext","items":[{"title":str,'
              '"detail":str}]}]}. Educational only, not advice.')
        text = mira_turn(prompt, f"trade-{day}-{i}")
        if text.strip():
            post(f"{API}/api/journal/trade-analysis", {
                "day": day, "trade_key": dna_env.get("trade_key") or key,
                "underlying": t.get("ticker") or "SPX",
                "label": t.get("label"), "dna": dna, "analysis": text})
            done += 1
            keys.add(key)
    return f"analyzed {done} trade(s), {len(keys)} total"


def main() -> int:
    # single-instance lock (a slow Mira call must not stack with the next tick)
    if os.path.exists(LOCK):
        age = dt.datetime.now().timestamp() - os.path.getmtime(LOCK)
        if age < 20 * 60:
            print("auto_loop: locked, skipping")
            return 0
    open(LOCK, "w").write(str(os.getpid()))
    try:
        day = et_now().date().isoformat()
        try:
            print("auto_loop forecast:", auto_forecast())
        except Exception as e:  # noqa: BLE001
            print("auto_loop forecast FAILED:", e)
        try:
            print("auto_loop analyze:", auto_analyze(day))
        except Exception as e:  # noqa: BLE001
            print("auto_loop analyze FAILED:", e)
        return 0
    finally:
        os.remove(LOCK)


if __name__ == "__main__":
    sys.exit(main())
