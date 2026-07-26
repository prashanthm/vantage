"""Claude vs Mira, same inputs, same scorer — a 15-min forecast eval for Fri
2026-07-24. For each stored Mira forecast step, take the IDENTICAL snapshot
Mira reasoned over, generate my own {bias,target,invalidation} plot from it,
and grade BOTH with the production scorer (spx_snapshot.score_forecast). No
Mira call — my forecast is a deterministic read of the snapshot signal.

My analyst logic (grounded in the snapshot, stated plainly):
  - Anchor on VWAP + RSI + ATR (technicals) and the nearest level bands.
  - Direction: mean-reversion in the stated regime toward VWAP when stretched
    (RSI<30 stretched-low → up; RSI>70 → down); else trend with VWAP side.
  - Target: the nearest opposing ICT liquidity pool / level in the called
    direction (that's the "draw"). Invalidation: beyond the nearest level on
    the wrong side, floored at 1x the target distance (the E6 parity lesson —
    a stop tighter than the target is a wick magnet on this tape).

Run: cd server && .venv/bin/python research/claude_vs_mira_forecast.py <run_id>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vantage_server import spx_snapshot as snap  # noqa: E402
from vantage_server.store import Store  # noqa: E402

DAY = "2026-07-24"
RUN = sys.argv[1] if len(sys.argv) > 1 else None


def _levels_around(snapshot, price):
    """Sorted level prices above and below the current price (from the snapshot
    level bands)."""
    lv = snapshot.get("levels") or []
    prices = sorted(float(x["price"]) for x in lv if x.get("price") is not None)
    above = [p for p in prices if p > price]
    below = [p for p in prices if p < price]
    return above, below


def _pools(snapshot, price):
    """Nearest ICT buy-side (above) and sell-side (below) liquidity draws."""
    ict = (snapshot.get("ict") or {}).get("unswept_liquidity") or {}
    bsl = sorted(p for p in ict.get("bsl", []) if p > price)
    ssl = sorted((p for p in ict.get("ssl", []) if p < price), reverse=True)
    return (bsl[0] if bsl else None), (ssl[0] if ssl else None)


def claude_plot(snapshot):
    """MY forecast from the snapshot — deterministic, grounded, no model."""
    price = float(snapshot.get("price") or 0)
    tech = snapshot.get("technicals") or {}
    vwap = tech.get("vwap")
    rsi = tech.get("rsi")
    atr = float(tech.get("atr") or 3.0)
    if not price:
        return None
    above, below = _levels_around(snapshot, price)
    bsl, ssl = _pools(snapshot, price)

    # direction: stretch → mean-revert to VWAP; else follow the VWAP side.
    if rsi is not None and rsi <= 30:
        bias = "up"
    elif rsi is not None and rsi >= 70:
        bias = "down"
    elif vwap is not None:
        bias = "up" if price >= vwap else "down"
    else:
        bias = "up"

    # target = nearest draw in the called direction (pool first, else level),
    # but keep it reachable: cap at ~3 ATR so it's a 15-min-plausible target.
    if bias == "up":
        cands = [c for c in (bsl, above[0] if above else None) if c is not None]
        target = min(cands) if cands else price + 2 * atr
        target = min(target, price + 3 * atr)
        stop_ref = below[0] if below else price - 2 * atr
    else:
        cands = [c for c in (ssl, below[0] if below else None) if c is not None]
        target = max(cands) if cands else price - 2 * atr
        target = max(target, price - 3 * atr)
        stop_ref = above[0] if above else price + 2 * atr

    # invalidation: SYMMETRIC with the target (R:R = 1) — the honest,
    # falsifiable stop. A stop must be as reachable as the target or the call
    # is unfalsifiable (the E5-clamp trap: a 7000 stop under 7413 spot never
    # triggers, inflating hit-rate). Nudge just past a nearby opposing level
    # only if that level is INSIDE the symmetric distance (tighten, never widen).
    tgt_dist = abs(target - price)
    if bias == "up":
        invalid = price - tgt_dist
        if stop_ref < price and (price - stop_ref) < tgt_dist:
            invalid = stop_ref            # a closer real level → tighter, fine
    else:
        invalid = price + tgt_dist
        if stop_ref > price and (stop_ref - price) < tgt_dist:
            invalid = stop_ref

    return {"bias": bias, "target": round(target, 1), "invalidation": round(invalid, 1)}


def main():
    store = Store(None)
    rows = [r for r in store.list_spx_forecasts_by_run(RUN)] if RUN else []
    if not rows:
        print(f"no rows for run {RUN!r}", file=sys.stderr)
        return 1
    rows.sort(key=lambda r: r["as_of"])

    out = []
    for r in rows:
        snapshot = r.get("snapshot") or {}
        as_of = r["as_of"]
        price = r.get("price_at")
        mine = claude_plot(snapshot)
        if mine is None:
            continue
        # score MY plot with the SAME scorer: build a row shaped like a stored
        # forecast, swapping in my plot.
        my_row = {"day": DAY, "symbol": "SPX", "as_of": as_of, "price_at": price,
                  "forecast": {"plot": mine}}
        my_score = snap.score_forecast(store, my_row)
        mira_score = r.get("score")  # already scored
        out.append({
            "t": as_of[11:16], "price": price,
            "mira": {"bias": (r["forecast"].get("plot") or {}).get("bias"),
                     "tgt": (r["forecast"].get("plot") or {}).get("target"),
                     "inv": (r["forecast"].get("plot") or {}).get("invalidation"),
                     "verdict": (mira_score or {}).get("verdict")},
            "claude": {**mine, "verdict": (my_score or {}).get("verdict")},
        })

    def _rate(rows_, who):
        scored = [x for x in rows_ if x[who]["verdict"] not in (None, "inconclusive")]
        hits = [x for x in scored if x[who]["verdict"] == "hit target"]
        inval = [x for x in scored if str(x[who]["verdict"]).startswith("invalid")]
        return {"n": len(scored), "hits": len(hits),
                "hit_rate": round(len(hits) / max(len(scored), 1), 3),
                "invalidated": len(inval)}

    print(json.dumps({
        "day": DAY, "run": RUN, "steps": len(out),
        "mira": _rate(out, "mira"), "claude": _rate(out, "claude"),
        "agree_direction": sum(1 for x in out if x["mira"]["bias"] == x["claude"]["bias"]),
    }, indent=1))
    print("\nper-step (t · price · MIRA bias/tgt/inv→verdict · CLAUDE bias/tgt/inv→verdict):",
          file=sys.stderr)
    for x in out:
        m, c = x["mira"], x["claude"]
        mv, cv = str(m.get('verdict')), str(c.get('verdict'))
        print(f"  {x['t']} {str(x['price']):>8} · "
              f"M {str(m['bias']):>4} {m['tgt']}/{m['inv']}->{mv:<16} · "
              f"C {str(c['bias']):>4} {c['target']}/{c['invalidation']}->{cv}",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
