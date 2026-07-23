"""breaker-fvg-anchor goal — do BROKEN swing levels anchor future FVG edges?

Freeze:   python -m research.breaker_fvg_anchor --freeze
Measure:  python -m research.breaker_fvg_anchor [--eps 0.25] [--perms 500]

Definitions mirror the vendored Liquidity Sweep Hunter + goal.md:
pivot 10/10 → broken on a close-through with ≥0.1×ATR penetration → live for
300 bars. FVG = 3-bar gap. H1 = FVGs within ±2 bars of a break (co-generated).
H2 = FVGs ≥3 bars after the break. Hit = either FVG edge within eps×ATR of a
broken level that was ALREADY broken (and not aged out) at formation time.
Control: K random levels from the trailing 300-bar range per FVG, K = live
broken-level count; permutation p over --perms draws.

Research-only (ADR-010): reads yfinance once for the freeze, then only the
frozen JSON. No store writes, no orders.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vantage_server.ict import atr as _atr, pivots as _pivots  # noqa: E402

CACHE = Path(__file__).resolve().parents[1] / "backtest_data" / "nq_fvg_breaker.json"
SYMBOL = "NQ=F"
INTERVALS = {"5m": "60d", "15m": "60d", "60m": "730d"}
PIV_N = 10          # indicator swing lookback
PEN_ATR = 0.10      # indicator min penetration
MAX_AGE = 300       # indicator level cap
COGEN_BARS = 2      # |formed_i - break_i| <= 2 → co-generated (H1)
ATR_N = 14


def freeze() -> None:
    import yfinance as yf
    out = {"frozen_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
           "symbol": SYMBOL, "bars": {}}
    for iv, period in INTERVALS.items():
        df = yf.Ticker(SYMBOL).history(period=period, interval=iv)
        if df.empty:
            raise SystemExit(f"no bars for {SYMBOL} {iv}")
        out["bars"][iv] = {
            "ts": [t.isoformat() for t in df.index],
            "open": [round(float(v), 2) for v in df["Open"]],
            "high": [round(float(v), 2) for v in df["High"]],
            "low": [round(float(v), 2) for v in df["Low"]],
            "close": [round(float(v), 2) for v in df["Close"]],
        }
        print(f"froze {SYMBOL} {iv}: {len(df)} bars "
              f"({str(df.index[0])[:10]} → {str(df.index[-1])[:10]})")
    CACHE.write_text(json.dumps(out))
    print(f"wrote {CACHE}")


def all_fvgs(hi: list, lo: list) -> list[dict]:
    """EVERY 3-bar gap (filled-later or not — anchoring is about formation)."""
    out = []
    for j in range(2, len(hi)):
        if lo[j] > hi[j - 2]:
            out.append({"formed_i": j, "lo": hi[j - 2], "hi": lo[j], "side": "bull"})
        elif hi[j] < lo[j - 2]:
            out.append({"formed_i": j, "lo": hi[j], "hi": lo[j - 2], "side": "bear"})
    return out


def broken_levels(hi, lo, cl) -> list[dict]:
    """Each pivot's break event: {price, pivot_i, confirmed_i, break_i}.
    A pivot high breaks on close > price (+pen); a low on close < price (−pen).
    Scan starts at confirmation (pivot_i + PIV_N); a level ages out MAX_AGE
    bars after the pivot, mirroring the indicator."""
    ph, pl = _pivots(hi, lo, PIV_N)
    out = []
    for is_high, book in ((True, ph), (False, pl)):
        for pi, price in book.items():
            start = pi + PIV_N
            for i in range(start, min(len(cl), pi + MAX_AGE)):
                pen = _atr(hi, lo, cl, i, ATR_N) * PEN_ATR
                if (cl[i] > price + pen) if is_high else (cl[i] < price - pen):
                    out.append({"price": price, "is_high": is_high,
                                "pivot_i": pi, "break_i": i})
                    break
    return out


def measure(iv: str, bars: dict, eps_atr: float, perms: int, seed: int = 7) -> dict:
    hi, lo, cl = bars["high"], bars["low"], bars["close"]
    rng = random.Random(seed)
    breaks = broken_levels(hi, lo, cl)
    fvgs = all_fvgs(hi, lo)

    def live_broken(at_i: int) -> list[float]:
        # broken before at_i, not aged out (age from the PIVOT, like the indicator)
        return [b["price"] for b in breaks
                if b["break_i"] < at_i and at_i - b["pivot_i"] <= MAX_AGE]

    def hit(edges: tuple, levels: list[float], tol: float) -> bool:
        return any(abs(e - p) <= tol for e in edges for p in levels)

    h1 = {"n": 0, "hits": 0}
    h2 = {"n": 0, "hits": 0}
    ctrl_hits = [0] * perms
    h2_rows = []
    for f in fvgs:
        j = f["formed_i"]
        tol = _atr(hi, lo, cl, j, ATR_N) * eps_atr
        if tol <= 0:
            continue
        edges = (f["lo"], f["hi"])
        # co-generated (H1): a break within ±COGEN_BARS of formation whose
        # level sits at an edge
        cogen_levels = [b["price"] for b in breaks if abs(b["break_i"] - j) <= COGEN_BARS]
        if cogen_levels:
            h1["n"] += 1
            h1["hits"] += 1 if hit(edges, cogen_levels, tol) else 0
        # future anchoring (H2): levels broken ≥3 bars BEFORE formation
        lv = [b["price"] for b in breaks
              if j - b["break_i"] >= COGEN_BARS + 1 and j - b["pivot_i"] <= MAX_AGE]
        if not lv:
            continue
        h2["n"] += 1
        is_hit = hit(edges, lv, tol)
        h2["hits"] += 1 if is_hit else 0
        h2_rows.append((j, is_hit))
        # control: K random levels from the trailing MAX_AGE bar range
        w0 = max(0, j - MAX_AGE)
        rlo, rhi = min(lo[w0:j + 1]), max(hi[w0:j + 1])
        for p in range(perms):
            rand_lv = [rng.uniform(rlo, rhi) for _ in lv]
            ctrl_hits[p] += 1 if hit(edges, rand_lv, tol) else 0

    rate = (h2["hits"] / h2["n"]) if h2["n"] else None
    ctrl_rates = [c / h2["n"] for c in ctrl_hits] if h2["n"] else []
    ctrl_mean = sum(ctrl_rates) / len(ctrl_rates) if ctrl_rates else None
    # permutation p: share of control draws with hit-rate >= observed
    p_val = (sum(1 for r in ctrl_rates if r >= rate) / len(ctrl_rates)
             if rate is not None and ctrl_rates else None)
    return {
        "interval": iv, "bars": len(cl), "pivot_breaks": len(breaks),
        "fvgs": len(fvgs), "eps_atr": eps_atr,
        "h1_cogen": {**h1, "rate": round(h1["hits"] / h1["n"], 4) if h1["n"] else None},
        "h2_future": {**h2, "rate": round(rate, 4) if rate is not None else None,
                      "ctrl_rate": round(ctrl_mean, 4) if ctrl_mean is not None else None,
                      "lift": round(rate / ctrl_mean, 2) if rate and ctrl_mean else None,
                      "p": round(p_val, 4) if p_val is not None else None},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--eps", type=float, default=0.25)
    ap.add_argument("--perms", type=int, default=500)
    args = ap.parse_args(argv)
    if args.freeze:
        freeze()
        return 0
    data = json.loads(CACHE.read_text())
    for iv in INTERVALS:
        res = measure(iv, data["bars"][iv], args.eps, args.perms)
        print(json.dumps(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
