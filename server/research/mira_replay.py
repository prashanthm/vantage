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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True)
    ap.add_argument("--symbol", default="SPX")
    ap.add_argument("--extra-file", default=None)
    ap.add_argument("--tag", default="E0")
    ap.add_argument("--step-min", type=int, default=15)
    a = ap.parse_args()

    extra = ""
    if a.extra_file:
        extra = open(a.extra_file).read().strip()

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
            snap = get(f"{API}/api/spx/snapshot?symbol={a.symbol}"
                       f"&day={a.day}&as_of={urllib.parse.quote(as_of)}")
            if not snap.get("available"):
                continue
            ref = f"SPX_SNAPSHOT_REF day={snap['day']} as_of={snap['as_of']} underlying={a.symbol}"
            prompt = build_prompt(a.symbol, ref, extra)
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
