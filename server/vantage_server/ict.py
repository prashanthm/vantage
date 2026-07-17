"""ICT structure detection — a clean port of the operator's two Pine indicators
(``liq-levels-mtf`` = pivot BSL/SSL liquidity + mitigation; ``t4t-high-prob-ob`` =
sweep + displacement + FVG order blocks + breakers).

Pure functions over OHLC lists (no I/O). The SPX-analyst snapshot uses these to
describe the tape structurally: unswept liquidity, order blocks, fresh FVGs, and
the "draw" — the level-based magnet the ict-coach goal validated (NOT a 1m FVG,
which inverted in testing). Validated origins in claudedocs/goals/ict-coach.
"""
from __future__ import annotations


def atr(hi, lo, cl, i, n=14):
    if i < 1:
        return 0.0
    trs = []
    for k in range(max(1, i - n + 1), i + 1):
        trs.append(max(hi[k] - lo[k], abs(hi[k] - cl[k - 1]), abs(lo[k] - cl[k - 1])))
    return sum(trs) / len(trs) if trs else 0.0


def pivots(hi, lo, n=2):
    """Confirmed fractal pivot highs/lows (n bars each side). {bar_index: price}."""
    ph, pl = {}, {}
    for i in range(n, len(hi) - n):
        if hi[i] == max(hi[i - n:i + n + 1]):
            ph[i] = hi[i]
        if lo[i] == min(lo[i - n:i + n + 1]):
            pl[i] = lo[i]
    return ph, pl


def order_blocks(hi, lo, cl, op, disp_mult=0.7, piv=2, ll_look=20, eq_tol=0.15):
    """The high-probability OB engine: sweep + displacement + FVG. Returns
    (obs, swept_low, swept_high). Each OB: {i, side, top, bottom, formed_i}."""
    ph, pl = pivots(hi, lo, piv)
    pool_lo, pool_hi = dict(pl), dict(ph)
    swept_low = [False] * len(hi)
    swept_high = [False] * len(hi)
    for i in range(len(hi)):
        a = atr(hi, lo, cl, i, 10)
        tol = eq_tol * a
        if i > ll_look:
            if lo[i] < min(lo[i - ll_look:i]):
                swept_low[i] = True
            if hi[i] > max(hi[i - ll_look:i]):
                swept_high[i] = True
        for j, p in list(pool_lo.items()):
            if j < i and lo[i] < p:
                swept_low[i] = True
                pool_lo.pop(j, None)
            elif j < i and lo[i] <= p + tol:
                swept_low[i] = True
        for j, p in list(pool_hi.items()):
            if j < i and hi[i] > p:
                swept_high[i] = True
                pool_hi.pop(j, None)
            elif j < i and hi[i] >= p - tol:
                swept_high[i] = True

    obs = []
    for i in range(3, len(hi)):
        a1 = atr(hi, lo, cl, i - 1, 10)
        bull_fvg = lo[i] > hi[i - 2]
        bear_fvg = hi[i] < lo[i - 2]
        disp_b = cl[i - 1] > op[i - 1] and (disp_mult == 0 or (cl[i - 1] - op[i - 1]) > disp_mult * a1)
        disp_s = cl[i - 1] < op[i - 1] and (disp_mult == 0 or (op[i - 1] - cl[i - 1]) > disp_mult * a1)
        if swept_low[i - 2] and cl[i - 2] < op[i - 2] and lo[i - 2] <= lo[i - 1] and disp_b and bull_fvg:
            obs.append({"i": i, "side": "bull", "top": max(op[i - 2], hi[i - 2]),
                        "bottom": lo[i - 2], "formed_i": i})
        if swept_high[i - 2] and cl[i - 2] > op[i - 2] and hi[i - 2] >= hi[i - 1] and disp_s and bear_fvg:
            obs.append({"i": i, "side": "bear", "top": hi[i - 2],
                        "bottom": min(op[i - 2], lo[i - 2]), "formed_i": i})
    return obs, swept_low, swept_high


