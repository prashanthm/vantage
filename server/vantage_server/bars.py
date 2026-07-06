"""OHLCV bar resampling + the EOD snapshot orchestrator.

The pure part is ``resample``: daily bars -> calendar-week / calendar-month
OHLCV aggregation (open=first, high=max, low=min, close=last, volume=sum),
deterministic and I/O-free. ``snapshot_bars`` is the orchestration layer — it
fetches daily bars from the broker (the only I/O, injected as a callable so it
stays testable) and derives weekly/monthly from them via ``resample``.

Bar contract everywhere here: [{date (ISO), open, high, low, close (floats),
volume (int)}], oldest -> newest — the shape robinhood.fetch_historicals
returns.
"""
from __future__ import annotations

import datetime as _dt

Bar = dict


class BarsError(ValueError):
    """A bar series is malformed or an unsupported timeframe was requested."""


def _parse_date(value: str) -> _dt.date:
    """ISO timestamp (date or datetime, with or without trailing Z) -> date."""
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _dt.datetime.fromisoformat(text).date()
    except ValueError:
        # bare date like "2026-06-08"
        return _dt.date.fromisoformat(text[:10])


def _period_key(day: _dt.date, timeframe: str) -> tuple:
    """A comparable, sortable bucket key for the calendar period ``day`` falls
    in. Weekly buckets on the ISO week (year, week); monthly on (year, month).
    The key is used only for grouping — the emitted bar's date is the FIRST
    trading day actually seen in the bucket, not a synthetic period start."""
    if timeframe == "week":
        iso = day.isocalendar()
        return (iso[0], iso[1])
    if timeframe == "month":
        return (day.year, day.month)
    raise BarsError(f"unsupported timeframe {timeframe!r} (want 'week' or 'month')")


def resample(daily_bars: list[Bar], timeframe: str) -> list[Bar]:
    """Aggregate daily OHLCV bars into calendar-week or calendar-month bars.

    open = first day's open, high = max high, low = min low, close = last
    day's close, volume = sum. Input MUST be oldest -> newest (as
    fetch_historicals returns); output preserves that order, one bar per
    period, dated the first trading day of the period. Pure and deterministic.
    """
    if timeframe not in ("week", "month"):
        raise BarsError(f"unsupported timeframe {timeframe!r} (want 'week' or 'month')")
    buckets: dict[tuple, dict] = {}
    order: list[tuple] = []
    for bar in daily_bars:
        day = _parse_date(bar["date"])
        key = _period_key(day, timeframe)
        agg = buckets.get(key)
        if agg is None:
            buckets[key] = {
                "date": bar["date"],
                "open": float(bar["open"]),
                "high": float(bar["high"]),
                "low": float(bar["low"]),
                "close": float(bar["close"]),
                "volume": int(bar["volume"]),
            }
            order.append(key)
        else:
            agg["high"] = max(agg["high"], float(bar["high"]))
            agg["low"] = min(agg["low"], float(bar["low"]))
            agg["close"] = float(bar["close"])
            agg["volume"] += int(bar["volume"])
    return [buckets[k] for k in order]


def snapshot_bars(
    symbols: list[str],
    *,
    today: _dt.date,
    lookback_days: int = 400,
    fetch=None,
) -> dict[str, dict[str, list[Bar]]]:
    """Fetch daily bars for each symbol and derive weekly + monthly.

    Returns {symbol: {"daily": [...], "weekly": [...], "monthly": [...]}}.

    ``fetch`` is the I/O boundary — a callable
    ``fetch(symbol, *, start_time, interval="day") -> [normalized bars]``
    (robinhood.fetch_historicals by default, injected in tests). ``lookback_days``
    sets start_time = today - lookback_days at 00:00:00Z; 400 days gives enough
    daily bars for a 200-bar MA and ~13 monthly / ~57 weekly buckets.
    """
    if fetch is None:
        from .brokers import robinhood

        fetch = robinhood.fetch_historicals
    start = today - _dt.timedelta(days=lookback_days)
    start_time = f"{start.isoformat()}T00:00:00Z"
    out: dict[str, dict[str, list[Bar]]] = {}
    for symbol in symbols:
        sym = symbol.upper()
        daily = fetch(sym, start_time=start_time, interval="day")
        out[sym] = {
            "daily": daily,
            "weekly": resample(daily, "week"),
            "monthly": resample(daily, "month"),
        }
    return out
