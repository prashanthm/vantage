"""The full DNA of a trade — everything Vantage KNOWS about one decision,
assembled as pure structured data for the Mira trade-analyst to read.

This is step 1 of a two-step flow (the operator's design): Vantage owns the
DATA (price action, volume, technicals, level correlation, forecast context);
Mira's trade-analyst agent owns the JUDGMENT (news, sentiment, the DNA read).
No LLM here — deterministic assembly only.

RESOLUTION follows the trade's timeframe (the operator's rule): a 0DTE lives
and dies in minutes, so its DNA is MINUTE-by-minute around entry and exit; a
swing trade spans days, where minute noise is meaningless, so it uses 15m
bars. yfinance serves 1m only ~30 days back — older 0DTEs fall back to 15m
with the coarseness LABELLED, never silently.

THE WINDOW: ±N bars around each fill (default 5), so the analyst can judge the
QUALITY of the entry and exit — did you buy into strength or catch a falling
knife; did you sell into a spike or give back the move. Volume travels with
every bar (was the move real participation or drift). Technicals (VWAP, ATR,
RSI, relative volume) are computed at the moment of each fill.
"""
from __future__ import annotations

import datetime as _dt
import logging

from . import technicals as _ta

log = logging.getLogger(__name__)

#: Bars of context on each side of a fill.
WINDOW = 5


def _is_zero_dte(trade: dict, day: str) -> bool:
    """A 0DTE trade expires the day it was opened — minute resolution. Anything
    dated further out is a swing (15m). A trade with no option legs (equity)
    is treated by hold time: < 1 day → intraday (minute), else swing."""
    exps = {l.get("expiration") for l in trade.get("legs", []) if l.get("expiration")}
    if exps:
        return min(exps) <= day
    # equity: intraday if opened and closed the same session
    o = str(trade.get("opened_at") or "")[:10]
    c = str(trade.get("closed_at") or o)[:10]
    return o == c


def _fetch_bars(symbol: str, day: str, interval: str):
    """RTH bars for ``day`` at ``interval`` ("1m"|"15m"), ET-indexed. Returns
    (dataframe_or_None, actual_interval) — actual may differ from requested
    when 1m is unavailable (yfinance ~30-day cap) and we fall back to 15m."""
    import yfinance as yf
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")

    def _pull(iv):
        nxt = (_dt.date.fromisoformat(day) + _dt.timedelta(1)).isoformat()
        h = yf.Ticker(symbol).history(start=day, end=nxt, interval=iv)
        if h.empty:
            return None
        if h.index.tz is None:
            h.index = h.index.tz_localize("UTC")
        h.index = h.index.tz_convert(ET)
        mins = h.index.hour * 60 + h.index.minute
        h = h[(mins >= 9 * 60 + 30) & (mins < 16 * 60)]
        return h if not h.empty else None

    try:
        if interval == "1m":
            h = _pull("1m")
            if h is not None:
                return h, "1m"
            log.info("1m bars unavailable for %s %s — coarser 15m", symbol, day)
        h = _pull("15m")
        return (h, "15m") if h is not None else (None, interval)
    except Exception as e:
        log.warning("DNA bars unavailable %s %s: %s", symbol, day, e)
        return None, interval


def _window_around(bars, when_et, n: int = WINDOW) -> list[dict]:
    """The ``n`` bars before and after the fill timestamp, each as
    {time, open, high, low, close, volume, mark} — mark tags the fill bar."""
    if bars is None or getattr(bars, "empty", True) or when_et is None:
        return []
    idxs = list(range(len(bars)))
    # the bar covering the fill = last bar at/onbefore the timestamp
    pos = None
    for i in idxs:
        if bars.index[i] <= when_et:
            pos = i
    if pos is None:
        pos = 0
    lo, hi = max(0, pos - n), min(len(bars), pos + n + 1)
    out = []
    for i in range(lo, hi):
        row = bars.iloc[i]
        out.append({
            "time": str(bars.index[i])[11:16],
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            "at_fill": i == pos,
        })
    return out


