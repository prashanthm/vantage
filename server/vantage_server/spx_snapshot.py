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
from . import ict_htf as _htf
from . import reclaim_pine as _rp


def _resample_hourly(ts, op, hi, lo, cl, upto):
    """1m OHLC → HOURLY OHLC arrays over [0..upto], for the ict_htf detectors
    (which were validated on hourly bars). Buckets by top-of-hour wall clock.
    Returns (h_op, h_hi, h_lo, h_cl, last_hour_str) — the arrays plus the ET
    'HH:MM' of the last (current) hourly bucket for the hour-of-day modifier."""
    import datetime as _d
    h_op, h_hi, h_lo, h_cl = [], [], [], []
    key = None
    for k in range(upto + 1):
        t = _d.datetime.fromisoformat(ts[k])
        bkey = t.replace(minute=0, second=0, microsecond=0)
        if key is None or bkey != key:
            key = bkey
            h_op.append(op[k]); h_hi.append(hi[k]); h_lo.append(lo[k]); h_cl.append(cl[k])
        else:
            h_hi[-1] = max(h_hi[-1], hi[k])
            h_lo[-1] = min(h_lo[-1], lo[k])
            h_cl[-1] = cl[k]
    last_hour = _d.datetime.fromisoformat(ts[upto]).strftime("%H:%M")
    return h_op, h_hi, h_lo, h_cl, last_hour


