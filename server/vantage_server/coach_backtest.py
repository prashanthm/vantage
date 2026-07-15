"""Replay the coach's rule engine against a day's ACTUAL trades — the
before-the-fact coach, scored after the fact.

For each real entry it reconstructs the session VWAP / RSI / relative volume /
ATR from the same minute bars the DNA uses, resolves the nearest baked playbook
level + side, and reports the coach STATE (WARN / ENTER / WAIT) it would have
shown. Then it tallies whether WARN aligned with losers — i.e. would heeding
the coach have helped.

APPROXIMATION, not bit-identical to TradingView: VWAP/RSI seeding differs, and
early-session RSI has < 14 prior 1m bars (TradingView carries it from the prior
session). Clear cases (deep-ATR chases, wrong-side at a wall) are robust;
borderline WARN/WAIT can flip. Read the deltas, not the last dollar.

Mirrors coach_pine's rule engine exactly so the backtest and the live indicator
agree. Pure computation over the store + bars; no LLM, no orders (ADR-010).
"""
from __future__ import annotations

import datetime as _dt
import math

from . import session_activity as _sa
from . import reclaim_pine as _rp
from . import coach_pine as _cp


def _indicators(bars):
    """Session VWAP, plus per-bar RSI(14)/ATR(14)/rel-vol(20) closures over the
    RTH minute bars (already ET-filtered)."""
    closes = [float(c) for c in bars["Close"]]
    highs = [float(x) for x in bars["High"]]
    lows = [float(x) for x in bars["Low"]]
    vols = [float(v) for v in bars["Volume"]]
    tps = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(len(closes))]
    vwap = []
    spv = spV = 0.0
    for i in range(len(closes)):
        spv += tps[i] * vols[i]
        spV += vols[i]
        vwap.append(spv / spV if spV else float("nan"))

    def rsi(i, n=14):
        if i < n:
            return float("nan")
        g = l = 0.0
        for k in range(i - n + 1, i + 1):
            d = closes[k] - closes[k - 1]
            g += max(d, 0)
            l += max(-d, 0)
        if l == 0:
            return 100.0
        rs = (g / n) / (l / n)
        return 100 - 100 / (1 + rs)

    def atr(i, n=14):
        if i < 1:
            return float("nan")
        trs = [max(highs[k] - lows[k], abs(highs[k] - closes[k - 1]),
                   abs(lows[k] - closes[k - 1]))
               for k in range(max(1, i - n + 1), i + 1)]
        return sum(trs) / len(trs) if trs else float("nan")

    def relv(i, n=20):
        if i < 1:
            return float("nan")
        w = vols[max(0, i - n):i]
        a = sum(w) / len(w) if w else 0
        return vols[i] / a if a else float("nan")

    return closes, highs, lows, vwap, rsi, atr, relv


def _state(i, side, lv, closes, highs, lows, vwap, rsi, atr, relv):
    """The coach state at bar ``i`` for a would-be ``side`` entry — the SAME
    rule engine as coach_pine (WARN reserved for wrong-side/extended/knife;
    front-run is a WAIT)."""
    c = closes[i]
    vw = vwap[i]
    r = rsi(i)
    a = atr(i)
    rv = relv(i)
    tol = c * 0.05 / 100
    near = min(lv, key=lambda x: abs(c - x[0])) if lv else None
    if not near:
        return "WAIT", "no levels", {}
    npx, nlb, nro = near
    dist = abs(c - npx)
    at = dist <= tol
    nearby = dist <= tol * 3 and not at
    volOK = not math.isnan(rv) and rv >= 1.0
    vwGap = (c - vw) / a if a and not math.isnan(a) else float("nan")
    crossedUp = lows[i] <= npx + tol and c > npx
    crossedDown = highs[i] >= npx - tol and c < npx

    wrong = (at and nro in ("callwall", "resistance") and c > npx and side == "long") or \
            (at and nro in ("putwall", "support") and c < npx and side == "short")
    frontRun = nearby and not crossedUp and not crossedDown
    chase = (not math.isnan(vwGap) and vwGap >= 2.0 and r >= 68 and side == "long") or \
            (not math.isnan(vwGap) and vwGap <= -2.0 and r <= 32 and side == "short")
    knife = at and nro in ("support", "putwall") and c < vw and not volOK and (i > 0 and c < closes[i - 1])
    clean = (crossedUp and nro in ("support", "putwall", "flip") and volOK and side == "long") or \
            (crossedDown and nro in ("resistance", "callwall") and volOK and side == "short")

    warn = wrong or chase or knife
    reason = ("wrong-side" if wrong else "extended-chase" if chase else "knife" if knife
              else "front-run — wait for the tag" if frontRun else "clean tag+reclaim" if clean
              else f"at {nlb}" if at else "no tag")
    st = "WARN" if warn else "ENTER" if clean else "WAIT"
    detail = {
        "near_level": round(npx, 1), "near_role": nro, "near_label": nlb,
        "dist_pt": round(dist, 1),
        "vwap_gap_atr": None if math.isnan(vwGap) else round(vwGap, 1),
        "rsi": None if math.isnan(r) else round(r),
        "rel_vol": None if math.isnan(rv) else round(rv, 2),
    }
    return st, reason, detail