def fresh_fvgs(hi, lo, upto=None):
    """Unfilled fair-value gaps as of bar ``upto`` (default: last bar).
    Each: {side, lo, hi, formed_i}."""
    n = len(hi) if upto is None else upto + 1
    out = []
    for j in range(2, n):
        if lo[j] > hi[j - 2]:
            zlo, zhi, side = hi[j - 2], lo[j], "bull"
        elif hi[j] < lo[j - 2]:
            zlo, zhi, side = hi[j], lo[j - 2], "bear"
        else:
            continue
        if any(lo[m] <= zlo and hi[m] >= zlo for m in range(j + 1, n)):
            continue
        out.append({"side": side, "lo": zlo, "hi": zhi, "formed_i": j})
    return out


def unswept_liquidity(hi, lo, piv=2):
    """Pivot pools NOT yet taken as of the last bar — resting BSL (above) / SSL
    (below). Returns {'bsl': [prices desc], 'ssl': [prices asc]}."""
    ph, pl = pivots(hi, lo, piv)
    n = len(hi)
    bsl, ssl = [], []
    for j, p in ph.items():
        if not any(hi[k] > p for k in range(j + piv + 1, n)):
            bsl.append(p)
    for j, p in pl.items():
        if not any(lo[k] < p for k in range(j + piv + 1, n)):
            ssl.append(p)
    return {"bsl": sorted(set(round(x, 1) for x in bsl), reverse=True),
            "ssl": sorted(set(round(x, 1) for x in ssl))}


def active_obs(hi, lo, cl, op, at=None):
    """Fresh (unmitigated) order blocks as of bar ``at`` (default last).
    A bull OB is mitigated by a close below its bottom; bear by a close above top."""
    obs, _, _ = order_blocks(hi, lo, cl, op)
    ei = (len(hi) - 1) if at is None else at
    out = []
    for o in obs:
        if o["formed_i"] > ei:
            continue
        mit = False
        for k in range(o["formed_i"], ei + 1):
            if o["side"] == "bull" and cl[k] < o["bottom"]:
                mit = True
                break
            if o["side"] == "bear" and cl[k] > o["top"]:
                mit = True
                break
        if not mit:
            out.append({"side": o["side"], "top": round(o["top"], 1),
                        "bottom": round(o["bottom"], 1), "formed_i": o["formed_i"]})
    return out


#: ICT's canonical IPDA data-range lookbacks, in TRADING days.
IPDA_LOOKBACKS = (20, 40, 60)


def ipda_ranges(daily_hi, daily_lo, lookbacks=IPDA_LOOKBACKS):
    # NOTE: backtested and found to carry NO edge on SPX — no reversal edge, and
    # the apparent draw/magnet edge was a distance artifact (goal: ipda-edge,
    # claudedocs/goals/ipda-edge/). NOT used by the snapshot/coach/chart; kept
    # only for the backtest harness (server/scratch/ipda_backtest.py).
    """ICT IPDA data ranges: for each lookback of N trading days, the highest
    high, lowest low, and equilibrium (midpoint) over the last N daily bars.
    These are the reference extremes the "algorithm" is said to draw price
    toward. ``daily_hi``/``daily_lo`` are chronological daily high/low arrays.
    Returns [{days, high, low, eq}] for each lookback that has enough data."""
    out = []
    n = min(len(daily_hi), len(daily_lo))
    for days in lookbacks:
        if n == 0:
            continue
        win = min(days, n)               # short history → use what we have
        hh = max(daily_hi[n - win:n])
        ll = min(daily_lo[n - win:n])
        out.append({"days": days, "high": round(hh, 1), "low": round(ll, 1),
                    "eq": round((hh + ll) / 2, 1), "bars": win})
    return out


def draw_from_levels(price, levels, tol=0.0):
    """The DRAW = the nearer opposing PLAYBOOK level (the validated magnet — NOT a
    1m FVG). Returns {'dir': 'up'|'down'|None, 'level': price, 'dist': pts}."""
    above = [p for p in levels if p > price + tol]
    below = [p for p in levels if p < price - tol]
    up = min(above) if above else None
    dn = max(below) if below else None
    if up is None and dn is None:
        return {"dir": None, "level": None, "dist": None}
    if dn is None or (up is not None and (up - price) <= (price - dn)):
        return {"dir": "up", "level": round(up, 1), "dist": round(up - price, 1)}
    return {"dir": "down", "level": round(dn, 1), "dist": round(price - dn, 1)}