def _resample_5m(ts, op, hi, lo, cl, vol, upto):
    """1m OHLC → 5m candles up to `upto`, as Lightweight-Charts rows
    {time (unix sec), open, high, low, close}. Buckets by 5-min wall clock."""
    import datetime as _d
    out, bucket = [], None
    for k in range(upto + 1):
        t = _d.datetime.fromisoformat(ts[k])
        floor_min = (t.minute // 5) * 5
        key = t.replace(minute=floor_min, second=0, microsecond=0)
        if bucket is None or bucket["key"] != key:
            if bucket is not None:
                out.append(bucket["row"])
            bucket = {"key": key, "row": {
                "time": int(key.timestamp()), "open": op[k], "high": hi[k],
                "low": lo[k], "close": cl[k]}}
        else:
            r = bucket["row"]
            r["high"] = max(r["high"], hi[k])
            r["low"] = min(r["low"], lo[k])
            r["close"] = cl[k]
    if bucket is not None:
        out.append(bucket["row"])
    for r in out:
        for kk in ("open", "high", "low", "close"):
            r[kk] = round(r[kk], 2)
    return out


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


def build_snapshot(store, day: str, symbol: str = "SPX", as_of: str | None = None,
                   history_days: int = 10) -> dict | None:
    """The snapshot dict for (day, symbol) up to ``as_of`` (ISO time; default the
    last stored bar). Loads the last ``history_days`` stored sessions as ONE
    continuous series so the chart shows multi-day history and the ICT engine
    finds prior-day liquidity pools / order blocks / FVGs. Session-scoped
    technicals (VWAP/RSI/session hi-lo) are computed from the current day only.
    None when there are no stored 1m bars for the day."""
    bar_sym = "^GSPC" if symbol == "SPX" else symbol
    # multi-day continuous series (chart span + ICT scan)
    ohlc = store.load_intraday_bars_range(bar_sym, day, "1m", days=history_days)
    if not ohlc or not ohlc.get("ts"):
        ohlc = store.load_intraday_bars(bar_sym, day, "1m")  # single-day fallback
    if not ohlc or not ohlc.get("ts"):
        return None
    ts = ohlc["ts"]
    op, hi, lo, cl = ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"]
    vol = ohlc.get("volume") or [0] * len(ts)
    day_bounds = ohlc.get("day_bounds") or {}

    # resolve the as-of bar index (in the concatenated array)
    ei = len(ts) - 1
    if as_of:
        ei = 0
        for k, t in enumerate(ts):
            if t <= as_of:
                ei = k

    # start index of the CURRENT session (for session-scoped technicals). If we
    # only have the fallback single day, that's index 0.
    si = day_bounds.get(day, 0)
    if si > ei:
        si = 0

    price = cl[ei]

    # the coach's playbook levels (the same confluence ladder the coach bakes)
    row = (store.load_spx_playbook_before(day, symbol=symbol)
           or store.load_spx_playbook(day, symbol=symbol))
    scaf = (row or {}).get("scaffold") or {}
    lvl_entries = _rp.gex_level_entries(scaf)     # (price, label) high→low
    levels = [{"price": round(float(p), 1), "label": _rp._clean_label(lbl)}
              for p, lbl in lvl_entries]
    lvl_prices = [x["price"] for x in levels]

    # VWAP/RSI/rel-vol/ATR are the current SESSION's tape (from si..ei)
    s_op, s_hi, s_lo, s_cl, s_vol = op[si:], hi[si:], lo[si:], cl[si:], vol[si:]
    s_ei = ei - si
    vwap, rsi, relv, a = _vwap_rsi(s_op, s_hi, s_lo, s_cl, s_vol, s_ei)

    # ICT structures scan the FULL history up to the as-of bar, so prior-day
    # liquidity pools / order blocks / FVGs surface (the whole point).
    hi_e, lo_e, cl_e, op_e = hi[:ei + 1], lo[:ei + 1], cl[:ei + 1], op[:ei + 1]
    liq = ict.unswept_liquidity(hi_e, lo_e)
    obs = ict.active_obs(hi_e, lo_e, cl_e, op_e)
    fvgs = ict.fresh_fvgs(hi_e, lo_e)
    draw = ict.draw_from_levels(price, lvl_prices)

    # HOURLY ICT layer — the backtest-validated swing signals (ict-concepts-edge).
    # Resample the same history to hourly and detect the tiered heads-up setup
    # (confluence stack / disp-gated FVG-reaction). This is the "hourly setup
    # present → drop to a lower timeframe for entry" signal, NOT an auto-entry.
    try:
        h_op, h_hi, h_lo, h_cl, last_hour = _resample_hourly(ts, op, hi, lo, cl, ei)
        ict_htf = _htf.htf_setup(h_hi, h_lo, h_cl, h_op, last_hour, active_obs=obs)
    except Exception:  # never let the heads-up break the snapshot
        ict_htf = {"present": False}

    # session shape — current day only
    sess_hi = max(s_hi[:s_ei + 1])
    sess_lo = min(s_lo[:s_ei + 1])
    opening = s_cl[0]

    # the chart shows the whole loaded history up to as_of
    bars_5m = _resample_5m(ts, op, hi, lo, cl, vol, ei)

    return {
        "symbol": symbol, "day": day, "as_of": ts[ei], "bar": ei + 1,
        "price": round(price, 2),
        "history_days": len(day_bounds) or 1,
        "bars_5m": bars_5m,   # Lightweight-Charts candles for the chart view
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
        "ict_htf": ict_htf,   # backtest-validated hourly heads-up (drop to LTF)
    }


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _first_price(v):
    """First price-shaped number in a value — the analyst emits prose targets
    ("Sweep 7504.0 SSL, then reclaim to 7529.4"), not bare numbers."""
    if v is None:
        return None
    n = _num(v)
    if n is not None:
        return n
    import re
    m = re.search(r"\d{2,6}(?:\.\d+)?", str(v))
    return float(m.group(0)) if m else None


def score_forecast(store, forecast_row: dict) -> dict | None:
    """Grade a persisted forecast against the elapsed price AFTER its as_of.

    Uses the forecast's structured fields when present ({bias, target,
    invalidation}); reads the day's 1m bars past as_of and checks: was the target
    reached before the invalidation? did price go the called direction? Returns a
    score dict, or None if there are no post-as_of bars yet (too early to score)."""
    day = forecast_row.get("day")
    sym = forecast_row.get("symbol") or "SPX"
    as_of = forecast_row.get("as_of")
    bar_sym = "^GSPC" if sym == "SPX" else sym
    # load the forecast day AND every session after it — a forecast made near the
    # close has no same-day bars after it, but the NEXT session still tests it.
    ohlc = (store.load_intraday_bars_since(bar_sym, day, "1m")
            or store.load_intraday_bars(bar_sym, day, "1m"))
    if not ohlc or not ohlc.get("ts") or not as_of:
        return None
    ts, hi, lo, cl = ohlc["ts"], ohlc["high"], ohlc["low"], ohlc["close"]
    # bars strictly AFTER as_of (now spanning subsequent sessions too)
    fut = [k for k, t in enumerate(ts) if t > as_of]
    if not fut:
        return None
    price_at = _num(forecast_row.get("price_at"))
    fc = forecast_row.get("forecast") or {}
    # pull bias/target/invalidation from the structured forecast (best-effort —
    # the analyst emits them via the A2UI keyvals; also accept top-level keys)
    bias = str(fc.get("bias") or _dig(fc, "bias") or "").lower()
    target = _first_price(fc.get("target") or _dig(fc, "target", skip=("upside", "wrong", "if ")))
    invalid = _first_price(fc.get("invalidation") or _dig(fc, "invalidation"))

    fut_hi = max(hi[k] for k in fut)
    fut_lo = min(lo[k] for k in fut)
    last = cl[fut[-1]]
    moved = round(last - price_at, 1) if price_at is not None else None

    # DIRECTION-AWARE reach: a target ABOVE the entry is reached when price rises
    # to it (high >= target); a target BELOW when price falls to it (low <= target).
    # This is keyed off where the level sits relative to the price at forecast
    # time — so a "down, target 7530" call isn't falsely "hit" by an up move.
    def _reached(level, k=None):
        if level is None or price_at is None:
            return False
        h = hi[k] if k is not None else fut_hi
        l = lo[k] if k is not None else fut_lo
        return (h >= level) if level >= price_at else (l <= level)

    hit_target = target is not None and _reached(target)
    hit_invalid = invalid is not None and _reached(invalid)
    first = None
    if target is not None or invalid is not None:
        for k in fut:
            if target is not None and _reached(target, k) and first is None:
                first = "target"
            if invalid is not None and _reached(invalid, k) and first is None:
                first = "invalidation"
            if first:
                break

    direction_ok = None
    if bias in ("up", "down") and price_at is not None:
        direction_ok = (bias == "up" and last > price_at) or (bias == "down" and last < price_at)

    if first == "target":
        verdict = "hit target"
    elif first == "invalidation":
        verdict = "invalidated"
    elif direction_ok is True:
        verdict = "direction correct"
    elif direction_ok is False:
        verdict = "direction wrong"
    else:
        verdict = "inconclusive"

    return {
        "verdict": verdict,
        "hit_target": hit_target, "hit_invalidation": hit_invalid,
        "first_touched": first, "direction_ok": direction_ok,
        "moved_pt": moved, "post_high": round(fut_hi, 1), "post_low": round(fut_lo, 1),
        "bars_elapsed": len(fut),
    }


def _dig(fc, key, skip=()):
    """Find `key` in the A2UI forecast JSON (top-level, or a keyvals row). Rows
    whose key contains any `skip` token are ignored (e.g. the "if wrong" upside
    target)."""
    if not isinstance(fc, dict):
        return None
    for sec in fc.get("sections") or []:
        for r in (sec.get("rows") or []):
            k = str(r.get("k") or "").lower()
            if key in k and not any(s in k for s in skip):
                return r.get("v")
    return None
