"""ICT engine — a faithful Python port of the operator's two Pine indicators,
run against the PERSISTED 1m bars. E0: confirm it detects the structures the
charts show (pivots/sweeps/OBs/breakers), no edge claim yet.

Ports:
  liq-levels-mtf.pine   → liquidity pools (pivots) + mitigation (the grab)
  t4t-high-prob-ob.pine → sweep + displacement + FVG order blocks + breakers
"""
import sys
sys.path.insert(0, "/app")
from vantage_server.store import Store

store = Store()


def load(day, sym="^GSPC"):
    o = store.load_intraday_bars(sym, day, "1m")
    if not o:
        return None
    return o["ts"], o["open"], o["high"], o["low"], o["close"], o.get("volume") or [0]*len(o["ts"])


def atr(hi, lo, cl, i, n=10):
    if i < 1:
        return 0.0
    trs = []
    for k in range(max(1, i - n + 1), i + 1):
        trs.append(max(hi[k] - lo[k], abs(hi[k] - cl[k-1]), abs(lo[k] - cl[k-1])))
    return sum(trs) / len(trs) if trs else 0.0


def pivots(hi, lo, n):
    """confirmed pivot highs/lows (n bars each side). Returns {i: price} at the
    pivot bar (confirmed n bars later, but we key on the pivot bar itself)."""
    ph, pl = {}, {}
    for i in range(n, len(hi) - n):
        if hi[i] == max(hi[i-n:i+n+1]):
            ph[i] = hi[i]
        if lo[i] == min(lo[i-n:i+n+1]):
            pl[i] = lo[i]
    return ph, pl


def order_blocks(hi, lo, cl, op, disp_mult=0.7, piv=2, ll_look=20, eq_tol=0.15):
    """The t4t high-prob OB engine: sweep + displacement + FVG. Returns a list of
    OB dicts {i, side, top, bottom, formed_i}. side='bull' (support) / 'bear'."""
    ph, pl = pivots(hi, lo, piv)
    pool_lo = dict(pl)   # armed SSL pools (consumed on strict break)
    pool_hi = dict(ph)
    swept_low = [False] * len(hi)
    swept_high = [False] * len(hi)
    for i in range(len(hi)):
        a = atr(hi, lo, cl, i)
        tol = eq_tol * a
        # lower-low / higher-high vs prior N
        if i > ll_look:
            if lo[i] < min(lo[i-ll_look:i]):
                swept_low[i] = True
            if hi[i] > max(hi[i-ll_look:i]):
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
        a1 = atr(hi, lo, cl, i - 1)
        bullFVG = lo[i] > hi[i-2]
        bearFVG = hi[i] < lo[i-2]
        dispOKb = cl[i-1] > op[i-1] and (disp_mult == 0 or (cl[i-1] - op[i-1]) > disp_mult * a1)
        dispOKs = cl[i-1] < op[i-1] and (disp_mult == 0 or (op[i-1] - cl[i-1]) > disp_mult * a1)
        # bullish OB: swept a low 2 bars back, bearish OB candle holding the low,
        # displacement up, FVG
        if swept_low[i-2] and cl[i-2] < op[i-2] and lo[i-2] <= lo[i-1] and dispOKb and bullFVG:
            obs.append({"i": i, "side": "bull", "top": max(op[i-2], hi[i-2]),
                        "bottom": lo[i-2], "formed_i": i})
        if swept_high[i-2] and cl[i-2] > op[i-2] and hi[i-2] >= hi[i-1] and dispOKs and bearFVG:
            obs.append({"i": i, "side": "bear", "top": hi[i-2],
                        "bottom": min(op[i-2], lo[i-2]), "formed_i": i})
    return obs, swept_low, swept_high


def fresh_fvgs(hi, lo, upto):
    out = []
    for j in range(2, upto + 1):
        if lo[j] > hi[j-2]:
            zlo, zhi, k = hi[j-2], lo[j], "bull"
        elif hi[j] < lo[j-2]:
            zlo, zhi, k = hi[j], lo[j-2], "bear"
        else:
            continue
        filled = any(lo[m] <= zlo and hi[m] >= zlo for m in range(j+1, upto+1))
        if not filled:
            out.append((k, zlo, zhi, j))
    return out


if __name__ == "__main__":
    for DAY in ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]:
        d = load(DAY)
        if not d:
            print(f"{DAY}: no bars"); continue
        ts, op, hi, lo, cl, vol = d
        ph, pl = pivots(hi, lo, 2)
        obs, sl, sh = order_blocks(hi, lo, cl, op)
        n_sweep_lo = sum(sl); n_sweep_hi = sum(sh)
        bull_ob = sum(1 for o in obs if o["side"] == "bull")
        bear_ob = sum(1 for o in obs if o["side"] == "bear")
        fvgs = fresh_fvgs(hi, lo, len(hi) - 1)
        print(f"{DAY}: {len(hi)} bars | pivots {len(ph)}H/{len(pl)}L | "
              f"sweeps {n_sweep_hi}hi/{n_sweep_lo}lo | OBs {bull_ob}+/{bear_ob}- | "
              f"unfilled FVGs at EOD: {len(fvgs)}")
        # show the last few OBs (price zones) as a spot check
        for o in obs[-4:]:
            print(f"    OB {o['side']:4} zone {o['bottom']:.1f}-{o['top']:.1f} at bar {o['i']} ({ts[o['i']][11:16]})")
