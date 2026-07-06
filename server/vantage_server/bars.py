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


def trim_padding(daily_bars: list[Bar]) -> list[Bar]:
    """Drop leading pre-trading-history PADDING rows from a daily bar series.

    The broker's get_equity_historicals caps at ~2891 daily bars (~11yr). When
    the requested start_time predates a ticker's real trading history (e.g. a
    2015 start for PLTR, which IPO'd in 2020), the API back-fills the gap with
    DEGENERATE placeholder rows — zero volume and/or flat/zero OHLC — rather
    than omitting them. Those are not real bars and must not seed a chart or a
    volume profile, so we detect the real trading-history start and drop
    everything before it.

    HEURISTIC — walk from the oldest bar and drop a leading row while it looks
    like padding, stopping at the first REAL trading bar. A row is padding when
    ANY of:
      * volume <= 0 (no shares traded — a placeholder), OR
      * open == high == low == close (a flat/degenerate bar carries no range), OR
      * any of open/high/low/close <= 0 (a zero/negative price is not a quote).
    The FIRST row failing all three (real volume AND a non-degenerate,
    all-positive OHLC) is the real inception bar; it and everything after are
    kept unchanged. Only LEADING rows are trimmed — a legitimate later
    zero-volume holiday bar in the middle of real history is never touched
    (we stop at the first real bar). Pure and deterministic.
    """
    start = 0
    n = len(daily_bars)
    for i in range(n):
        bar = daily_bars[i]
        try:
            o = float(bar["open"])
            h = float(bar["high"])
            low = float(bar["low"])
            c = float(bar["close"])
            vol = int(bar["volume"])
        except (KeyError, TypeError, ValueError):
            start = i + 1
            continue
        degenerate = (o == h == low == c) or min(o, h, low, c) <= 0
        if vol <= 0 or degenerate:
            start = i + 1
            continue
        start = i
        break
    else:
        # every row was padding (or the series was empty): nothing real
        return []
    return list(daily_bars[start:])


def merge_daily(existing: list[Bar], incoming: list[Bar]) -> list[Bar]:
    """Union two daily bar series by date, preserving the DEEPER history.

    The nightly append use case: an existing deep (backfilled) file must not be
    shrunk when a plain ~400-day snapshot runs. Merge by ISO date key — the
    incoming bar wins for any date it also carries (freshest data / any
    late correction), while dates present only in ``existing`` (the deep tail)
    are retained. Result is sorted oldest -> newest by date. Pure and
    deterministic; the caller re-derives weekly/monthly from the merged daily.
    """
    by_date: dict[str, Bar] = {}
    for bar in existing:
        by_date[str(bar["date"])] = bar
    for bar in incoming:
        by_date[str(bar["date"])] = bar  # incoming wins on collision
    return [by_date[k] for k in sorted(by_date, key=_parse_date)]


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
        # One un-fetchable ticker (delisted CUSIP, non-equity) must not sink the
        # rest — skip it with empty bars; the caller reports "no bars".
        try:
            daily = fetch(sym, start_time=start_time, interval="day")
        except Exception:  # noqa: BLE001 — per-symbol isolation, caller logs the skip
            daily = []
        out[sym] = {
            "daily": daily,
            "weekly": resample(daily, "week"),
            "monthly": resample(daily, "month"),
        }
    return out


#: The deep-backfill start_time floor. The broker caps daily history at ~2891
#: bars (~11yr); requesting from here yields the full available window for any
#: ticker, and trim_padding drops the pre-inception placeholder rows the API
#: pads the gap with for younger tickers.
BACKFILL_START = "2015-01-01T00:00:00Z"


def backfill_bars(
    symbols: list[str], *, fetch=None, start_time: str = BACKFILL_START,
) -> dict[str, dict[str, list[Bar]]]:
    """Fetch the FULL available daily history for each symbol, trimmed + derived.

    Requests from ``start_time`` (default 2015 — before the ~11yr cap), TRIMS
    pre-trading-history padding via ``trim_padding`` (so a young ticker starts
    at its real inception, not a wall of fake pre-IPO bars), then derives
    weekly/monthly from the trimmed daily. Returns {symbol: {"daily", "weekly",
    "monthly"}}. Same injected ``fetch`` I/O boundary as ``snapshot_bars``.
    """
    if fetch is None:
        from .brokers import robinhood

        fetch = robinhood.fetch_historicals
    out: dict[str, dict[str, list[Bar]]] = {}
    for symbol in symbols:
        sym = symbol.upper()
        try:
            raw = fetch(sym, start_time=start_time, interval="day")
        except Exception:  # noqa: BLE001 — per-symbol isolation, caller logs the skip
            raw = []
        daily = trim_padding(raw)
        out[sym] = {
            "daily": daily,
            "weekly": resample(daily, "week"),
            "monthly": resample(daily, "month"),
        }
    return out
