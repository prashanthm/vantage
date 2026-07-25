"""Scanner-families wave 3 — formula-DSL signal discovery, NVIDIA-blueprint
engine + Vantage court system.

The blueprint's good idea (a compact operator catalog an LLM composes into
cross-sectional signals) with OUR validation replacing theirs:
  - frozen tape (backtest_data/scanner_univ_hourly.json, price-only),
  - NON-overlapping forward windows (t-stats not inflated by overlap),
  - halves stability (same sign, both halves pull their weight),
  - multiplicity-honest placebo bar: the null is the MAX |IC| of random
    20-formula batches of matched complexity — candidates must beat what
    dumb luck achieves when it also gets 20 tries.

Usage:
  python research/formula_signals.py --null          # build the placebo bar
  python research/formula_signals.py --candidates    # run pre-registered set
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys

import numpy as np

H = 7            # forward-return horizon: ~1 trading day of hourly bars
MIN_NAMES = 30   # cross-section must have at least this many valid names

# ── data ─────────────────────────────────────────────────────────────────────

def load_panel():
    d = json.load(open("backtest_data/scanner_univ_hourly.json"))
    bars = d["bars"]
    all_ts = sorted({t for b in bars.values() for t in b["ts"]})
    idx = {t: i for i, t in enumerate(all_ts)}
    syms = sorted(bars)
    T, N = len(all_ts), len(syms)
    panel = {f: np.full((T, N), np.nan) for f in ("open", "high", "low", "close")}
    for j, s in enumerate(syms):
        b = bars[s]
        rows = [idx[t] for t in b["ts"]]
        for f in panel:
            panel[f][rows, j] = b[f]
    return panel, all_ts, syms

# ── operator catalog (all operate column-wise on T×N arrays) ────────────────

def delay(x, n):
    out = np.full_like(x, np.nan)
    out[n:] = x[:-n]
    return out

def ts_ret(x, n):
    return x / delay(x, n) - 1.0

def _rolling(x, n, fn):
    out = np.full_like(x, np.nan)
    for i in range(n - 1, x.shape[0]):
        out[i] = fn(x[i - n + 1:i + 1], axis=0)
    return out

def ts_mean(x, n): return _rolling(x, n, np.nanmean)
def ts_std(x, n):  return _rolling(x, n, np.nanstd)
def ts_min(x, n):  return _rolling(x, n, np.nanmin)
def ts_max(x, n):  return _rolling(x, n, np.nanmax)

def decay_linear(x, n):
    w = np.arange(1, n + 1, dtype=float)
    w /= w.sum()
    out = np.full_like(x, np.nan)
    for i in range(n - 1, x.shape[0]):
        seg = x[i - n + 1:i + 1]
        out[i] = np.nansum(seg * w[:, None], axis=0)
    return out

def zscore(x, n):
    m, s = ts_mean(x, n), ts_std(x, n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return (x - m) / s

CATALOG = {
    "delay": (delay, [7, 35, 140]),
    "ts_ret": (ts_ret, [7, 35, 140]),
    "ts_mean": (ts_mean, [7, 35, 140]),
    "ts_std": (ts_std, [7, 35, 140]),
    "ts_min": (ts_min, [35, 140]),
    "ts_max": (ts_max, [35, 140]),
    "decay_linear": (decay_linear, [7, 35]),
    "zscore": (zscore, [35, 140]),
}

# ── scoring ──────────────────────────────────────────────────────────────────

def _rank_rows(a):
    """Row-wise ranks with NaNs preserved (average-free ordinal ranks are fine
    for IC — ties are rare in continuous signals)."""
    out = np.full_like(a, np.nan)
    for i in range(a.shape[0]):
        row = a[i]
        m = ~np.isnan(row)
        if m.sum() < 2:
            continue
        r = np.empty(m.sum())
        r[np.argsort(row[m])] = np.arange(m.sum())
        out[i, m] = r
    return out

def ic_stats(sig, close, split=True):
    """Mean Spearman IC of sig vs H-bar forward returns on NON-overlapping
    windows. Returns dict with mean, t, n, and halves."""
    fwd = delay(close, -H) if False else np.full_like(close, np.nan)
    fwd[:-H] = close[H:] / close[:-H] - 1.0
    rows = list(range(0, close.shape[0] - H, H))     # non-overlapping
    rs = _rank_rows(sig)
    rf = _rank_rows(fwd)
    ics = []
    kept_rows = []
    for i in rows:
        m = ~np.isnan(rs[i]) & ~np.isnan(rf[i])
        if m.sum() < MIN_NAMES:
            continue
        a, b = rs[i][m], rf[i][m]
        a = a - a.mean(); b = b - b.mean()
        den = math.sqrt((a * a).sum() * (b * b).sum())
        if den == 0:
            continue
        ics.append(float((a * b).sum() / den))
        kept_rows.append(i)
    ics = np.array(ics)
    if len(ics) < 40:
        return None
    mean = float(ics.mean())
    t = float(mean / (ics.std(ddof=1) / math.sqrt(len(ics))))
    out = {"ic": round(mean, 4), "t": round(t, 2), "n": len(ics)}
    if split:
        half = len(ics) // 2
        out["ic_a"] = round(float(ics[:half].mean()), 4)
        out["ic_b"] = round(float(ics[half:].mean()), 4)
    return out

# ── random formula generator (the placebo population) ───────────────────────

UNARY = ["ts_ret", "ts_mean", "ts_std", "ts_min", "ts_max", "decay_linear", "zscore", "delay"]

def random_formula(rng, panel):
    """Depth-2 composition of catalog ops on a random base field — matched to
    the complexity of the pre-registered candidates."""
    base = panel[rng.choice(["close", "high", "low", "open"])]
    steps = []
    x = base
    for _ in range(rng.randint(1, 2)):
        op = rng.choice(UNARY)
        fn, windows = CATALOG[op]
        n = rng.choice(windows)
        x = fn(x, n)
        steps.append(f"{op}({n})")
    if rng.random() < 0.5:
        x = -x
        steps.append("neg")
    return x, "->".join(steps)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--null", action="store_true")
    ap.add_argument("--null-n", type=int, default=200)
    ap.add_argument("--candidates", action="store_true")
    a = ap.parse_args()
    panel, ts, syms = load_panel()
    close = panel["close"]
    print(f"panel: {close.shape[0]} bars x {close.shape[1]} names · "
          f"{ts[0][:10]} -> {ts[-1][:10]} · horizon {H} bars non-overlapping",
          file=sys.stderr)

    if a.null:
        rng = random.Random(20260725)
        absics = []
        for k in range(a.null_n):
            sig, desc = random_formula(rng, panel)
            st = ic_stats(sig, close, split=False)
            if st:
                absics.append(abs(st["ic"]))
            if (k + 1) % 25 == 0:
                print(f"  null {k+1}/{a.null_n}", file=sys.stderr)
        absics = sorted(absics)
        arr = np.array(absics)
        # max-of-20 batches, bootstrapped: what dumb luck achieves with 20 tries
        rng2 = np.random.default_rng(7)
        maxes = [float(rng2.choice(arr, 20).max()) for _ in range(2000)]
        maxes.sort()
        print(json.dumps({
            "null_formulas": len(absics),
            "abs_ic_p50": round(float(np.percentile(arr, 50)), 4),
            "abs_ic_p95": round(float(np.percentile(arr, 95)), 4),
            "max_of_20_p50": round(float(np.percentile(maxes, 50)), 4),
            "max_of_20_p95": round(float(np.percentile(maxes, 95)), 4),
        }, indent=1))
        return 0

    if a.candidates:
        from formula_candidates import CANDIDATES  # registered separately, run after
        results = []
        for name, build, pred_sign, rationale in CANDIDATES:
            sig = build(panel)
            st = ic_stats(sig, close)
            row = {"name": name, "pred": pred_sign, **(st or {"ic": None})}
            results.append(row)
            print(json.dumps(row))
        return 0
    return 1

if __name__ == "__main__":
    sys.exit(main())
