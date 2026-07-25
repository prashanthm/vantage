"""mira-inputs goal — the frozen measurement instrument.

Replays one day of 15-minute forecasts headlessly: plan a replay run, then for
each step fetch the as-of snapshot, build the forecast prompt (verbatim port
of src/live.js buildForecastPrompt), stream Mira /turn, persist the forecast
under the run_id, and finally code-score the whole run. Prints the run's
hit-rate. The ONLY thing experiments may vary is the prompt/input content —
days, cadence, and scorer stay fixed.

Usage:
  python research/mira_replay.py --day 2026-07-21 [--symbol SPX]
      [--extra-file blocks/econ.txt]   # experiment: extra input block
      [--tag H-cal]                    # label stored in the run note
      [--step-min 15]

Env: VANTAGE_API (default http://localhost:8641), MIRA_URL (default
http://localhost:8080).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API = os.environ.get("VANTAGE_API", "http://localhost:8641").rstrip("/")
MIRA = os.environ.get("MIRA_URL", "http://localhost:8080").rstrip("/")


def get(url, timeout=60):
    return json.loads(urllib.request.urlopen(url, timeout=timeout).read())


def post(url, body, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def build_prompt(symbol: str, ref: str, extra: str = "") -> str:
    """Verbatim port of src/live.js buildForecastPrompt — the live prompt.
    ``extra`` is the experiment's additional input block (E0 passes none)."""
    base = (
        f"What will {symbol} price do from here? Reason over the snapshot and give a "
        "structured, scoreable forecast (bias, expected path, level targets, "
        "invalidation, confidence).\n"
        "DISCIPLINE (hard rules):\n"
        "1. CITE the snapshot's regime + technicals VERBATIM (vs_vwap_pt, rsi, "
        "draw.dir). Never restate a relationship the numbers contradict.\n"
        "2. If ict_htf.present is false, there IS NO hourly setup — you must not "
        "claim one or use its levels; say it was suppressed and why.\n"
        "3. SANITY CHECK before answering: a down bias requires invalidation ABOVE "
        "current price; an up bias requires it BELOW. If your setup is already "
        "beyond its invalidation at current price, output bias \"neutral\" and say "
        "\"stand down — no valid setup\". Standing down is a first-class forecast.\n"
        "4. Negative gamma amplifies BOTH directions — below-the-flip on a risk-on "
        "tape means faster moves UP toward the flip, not a short signal.\n"
    )
    if extra:
        base += f"ADDITIONAL CONTEXT (experiment input — cite only if relevant):\n{extra}\n"
    return base + ref


def mira_turn_collect(prompt: str, thread: str) -> str:
    """Simpler + faithful to the SPA: concatenate token/delta texts; a done
    frame with text and nothing accumulated wins whole."""
    req = urllib.request.Request(f"{MIRA}/turn",
                                 data=json.dumps({"prompt": prompt, "thread_id": thread}).encode(),
                                 headers={"Content-Type": "application/json"})
    acc = ""
    done_text = ""
    with urllib.request.urlopen(req, timeout=300) as resp:
        buf = ""
        for raw in resp:
            buf += raw.decode("utf-8", "replace")
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                kind, data = None, {}
                for ln in frame.split("\n"):
                    if ln.startswith("event:"):
                        kind = ln[6:].strip()
                    elif ln.startswith("data:"):
                        try:
                            data = json.loads(ln[5:].strip())
                        except ValueError:
                            data = {"text": ln[5:].strip()}
                if not isinstance(data, dict):
                    continue
                t = data.get("text") or ""
                if kind in (None, "message", "token", "delta") and t:
                    acc += t
                elif kind == "done" and t:
                    done_text = t
    return acc or done_text


