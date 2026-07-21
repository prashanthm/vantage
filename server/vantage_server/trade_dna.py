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


def _trade_dir(trade: dict) -> int:
    """The trade's directional sign: +1 bullish (long calls), -1 bearish (long
    puts), 0 unknown. From the strategy string ('long_call' / 'long_put' / …)."""
    s = str(trade.get("strategy") or "").lower()
    if "call" in s and "put" not in s:
        return 1
    if "put" in s and "call" not in s:
        return -1
    return 0


def _ict_at_entry(store, day: str, underlying: str, entry_et, trade: dict) -> dict | None:
    """The ICT structure AS OF the trade's entry — reuses build_snapshot(as_of=…)
    so the liquidity / order-blocks / FVGs / draw / hourly ict_htf are exactly the
    validated computation, time-anchored to when the trade was taken (not now).
    Plus the deterministic flags the ict-coach / ict-concepts-edge goals validated:
    against_draw (entry side vs the level-draw), midday_entry (11-14 ET trap),
    htf_setup_aligned (trade dir vs the hourly ict_htf setup)."""
    if entry_et is None or not getattr(store, "uses_sqlite", False):
        return None
    try:
        from . import spx_snapshot as _snap
        as_of = entry_et.isoformat()
        snap = _snap.build_snapshot(store, day, symbol=underlying, as_of=as_of)
    except Exception as e:  # never let the ICT read break the DNA
        log.warning("DNA ict-at-entry failed for %s %s: %s", underlying, day, e)
        return None
    if not snap:
        return None
    ict = snap.get("ict") or {}
    htf = snap.get("ict_htf") or {}
    draw = ict.get("draw") or {}
    tdir = _trade_dir(trade)

    # against_draw: the draw is the nearer opposing level (validated magnet). A
    # trade taken AGAINST it (long while the draw pulls down, or vice-versa) is
    # the money leak (ict-coach H8: -$357 avg vs +$270 with-draw).
    against_draw = None
    if draw.get("dir") and tdir != 0:
        draw_sign = 1 if draw["dir"] == "up" else -1
        against_draw = (tdir != draw_sign)

    # midday_entry: 11:00-14:00 ET level-trap window (ict-coach H9: WR 0.17).
    midday_entry = 11 <= entry_et.hour < 14

    # htf_setup_aligned: was there a validated hourly setup, and on the SAME side?
    htf_setup_aligned = None
    if htf.get("present") and tdir != 0:
        setup_sign = 1 if htf.get("dir") == "long" else -1
        htf_setup_aligned = (tdir == setup_sign)

    return {
        "as_of": snap.get("as_of"),
        "price": snap.get("price"),
        "unswept_liquidity": ict.get("unswept_liquidity"),
        "active_order_blocks": ict.get("active_order_blocks"),
        "fresh_fvgs": ict.get("fresh_fvgs"),
        "draw": draw,                       # the validated level-based magnet
        "htf_setup": htf,                   # the hourly ict_htf {present,tier,dir,…}
        "flags": {                          # the validated deterministic reads
            "against_draw": against_draw,
            "midday_entry": midday_entry,
            "htf_setup_aligned": htf_setup_aligned,
        },
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
        # the fill ladder + its scale read — so the analyst can judge the
        # scale-in/out geometry, not just a single blended entry/exit
        "fills": trade.get("fills"),
        "scale": trade.get("scale"),
        "peak_contracts": trade.get("peak_contracts"),
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
        # the ICT structure AS OF entry (validated liquidity/OB/FVG/draw/hourly
        # setup) + the deterministic flags the goals validated — so Mira judges
        # the trade against the same structure the coach uses live.
        "ict": _ict_at_entry(store, day, underlying, entry_et, trade),
        # the day's news + sentiment lean for the underlying — market context
        # the tape alone doesn't carry (the analyst weighs it, cites it as an
        # ESTIMATED lean, never ground truth).
        "news": _news_for(store, underlying),
        "standing_forecast": _standing_forecast(store, day, underlying,
                                                trade.get("opened_at")),
        "underlying": underlying,
        "day": day,
    }


def _standing_forecast(store, day: str, underlying: str,
                       opened_at: str | None) -> dict | None:
    """The analyst forecast that was STANDING when this trade was entered —
    the newest captured forecast at-or-before the entry time. Lets the desk
    review judge alignment: did the operator trade with or against the
    forecast, and which of them read the tape right? None when the symbol has
    no forecasts (only SPX/QQQ/IWM are forecast) or none predate the entry."""
    import datetime as _dt
    import json as _json

    def _ts(x):
        try:
            t = _dt.datetime.fromisoformat(str(x))
            # history timestamps are UTC-naive; forecast as_of carries an
            # offset. Normalize naive → UTC so the comparison is valid.
            return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)
        except (TypeError, ValueError):
            return None

    o = _ts(opened_at)
    if o is None or not getattr(store, "uses_sqlite", False):
        return None
    try:
        rows = store.list_spx_forecasts(underlying.upper(), day, 50)
    except Exception:  # noqa: BLE001 — best-effort context, never blocks DNA
        return None
    for r in rows:                                   # newest first
        a = _ts(r.get("as_of"))
        if a is None or a > o:
            continue
        fc = r.get("forecast") or {}
        if isinstance(fc, str):
            try:
                fc = _json.loads(fc)
            except (ValueError, TypeError):
                fc = {}
        plot = (fc.get("plot") if isinstance(fc, dict) else None) or {}
        sc = r.get("score")
        if isinstance(sc, str):
            try:
                sc = _json.loads(sc)
            except (ValueError, TypeError):
                sc = None
        return {
            "as_of": r.get("as_of"),
            "price_at": r.get("price_at"),
            "bias": plot.get("bias"),
            "target": plot.get("target"),
            "invalidation": plot.get("invalidation"),
            "born_invalid": bool(plot.get("born_invalid")),
            "score_verdict": (sc or {}).get("verdict") if isinstance(sc, dict) else None,
            "age_min_at_entry": round((o - a).total_seconds() / 60),
        }
    return None


def _news_for(store, underlying: str) -> dict | None:
    """Recent news + sentiment for the underlying's tradeable proxy (SPY for
    SPX), compacted for the analyst. None on any failure — best-effort context,
    never blocks the DNA."""
    proxy = {"SPX": "SPY", "NDX": "QQQ", "RUT": "IWM"}.get(underlying.upper(),
                                                           underlying.upper())
    try:
        from . import news as _news
        data = _news.news(proxy, store.data_dir)
        if not data:
            return None
        items = (data.get("items") or [])[:5]
        return {
            "symbol": proxy,
            "sentiment": data.get("sentiment"),   # {score, band, estimated}
            "headlines": [{"title": i.get("title"), "publisher": i.get("publisher"),
                           "published": i.get("published")} for i in items],
        }
    except Exception as e:  # noqa: BLE001
        log.warning("news unavailable for %s: %s", proxy, e)
        return None
