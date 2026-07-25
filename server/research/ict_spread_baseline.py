"""ict_htf SPREAD-expression baseline WR on the frozen tape (pre-registered
2026-07-25, scanner-families log). Uses the PRODUCTION detector verbatim
(ict_htf.htf_setup + ict.active_obs) swept as-of per bar; simulates the paper
pipe's expression: arm at scan close on first A+ appearance (bars_ago <= 3),
WIN = targets[-1] touched first, LOSS = underlying_invalid touched first,
stop-first on ambiguous bars, cap 245 hourly bars (~TARGET_DTE 35d);
unresolved excluded. One trade per (symbol, trigger_i).

Run: cd server && .venv/bin/python research/ict_spread_baseline.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vantage_server import ict, ict_htf  # noqa: E402

TAPE = Path(__file__).resolve().parent.parent / "backtest_data" / "scanner_univ_hourly.json"
FRESH = 3          # first appearance with bars_ago <= FRESH arms the trade
WINDOW = 105       # trailing bars fed to the detector — mirrors production
                   # (load_hourly_series days=15 ≈ 7 bars/day), and keeps the
                   # sweep O(N·W) instead of O(N²) on the 5k-bar tape
CAP = 245          # ~35 calendar days of hourly bars (spread TARGET_DTE)
MIN_BARS = 32      # detector's own floor


def sweep_symbol(sym, b):
    hi, lo, cl, op, ts = b["high"], b["low"], b["close"], b["open"], b["ts"]
    n = len(cl)
    trades = []
    seen = set()
    for t in range(MIN_BARS, n):
        w0 = max(0, t + 1 - WINDOW)
        h, l, c, o = hi[w0:t + 1], lo[w0:t + 1], cl[w0:t + 1], op[w0:t + 1]
        try:
            obs = ict.active_obs(h, l, c, o)
            s = ict_htf.htf_setup(h, l, c, o, str(ts[t])[11:16], active_obs=obs)
        except Exception:
            continue
        if not s.get("present") or s.get("tier") != "A+":
            continue
        bars_ago = s.get("bars_ago") or 0
        abs_ti = t - bars_ago          # window-relative trigger → absolute bar
        if (sym, abs_ti) in seen or bars_ago > FRESH:
            continue
        seen.add((sym, abs_ti))
        tgt = (s.get("targets") or [{}])[-1].get("price")
        inv = s.get("invalid")
        d = 1 if s.get("dir") == "long" else -1
        if tgt is None or inv is None:
            continue
        # first-touch walk from the NEXT bar; stop-first on ambiguous bars
        outcome = None
        for j in range(t + 1, min(n, t + 1 + CAP)):
            hit_inv = lo[j] <= inv if d > 0 else hi[j] >= inv
            hit_tgt = hi[j] >= tgt if d > 0 else lo[j] <= tgt
            if hit_inv:            # stop-first convention
                outcome = 0
                break
            if hit_tgt:
                outcome = 1
                break
        if outcome is not None:
            trades.append({"sym": sym, "arm_ts": ts[t], "win": outcome, "dir": d})
    return trades


def main():
    d = json.load(open(TAPE))
    all_trades = []
    for i, (sym, b) in enumerate(sorted(d["bars"].items())):
        all_trades.extend(sweep_symbol(sym, b))
        print(f"  {i+1}/{len(d['bars'])} {sym} · {len(all_trades)} trades", file=sys.stderr)
    all_trades.sort(key=lambda r: r["arm_ts"])
    n = len(all_trades)
    if not n:
        print(json.dumps({"n": 0}))
        return
    wr = sum(r["win"] for r in all_trades) / n
    half = n // 2
    a, bb = all_trades[:half], all_trades[half:]
    wra = sum(r["win"] for r in a) / max(len(a), 1)
    wrb = sum(r["win"] for r in bb) / max(len(bb), 1)
    odds = lambda w: w / max(1e-9, 1 - w)  # noqa: E731

    def side_stats(side):
        rows = [r for r in all_trades if r["dir"] == side]
        if not rows:
            return {"n": 0}
        w = sum(r["win"] for r in rows) / len(rows)
        h = len(rows) // 2
        wa = sum(r["win"] for r in rows[:h]) / max(h, 1)
        wb = sum(r["win"] for r in rows[h:]) / max(len(rows) - h, 1)
        return {"n": len(rows), "wr": round(w, 4),
                "half_a": round(wa, 4), "half_b": round(wb, 4),
                "odds_ratio": round(max(odds(wa), odds(wb)) / max(1e-9, min(odds(wa), odds(wb))), 2)}

    print(json.dumps({
        "n": n, "wr": round(wr, 4),
        "half_a": {"n": len(a), "wr": round(wra, 4)},
        "half_b": {"n": len(bb), "wr": round(wrb, 4)},
        "odds_ratio": round(max(odds(wra), odds(wrb)) / max(1e-9, min(odds(wra), odds(wrb))), 2),
        "long": side_stats(1), "short": side_stats(-1),
        "span": [all_trades[0]["arm_ts"], all_trades[-1]["arm_ts"]],
    }, indent=1))


if __name__ == "__main__":
    main()
