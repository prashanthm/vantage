"""Multi-timeframe chart candles for ANY symbol — the data behind the chart-first UI.

Returns Lightweight-Charts candle rows ({time (unix sec), open, high, low, close,
volume?}) for a symbol at a requested timeframe, sourced from what's already stored:

  - 1m / 5m / 15m : the stored 1m intraday bars, resampled (1m used verbatim).
  - 1H            : the stored 60m intraday bars (the scanner seeds these broadly).
  - 1D            : the daily `bars` table (load_bars).

Pure, deterministic, read-only — no network, no LLM. The resampler buckets by wall
clock in the bar's own tz (the stored ts carry ET), so DST is handled by the data.
"""
from __future__ import annotations

import datetime as _dt

#: supported timeframes → (source interval, bucket minutes | None for pass-through/daily)
_TF = {
    "1m":  ("1m", 1),
    "5m":  ("1m", 5),
    "15m": ("1m", 15),
    "1H":  ("60m", None),   # stored 60m used verbatim
    "1D":  ("1D", None),    # from the daily bars table
}

TIMEFRAMES = tuple(_TF.keys())


def _to_candle(ts_iso: str, o, h, l, c, v=None) -> dict:
    row = {"time": int(_dt.datetime.fromisoformat(ts_iso).timestamp()),
           "open": round(float(o), 2), "high": round(float(h), 2),
           "low": round(float(l), 2), "close": round(float(c), 2)}
    if v is not None:
        row["volume"] = float(v)
    return row


def _resample(ohlc: dict, bucket_min: int) -> list[dict]:
    """Resample an intraday OHLC dict ({ts, open, high, low, close, volume}) into
    ``bucket_min``-minute LWC candles. bucket_min==1 passes 1m through as candles."""
    ts = ohlc.get("ts") or []
    if not ts:
        return []
    op, hi, lo, cl = ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"]
    vol = ohlc.get("volume") or [0] * len(ts)
    out, bucket = [], None
    for k in range(len(ts)):
        t = _dt.datetime.fromisoformat(ts[k])
        floor_min = (t.minute // bucket_min) * bucket_min if bucket_min > 1 else t.minute
        key = t.replace(minute=floor_min, second=0, microsecond=0)
        if bucket is None or bucket["key"] != key:
            if bucket is not None:
                out.append(bucket["row"])
            bucket = {"key": key, "row": {
                "time": int(key.timestamp()), "open": float(op[k]), "high": float(hi[k]),
                "low": float(lo[k]), "close": float(cl[k]), "volume": float(vol[k] or 0)}}
        else:
            r = bucket["row"]
            r["high"] = max(r["high"], float(hi[k]))
            r["low"] = min(r["low"], float(lo[k]))
            r["close"] = float(cl[k])
            r["volume"] += float(vol[k] or 0)
    if bucket is not None:
        out.append(bucket["row"])
    for r in out:
        for kk in ("open", "high", "low", "close"):
            r[kk] = round(r[kk], 2)
    return out


def _bar_sym(symbol: str) -> str:
    return "^GSPC" if (symbol or "").upper() == "SPX" else (symbol or "").upper()


def chart_candles(store, symbol: str, tf: str = "5m", days: int = 15) -> dict:
    """Candles for (symbol, tf). Returns {symbol, tf, candles:[...], available, note?}.
    Intraday tfs concatenate the last ``days`` stored sessions; 1D reads the daily
    table. ``available`` is False (with a note) when no bars are stored for the tf."""
    tf = tf if tf in _TF else "5m"
    src, bucket = _TF[tf]
    sym = _bar_sym(symbol)

    if tf == "1D":
        b = store.load_bars(sym) if hasattr(store, "load_bars") else None
        daily = (b or {}).get("daily") or []
        candles = [_to_candle(f"{d['date']}T00:00:00+00:00", d["open"], d["high"],
                              d["low"], d["close"]) for d in daily if d.get("date")]
        if not candles:
            return {"symbol": symbol, "tf": tf, "available": False, "candles": [],
                    "note": f"no daily bars for {symbol}"}
        return {"symbol": symbol, "tf": tf, "available": True, "candles": candles}

    # intraday: concatenate the last `days` stored sessions of the source interval.
    # 1H prefers stored 60m; if a symbol only has 1m (e.g. SPX from the forecast
    # seed, no 60m), fall back to resampling 1m → 60m so every intraday symbol has 1H.
    def _load(interval: str):
        latest = (store.latest_intraday_day(sym, interval)
                  if hasattr(store, "latest_intraday_day") else None)
        if not latest:
            return None
        o = store.load_intraday_bars_range(sym, latest, interval, days=days)
        return o if (o and o.get("ts")) else store.load_intraday_bars(sym, latest, interval)

    ohlc = _load(src)
    if (not ohlc or not ohlc.get("ts")) and tf == "1H":
        ohlc = _load("1m")       # 1H fallback: resample from 1m
    if not ohlc or not ohlc.get("ts"):
        return {"symbol": symbol, "tf": tf, "available": False, "candles": [],
                "note": f"no bars stored for {symbol} at {tf} — prime it first"}
    candles = _resample(ohlc, 60 if bucket is None else bucket)
    return {"symbol": symbol, "tf": tf, "available": True, "candles": candles}