def backtest(store, day: str, underlying: str = "SPX") -> dict:
    """Replay the coach against ``day``'s ``underlying`` trades. Returns per-
    trade coach states + a tally of whether WARN aligned with losses."""
    sess = _sa.session(store, day, underlying)
    row = store.load_spx_playbook_before(day, symbol=underlying) \
        or store.load_spx_playbook(day, symbol=underlying)
    scaf = (row or {}).get("scaffold") or {}
    levels = _rp.gex_level_entries(scaf)
    lv = [(p, label, _cp._classify(label)) for p, label in levels]

    bars = _sa._intraday_bars("^GSPC" if underlying == "SPX" else underlying, day)
    if bars is None or getattr(bars, "empty", True) or not lv:
        return {"available": False, "day": day, "underlying": underlying,
                "note": "no bars or no baked levels for the coach to replay"}
    closes, highs, lows, vwap, rsi, atr, relv = _indicators(bars)

    def _bar_at(ts):
        t = _sa.to_et(ts)
        if t is None:
            return None
        idx = None
        for i in range(len(bars)):
            if bars.index[i] <= t:
                idx = i
        return idx

    rows = []
    for t in sess.get("trades", []):
        if t.get("ticker") != underlying or not t.get("opened_at"):
            continue
        side = "long" if "call" in t["label"] else "short"
        ei = _bar_at(t.get("opened_at"))
        if ei is None:
            continue
        st, why, detail = _state(ei, side, lv, closes, highs, lows, vwap, rsi, atr, relv)
        rows.append({
            "time": t.get("opened_et"), "label": t["label"], "side": side,
            "realized": t.get("realized"), "coach": st, "why": why, **detail,
        })

    def _pnl(g):
        return round(sum((r["realized"] or 0) for r in g), 2)

    warns = [r for r in rows if r["coach"] == "WARN"]
    enters = [r for r in rows if r["coach"] == "ENTER"]
    waits = [r for r in rows if r["coach"] == "WAIT"]
    saved = round(sum(r["realized"] for r in warns
                      if (r["realized"] or 0) < 0), 2)
    return {
        "available": True, "day": day, "underlying": underlying,
        "levels_from": (row or {}).get("session"),
        "baked_levels": [{"price": round(p), "role": r} for p, _l, r in lv],
        "trades": rows,
        "tally": {
            "warn_count": len(warns), "warn_pnl": _pnl(warns),
            "enter_count": len(enters), "enter_pnl": _pnl(enters),
            "wait_count": len(waits), "wait_pnl": _pnl(waits),
            "losses_on_warn": saved,   # what heeding WARN would have avoided
        },
        "caveat": ("Approximation of the live coach — VWAP/RSI seeding differs "
                   "from TradingView, early-session RSI has < 14 prior bars. "
                   "Clear cases are robust; borderline WARN/WAIT can flip."),
    }
