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
#: timeframe → (source, bucketing). Source is where bars come from; bucketing is how
#: raw bars aggregate into the candle. Intraday tfs derive from 1m/60m; the higher
#: tfs (1D/1W/1M) derive from the daily bars table (W/M by calendar). "min:N" = floor
#: to N-minute buckets; "hour:N" = floor to N-hour buckets (4h); "week"/"month" =
#: calendar buckets.
_TF = {
    "1m":  ("1m",  "min:1"),
    "5m":  ("1m",  "min:5"),
    "15m": ("1m",  "min:15"),
    "1H":  ("60m", "min:60"),   # stored 60m; verbatim after floor
    "4H":  ("60m", "hour:4"),   # 60m bars aggregated into 4-hour buckets
    "1D":  ("1D",  "day"),      # daily bars, one candle each
    "1W":  ("1D",  "week"),     # daily → weekly (ISO week)
    "1M":  ("1D",  "month"),    # daily → monthly (calendar month)
}

TIMEFRAMES = tuple(_TF.keys())


def _to_candle(ts_iso: str, o, h, l, c, v=None) -> dict:
    row = {"time": int(_dt.datetime.fromisoformat(ts_iso).timestamp()),
           "open": round(float(o), 2), "high": round(float(h), 2),
           "low": round(float(l), 2), "close": round(float(c), 2)}
    if v is not None:
        row["volume"] = float(v)
    return row


def _bucket_key(t: _dt.datetime, mode: str):
    """The bucket a timestamp falls in, for the given bucketing mode."""
    kind, _, n = mode.partition(":")
    if kind == "min":
        n = int(n)
        fm = (t.minute // n) * n if n > 1 else t.minute
        return t.replace(minute=fm, second=0, microsecond=0)
    if kind == "hour":
        n = int(n)
        fh = (t.hour // n) * n
        return t.replace(hour=fh, minute=0, second=0, microsecond=0)
    if kind == "day":
        return t.replace(hour=0, minute=0, second=0, microsecond=0)
    if kind == "week":
        iso = t.isocalendar()           # (year, week, weekday) — bucket by ISO week
        return (iso[0], iso[1])
    if kind == "month":
        return (t.year, t.month)
    return t


def _resample(rows: list[dict], mode: str) -> list[dict]:
    """Aggregate normalized rows ({ts_iso, open, high, low, close, volume}) into LWC
    candles by the bucketing ``mode`` (see _bucket_key). The candle's ``time`` is the
    bucket's first bar's start (calendar buckets use that bar's midnight/day)."""
    out, bucket = [], None
    for r in rows:
        t = _dt.datetime.fromisoformat(r["ts"])
        key = _bucket_key(t, mode)
        if bucket is None or bucket["key"] != key:
            if bucket is not None:
                out.append(bucket["row"])
            # anchor time: for min/hour/day the floored instant; for week/month the
            # first bar's own day (a stable, real trading date).
            anchor = key if isinstance(key, _dt.datetime) else t.replace(hour=0, minute=0, second=0, microsecond=0)
            bucket = {"key": key, "row": {
                "time": int(anchor.timestamp()), "open": float(r["open"]), "high": float(r["high"]),
                "low": float(r["low"]), "close": float(r["close"]), "volume": float(r.get("volume") or 0)}}
        else:
            row = bucket["row"]
            row["high"] = max(row["high"], float(r["high"]))
            row["low"] = min(row["low"], float(r["low"]))
            row["close"] = float(r["close"])
            row["volume"] += float(r.get("volume") or 0)
    if bucket is not None:
        out.append(bucket["row"])
    for r in out:
        for kk in ("open", "high", "low", "close"):
            r[kk] = round(r[kk], 2)
    return out


def _bar_sym(symbol: str) -> str:
    return "^GSPC" if (symbol or "").upper() == "SPX" else (symbol or "").upper()


def _rows_from_intraday(ohlc: dict) -> list[dict]:
    """intraday OHLC arrays → the common row shape."""
    ts = ohlc.get("ts") or []
    op, hi, lo, cl = ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"]
    vol = ohlc.get("volume") or [0] * len(ts)
    return [{"ts": ts[k], "open": op[k], "high": hi[k], "low": lo[k],
             "close": cl[k], "volume": vol[k] or 0} for k in range(len(ts))]


def _rows_from_daily(daily: list[dict]) -> list[dict]:
    """daily bars → the common row shape (date may be a bare day or a full ISO ts)."""
    return [{"ts": f"{str(d['date'])[:10]}T00:00:00+00:00", "open": d["open"],
             "high": d["high"], "low": d["low"], "close": d["close"], "volume": 0}
            for d in daily if d.get("date")]


def chart_candles(store, symbol: str, tf: str = "5m", days: int = 15) -> dict:
    """Candles for (symbol, tf). Returns {symbol, tf, candles:[...], available, note?}.
    Intraday tfs concatenate the last ``days`` stored sessions; 1D/1W/1M come from the
    daily table (weekly/monthly by calendar bucket); 4H aggregates 60m. ``available``
    is False (with a note) when no source bars exist for the tf."""
    tf = tf if tf in _TF else "5m"
    src, mode = _TF[tf]
    sym = _bar_sym(symbol)

    if src == "1D":
        b = store.load_bars(sym) if hasattr(store, "load_bars") else None
        daily = (b or {}).get("daily") or []
        if not daily:
            return {"symbol": symbol, "tf": tf, "available": False, "candles": [],
                    "note": f"no daily bars for {symbol}"}
        candles = _resample(_rows_from_daily(daily), mode)
        return {"symbol": symbol, "tf": tf, "available": True, "candles": candles}

    # intraday: concatenate the last `days` stored sessions of the source interval.
    # 1H/4H prefer stored 60m; if a symbol only has 1m (e.g. SPX from the forecast
    # seed, no 60m), fall back to resampling 1m so every intraday symbol has them.
    def _load(interval: str):
        latest = (store.latest_intraday_day(sym, interval)
                  if hasattr(store, "latest_intraday_day") else None)
        if not latest:
            return None
        o = store.load_intraday_bars_range(sym, latest, interval, days=days)
        return o if (o and o.get("ts")) else store.load_intraday_bars(sym, latest, interval)

    ohlc = _load(src)
    if (not ohlc or not ohlc.get("ts")) and src == "60m":
        ohlc = _load("1m")       # 1H/4H fallback: resample from 1m
    if not ohlc or not ohlc.get("ts"):
        return {"symbol": symbol, "tf": tf, "available": False, "candles": [],
                "note": f"no bars stored for {symbol} at {tf} — prime it first"}
    candles = _resample(_rows_from_intraday(ohlc), mode)
    return {"symbol": symbol, "tf": tf, "available": True, "candles": candles}