def _technicals_at(bars, pos_time_et) -> dict:
    """VWAP, ATR, RSI, and relative volume as of the fill bar — the tape
    state the decision was taken into."""
    if bars is None or getattr(bars, "empty", True) or pos_time_et is None:
        return {}
    upto = bars[bars.index <= pos_time_et]
    if upto.empty:
        return {}
    closes = [float(c) for c in upto["Close"]]
    vols = [float(v) for v in upto["Volume"] if v == v]
    # session VWAP to the fill
    tp = ((upto["High"] + upto["Low"] + upto["Close"]) / 3.0)
    vol = upto["Volume"].fillna(0)
    vwap = float((tp * vol).sum() / vol.sum()) if vol.sum() else None
    bars_list = [{"high": float(r["High"]), "low": float(r["Low"]),
                  "close": float(r["Close"])} for _, r in upto.iterrows()]
    trs = _ta._true_ranges(bars_list) if len(bars_list) > 1 else []
    atr = round(sum(trs[-14:]) / min(len(trs), 14), 2) if trs else None
    last_vol = vols[-1] if vols else None
    avg_vol = (sum(vols[-20:]) / min(len(vols), 20)) if vols else None
    rel_vol = round(last_vol / avg_vol, 2) if (last_vol and avg_vol) else None
    price = closes[-1]
    return {
        "price": round(price, 2),
        "vwap": round(vwap, 2) if vwap else None,
        "vs_vwap": round(price - vwap, 2) if vwap else None,
        "atr": atr,
        "rsi": _ta.rsi(closes) if len(closes) >= 15 else None,
        "rel_volume": rel_vol,
        "bars_into_session": len(upto),
    }


def _quality(window: list[dict], side_effect: str) -> dict | None:
    """A blunt read on the fill's quality from the ±window: was price rising
    or falling into the fill, and did it continue or reverse after. The
    analyst gets the numbers; this is the at-a-glance flag."""
    if not window:
        return None
    fill_i = next((i for i, b in enumerate(window) if b["at_fill"]), None)
    if fill_i is None:
        return None
    before = window[:fill_i]
    after = window[fill_i + 1:]
    fill_px = window[fill_i]["close"]
    pre_move = round(fill_px - before[0]["close"], 2) if before else None
    post_move = round(after[-1]["close"] - fill_px, 2) if after else None
    pre_vol = [b["volume"] for b in before]
    return {
        "pre_move": pre_move,          # SPX points in the 5 bars before the fill
        "post_move": post_move,        # ...and after
        "pre_avg_volume": round(sum(pre_vol) / len(pre_vol)) if pre_vol else None,
        "fill_volume": window[fill_i]["volume"],
    }


def build(store, day: str, trade: dict, forecast_levels: list[dict],
          gex_anchors: list[dict], underlying: str = "SPX") -> dict:
    """The full DNA of one trade. ``trade`` is a session_activity trade dict
    (already carries correlation/exit_correlation/spot_at_entry/exit)."""
    from . import session_activity as _sa
    sym = "^GSPC" if underlying == "SPX" else underlying
    zero_dte = _is_zero_dte(trade, day)
    want = "1m" if zero_dte else "15m"
    bars, got = _fetch_bars(sym, day, want)

    entry_et = _sa.to_et(trade.get("opened_at"))
    exit_et = _sa.to_et(trade.get("closed_at"))

    entry_window = _window_around(bars, entry_et)
    # an expired trade's "exit" is the settlement bell — window the close
    exit_window = _window_around(bars, exit_et) if exit_et else []

    return {
        "label": trade.get("label"),
        "strategy": trade.get("strategy"),
        "legs": trade.get("legs"),
        "status": trade.get("status"),
        "opened_at": trade.get("opened_at"),
        "closed_at": trade.get("closed_at"),
        "realized": trade.get("realized"),
        "cost": trade.get("cost"),
        "proceeds": trade.get("proceeds"),
        "settlement": trade.get("settlement"),
        # resolution honesty
        "timeframe": "0DTE" if zero_dte else "swing",
        "bar_interval": got,
        "coarse": bool(want == "1m" and got != "1m"),   # wanted 1m, got 15m
        # the price the decision keyed off + the forecast it correlated to
        "entry": {
            "spot": trade.get("spot_at_entry"),
            "correlation": trade.get("correlation"),
            "window": entry_window,
            "quality": _quality(entry_window, "open"),
            "technicals": _technicals_at(bars, entry_et),
        },
        "exit": {
            "spot": trade.get("spot_at_exit"),
            "correlation": trade.get("exit_correlation"),
            "window": exit_window,
            "quality": _quality(exit_window, "close"),
            "technicals": _technicals_at(bars, exit_et),
            "is_settlement": str(trade.get("status")).startswith("expired"),
        },
        # the plan the trade was taken against
        "forecast_levels": forecast_levels,
        "gex_anchors": gex_anchors,
        "underlying": underlying,
        "day": day,
    }