def extract_json(text: str):
    raw = text.strip()
    start = raw.find("{")
    if start < 0:
        return None
    depth, end = 0, -1
    for i in range(start, len(raw)):
        if raw[i] == "{":
            depth += 1
        elif raw[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end < 0:
        return None
    try:
        return json.loads(raw[start:end + 1])
    except ValueError:
        return None


def h_fresh_block(snap: dict) -> str:
    """E1 (H-fresh): tell Mira how fresh the levels map is and the rule for
    stale maps. The freshness fact rides the snapshot's param-gated block."""
    f = snap.get("freshness") or {}
    slot = f.get("levels_slot", "unknown")
    note = f.get("note", "")
    rule = ("STALENESS RULE: when the levels map was NOT refreshed today "
            "intraday, GEX-derived anchors (gamma flip, call/put walls, max "
            "pain) are REFERENCE ONLY — do not place the target exactly on "
            "them; derive targets from live structure (session high/low, VWAP, "
            "unswept liquidity) and use the map only to name the neighborhood.")
    return f"INPUT FRESHNESS: levels_slot={slot} — {note}\n{rule}"


def h_selffeed_block(rid: str, step_as_of: str) -> str:
    """E2 (H-selffeed): the last 3 SCORED verdicts of THIS day's earlier
    forecasts — look-ahead safe: only forecasts made >= 60 sim-minutes before
    this step (their scoring window has fully elapsed in replay time)."""
    import datetime as _dt
    try:
        post(f"{API}/api/replay/{urllib.parse.quote(rid)}/score", {})
        g = get(f"{API}/api/replay/{urllib.parse.quote(rid)}")
    except Exception:
        return ""
    cutoff = _dt.datetime.fromisoformat(step_as_of) - _dt.timedelta(minutes=60)
    rows = []
    for f in g.get("forecasts") or []:
        try:
            ts = _dt.datetime.fromisoformat(str(f.get("as_of")))
        except ValueError:
            continue
        if ts > cutoff:
            continue
        v = ((f.get("score") or {}).get("verdict")
             or (f.get("forecast") or {}).get("score_verdict") or f.get("score_verdict"))
        if not v:
            continue
        head = str(((f.get("forecast") or {}).get("headline")) or "")[:80]
        rows.append((ts, f"{str(f.get('as_of'))[11:16]} \"{head}\" -> {v}"))
    rows.sort()
    if not rows:
        return ""
    feed = "; ".join(r[1] for r in rows[-3:])
    return ("YOUR SCORED TRACK TODAY (oldest->newest, code-graded): " + feed + "\n"
            "SELF-CORRECTION RULE: if your last two same-direction calls were "
            "invalidated, do not repeat that bias unless you can cite what CHANGED "
            "in this snapshot; if recent calls hit, keep the same target discipline "
            "(nearest reachable level) — do not get more ambitious.")


def h_clock_block(step_as_of: str) -> str:
    """E4 (H-clock): the forecaster's OWN failure base rates by hour + an
    afternoon invalidation rule. Rates are coarse (direction-only) from the
    six-day baseline — noted in the log as partially in-sample."""
    hh = int(step_as_of[11:13])
    when = ("MORNING (09:30-11:59 ET)" if hh < 12
            else "AFTERNOON (12:00-15:59 ET)")
    return (
        f"TIME CONTEXT: it is {step_as_of[11:16]} ET — {when}.\n"
        "YOUR MEASURED FAILURE PATTERN (from your own scored record): morning "
        "forecasts get invalidated ~3 in 10; forecasts issued 12:00-15:00 get "
        "invalidated ~5 in 10 — the afternoon stops you out twice as often.\n"
        "AFTERNOON RULE: keep the nearest-reachable target discipline "
        "unchanged, but place the invalidation BEYOND the far edge of the "
        "nearest opposing zone (not a tight fixed offset) — afternoon chop "
        "wicks through tight stops before the target prints. If no opposing "
        "zone sits within reach, a neutral stand-down is better than a tight "
        "stop.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True)
    ap.add_argument("--symbol", default="SPX")
    ap.add_argument("--extra-file", default=None)
    ap.add_argument("--block-map", default=None,
        help="JSON {day: {'YYYY-MM-DDTHH:MM': text}}; each step gets the latest block at-or-before it")
    ap.add_argument("--experiment", default=None, choices=[None, "h_fresh", "h_selffeed", "h_clock"])
    ap.add_argument("--tag", default="E0")
    ap.add_argument("--step-min", type=int, default=15)
    a = ap.parse_args()

    extra = ""
    if a.extra_file:
        extra = open(a.extra_file).read().strip()
    block_map = None
    if a.block_map:
        block_map = (json.load(open(a.block_map)) or {}).get(a.day) or {}
        block_keys = sorted(block_map)

    plan = post(f"{API}/api/replay/plan",
                {"day": a.day, "symbol": a.symbol, "step_min": a.step_min})
    if not plan.get("available"):
        print(f"FAIL plan: {plan.get('note')}")
        return 1
    rid = plan["run_id"]
    raw_steps = plan.get("steps") or []
    # steps may be strings or {as_of,...} dicts depending on server version
    steps = [st if isinstance(st, str) else (st.get("as_of") or st.get("t"))
             for st in raw_steps]
    steps = [st for st in steps if st]
    print(f"[{a.tag}] {a.day} run {rid}: {len(steps)} steps")

    existing = set()
    try:
        g = get(f"{API}/api/replay/{urllib.parse.quote(rid)}")
        existing = {f.get("as_of") for f in (g.get("forecasts") or [])}
    except Exception:
        pass

    ok = err = 0
    for i, as_of in enumerate(steps):
        if as_of in existing:
            continue
        try:
            ba = "&block_ages=1" if a.experiment == "h_fresh" else ""
            snap = get(f"{API}/api/spx/snapshot?symbol={a.symbol}"
                       f"&day={a.day}&as_of={urllib.parse.quote(as_of)}{ba}")
            if not snap.get("available"):
                continue
            ref = f"SPX_SNAPSHOT_REF day={snap['day']} as_of={snap['as_of']} underlying={a.symbol}"
            step_extra = extra
            if a.experiment == "h_fresh":
                step_extra = h_fresh_block(snap) + ("\n" + extra if extra else "")
            elif a.experiment == "h_selffeed":
                fb = h_selffeed_block(rid, snap["as_of"])
                step_extra = (fb + ("\n" + extra if extra else "")) if fb else extra
            elif a.experiment == "h_clock":
                step_extra = h_clock_block(snap["as_of"]) + ("\n" + extra if extra else "")
            if block_map is not None:
                k16 = str(snap["as_of"])[:16]
                prior = [k for k in block_keys if k <= k16]
                if prior:
                    step_extra = block_map[prior[-1]] + ("\n" + step_extra if step_extra else "")
            prompt = build_prompt(a.symbol, ref, step_extra)
            text = mira_turn_collect(prompt, f"replay-{a.tag}-{a.day}-{as_of}")
            data = extract_json(text)
            post(f"{API}/api/spx/forecast", {
                "day": a.day, "as_of": snap["as_of"], "symbol": a.symbol,
                "snapshot": snap, "forecast": data, "forecast_text": text,
                "run_id": rid,
            })
            ok += 1
            print(f"  {i+1}/{len(steps)} {as_of[11:16]} ok"
                  f" {'(json)' if data else '(prose)'}", flush=True)
        except Exception as e:  # noqa: BLE001 — one bad step never kills the run
            err += 1
            print(f"  {i+1}/{len(steps)} {as_of[11:16]} ERR {e}", flush=True)

    post(f"{API}/api/replay/{urllib.parse.quote(rid)}/score", {})
    g = get(f"{API}/api/replay/{urllib.parse.quote(rid)}")
    fs = g.get("forecasts") or []
    verdicts = {}
    hits = scored = 0
    for f in fs:
        v = ((f.get("score") or {}).get("verdict")
             or (f.get("forecast") or {}).get("score_verdict") or f.get("score_verdict"))
        if not v:
            continue
        verdicts[v] = verdicts.get(v, 0) + 1
        scored += 1
        if "hit" in str(v).lower():
            hits += 1
    rate = (hits / scored) if scored else None
    print(f"[{a.tag}] {a.day} DONE run={rid} forecasts={len(fs)} new={ok} err={err}")
    print(f"[{a.tag}] verdicts={verdicts}")
    print(f"[{a.tag}] HIT-RATE {a.day}: {rate if rate is None else round(rate, 3)} "
          f"({hits}/{scored})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
