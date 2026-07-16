"""SPX intraday SNAPSHOT — a chart-centric view of the session so far, the payload
the spx_analyst reasons over to answer "what will price do?".

Assembles, for a day up to an as-of time (default: latest bar in the stored 1m
series): current price + the coach's playbook levels + live technicals
(VWAP/RSI/rel-vol/ATR) + the ICT structures (unswept liquidity, active order
blocks, fresh FVGs, the draw). Reads the PERSISTED 1m bars (seed_intraday /
DNA-path capture) so it works even after yfinance drops the session.
"""
from __future__ import annotations

from . import ict
from . import reclaim_pine as _rp


def _vwap_rsi(op, hi, lo, cl, vol, upto):
    """Session VWAP, RSI(14), rel-volume, ATR at bar ``upto`` — the coach's tape."""
    # VWAP (session, hlc3)
    pv = v = 0.0
    for k in range(upto + 1):
        tp = (hi[k] + lo[k] + cl[k]) / 3
        pv += tp * (vol[k] or 0)
        v += (vol[k] or 0)
    vwap = pv / v if v else None
    # RSI(14) Wilder
    rsi = None
    if upto >= 14:
        gains = losses = 0.0
        for k in range(upto - 13, upto + 1):
            ch = cl[k] - cl[k - 1]
            gains += max(ch, 0)
            losses += max(-ch, 0)
        if losses == 0:
            rsi = 100.0
        else:
            rs = (gains / 14) / (losses / 14)
            rsi = 100 - 100 / (1 + rs)
    # rel-volume vs the trailing 20-bar mean
    relv = None
    if upto >= 20:
        base = sum(vol[upto - 20:upto]) / 20
        relv = (vol[upto] / base) if base else None
    a = ict.atr(hi, lo, cl, upto, 14)
    return vwap, rsi, relv, a


def build_snapshot(store, day: str, symbol: str = "SPX", as_of: str | None = None) -> dict | None:
    """The snapshot dict for (day, symbol) up to ``as_of`` (ISO time; default the
    last stored bar). None when there are no stored 1m bars for the day."""
    bar_sym = "^GSPC" if symbol == "SPX" else symbol
    ohlc = store.load_intraday_bars(bar_sym, day, "1m")
    if not ohlc or not ohlc.get("ts"):
        return None
    ts = ohlc["ts"]
    op, hi, lo, cl = ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"]
    vol = ohlc.get("volume") or [0] * len(ts)

    # resolve the as-of bar index
    ei = len(ts) - 1
    if as_of:
        ei = 0
        for k, t in enumerate(ts):
            if t <= as_of:
                ei = k

    price = cl[ei]

    # the coach's playbook levels (the same confluence ladder the coach bakes)
    row = (store.load_spx_playbook_before(day, symbol=symbol)
           or store.load_spx_playbook(day, symbol=symbol))
    scaf = (row or {}).get("scaffold") or {}
    lvl_entries = _rp.gex_level_entries(scaf)     # (price, label) high→low
    levels = [{"price": round(float(p), 1), "label": _rp._clean_label(lbl)}
              for p, lbl in lvl_entries]
    lvl_prices = [x["price"] for x in levels]

    vwap, rsi, relv, a = _vwap_rsi(op, hi, lo, cl, vol, ei)

    # ICT structures up to the as-of bar
    hi_e, lo_e, cl_e, op_e = hi[:ei + 1], lo[:ei + 1], cl[:ei + 1], op[:ei + 1]
    liq = ict.unswept_liquidity(hi_e, lo_e)
    obs = ict.active_obs(hi_e, lo_e, cl_e, op_e)
    fvgs = ict.fresh_fvgs(hi_e, lo_e)
    draw = ict.draw_from_levels(price, lvl_prices)

    # session shape
    sess_hi = max(hi[:ei + 1])
    sess_lo = min(lo[:ei + 1])
    opening = cl[0]

    return {
        "symbol": symbol, "day": day, "as_of": ts[ei], "bar": ei + 1,
        "price": round(price, 2),
        "session": {"open": round(opening, 2), "high": round(sess_hi, 2),
                    "low": round(sess_lo, 2), "from_open_pt": round(price - opening, 1)},
        "technicals": {
            "vwap": round(vwap, 1) if vwap else None,
            "vs_vwap_pt": round(price - vwap, 1) if vwap else None,
            "rsi": round(rsi) if rsi is not None else None,
            "rel_volume": round(relv, 2) if relv else None,
            "atr": round(a, 1),
        },
        "levels": levels,
        "regime": {"gamma": (scaf.get("regime") or {}).get("gamma"),
                   "vwap_regime": (scaf.get("regime") or {}).get("vwap_regime")},
        "ict": {
            "unswept_liquidity": liq,          # {bsl:[...], ssl:[...]}
            "active_order_blocks": obs,        # [{side, top, bottom}]
            "fresh_fvgs": [{"side": f["side"], "lo": round(f["lo"], 1),
                            "hi": round(f["hi"], 1)} for f in fvgs][:8],
            "draw": draw,                      # the validated level-based magnet
        },
    }
