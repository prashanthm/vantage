"""expression-economics H1/H2/H3 sweep (pre-registered in the goal log BEFORE
this run). Same production-detector sweep as ict_spread_baseline.py,
LONG-only A+ set, but per-trade it records the geometry (risk, rr to zone)
and simulates TWO expressions:

  H1 shares/R: stop at invalid (−1R), exit at zone target (+rr R);
     unresolved at the 245-bar cap MARKS AT CAP CLOSE (±R at last price).
  H2 1R-spread race: first-touch of entry+risk vs invalid (binary).

Run: cd server && .venv/bin/python research/ict_expression_sweep.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vantage_server import ict, ict_htf  # noqa: E402

TAPE = Path(__file__).resolve().parent.parent / "backtest_data" / "scanner_univ_hourly.json"
FRESH = 3
WINDOW = 105
CAP = 245
MIN_BARS = 32


def sweep_symbol(sym, b):
    hi, lo, cl, op, ts = b["high"], b["low"], b["close"], b["open"], b["ts"]
    n = len(cl)
    out = []
    seen = set()
    for t in range(MIN_BARS, n):
        w0 = max(0, t + 1 - WINDOW)
        h, l, c, o = hi[w0:t + 1], lo[w0:t + 1], cl[w0:t + 1], op[w0:t + 1]
        try:
            obs = ict.active_obs(h, l, c, o)
            s = ict_htf.htf_setup(h, l, c, o, str(ts[t])[11:16], active_obs=obs)
        except Exception:
            continue
        if not s.get("present") or s.get("tier") != "A+" or s.get("dir") != "long":
            continue
        bars_ago = s.get("bars_ago") or 0
        abs_ti = t - bars_ago
        if (sym, abs_ti) in seen or bars_ago > FRESH:
            continue
        seen.add((sym, abs_ti))
        entry = cl[t]                       # arm at scan close (the pipe's entry)
        tgt = (s.get("targets") or [{}])[-1].get("price")
        inv = s.get("invalid")
        ce = s.get("ce")
        if tgt is None or inv is None:
            continue
        risk = entry - inv
        if risk <= 0 or tgt <= entry:
            continue
        rr = (tgt - entry) / risk
        one_r = entry + risk
        # walk once, resolving all three races
        zone_out = oner_out = None          # 1 win / 0 loss / None open
        mark = entry
        for j in range(t + 1, min(n, t + 1 + CAP)):
            mark = cl[j]
            if zone_out is None:
                if lo[j] <= inv:
                    zone_out = 0
                elif hi[j] >= tgt:
                    zone_out = 1
            if oner_out is None:
                if lo[j] <= inv:
                    oner_out = 0
                elif hi[j] >= one_r:
                    oner_out = 1
            if zone_out is not None and oner_out is not None:
                break
        # H1 shares R: win +rr, loss −1, open → mark-to-cap in R
        if zone_out == 1:
            r_shares = rr
        elif zone_out == 0:
            r_shares = -1.0
        else:
            r_shares = (mark - entry) / risk
        # H3: resting limit at the CE — fill on first touch within 24 bars,
        # then a 2R-vs-invalid race from the fill bar
        h3 = {"filled": False, "r": None}
        if ce is not None and inv is not None and ce > inv:
            fill_j = None
            for j in range(t + 1, min(n, t + 1 + 24)):
                if lo[j] <= ce:
                    fill_j = j
                    break
            if fill_j is not None:
                h3["filled"] = True
                risk3 = ce - inv
                tgt3 = ce + 2.0 * risk3
                mark3 = ce
                res = None
                for j in range(fill_j, min(n, fill_j + CAP)):
                    # fill bar itself can resolve; stop-first convention
                    mark3 = cl[j]
                    if lo[j] <= inv:
                        res = -1.0
                        break
                    if hi[j] >= tgt3:
                        res = 2.0
                        break
                h3["r"] = res if res is not None else (mark3 - ce) / risk3
        out.append({"sym": sym, "arm_ts": ts[t], "rr": rr,
                    "r_shares": r_shares, "zone": zone_out, "one_r": oner_out,
                    "h3_filled": h3["filled"], "h3_r": h3["r"]})
    return out


def main():
    d = json.load(open(TAPE))
    trades = []
    for i, (sym, b) in enumerate(sorted(d["bars"].items())):
        trades.extend(sweep_symbol(sym, b))
        print(f"  {i+1}/{len(d['bars'])} {sym} · {len(trades)}", file=sys.stderr)
    trades.sort(key=lambda r: r["arm_ts"])
    n = len(trades)
    half = n // 2

    def stats(rows):
        m = len(rows)
        mean_r = sum(r["r_shares"] for r in rows) / max(m, 1)
        oner = [r for r in rows if r["one_r"] is not None]
        wr1 = sum(r["one_r"] for r in oner) / max(len(oner), 1)
        h3 = [r for r in rows if r.get("h3_filled")]
        h3_mean = sum(r["h3_r"] for r in h3) / max(len(h3), 1)
        return {"n": m, "mean_r_shares": round(mean_r, 4),
                "oner_n": len(oner), "oner_wr": round(wr1, 4),
                "h3_fill_rate": round(len(h3) / max(m, 1), 3),
                "h3_n": len(h3), "h3_mean_r": round(h3_mean, 4)}

    print(json.dumps({
        "n": n,
        "mean_rr": round(sum(r["rr"] for r in trades) / max(n, 1), 3),
        "all": stats(trades),
        "half_a": stats(trades[:half]),
        "half_b": stats(trades[half:]),
        "span": [trades[0]["arm_ts"], trades[-1]["arm_ts"]] if trades else None,
    }, indent=1))


if __name__ == "__main__":
    main()
