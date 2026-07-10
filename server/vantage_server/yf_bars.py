"""yfinance historical-bar fetch — the real EOD OHLCV source.

Implements the ``fetch(symbol, *, start_time, interval="day") -> [Bar]`` seam
that ``bars.snapshot_bars`` / ``bars.backfill_bars`` inject, so replacing the
broker bar source with Yahoo is a drop-in: the bars engine sees only this
callable and needs no changes.

Bar contract (matches bars.py): [{date (ISO yyyy-mm-dd), open, high, low, close
(floats), volume (int)}], oldest -> newest. yfinance is imported lazily so the
module imports even in a partial environment.
"""
from __future__ import annotations

import datetime as _dt

_INTERVAL_MAP = {"day": "1d", "week": "1wk", "month": "1mo"}


def _parse_start(start_time: str) -> str:
    """RFC3339 'YYYY-MM-DDTHH:MM:SSZ' -> 'YYYY-MM-DD' for yfinance start."""
    return start_time.split("T", 1)[0]


def fetch_historicals(
    symbol: str,
    *,
    start_time: str,
    interval: str = "day",
    end_time: str | None = None,
) -> list[dict]:
    """Daily (or weekly/monthly) OHLCV bars for one symbol from Yahoo.

    Returns normalized Bar dicts oldest->newest. Raises on a hard yfinance
    failure so the caller's per-symbol try/except skips just that ticker.
    """
    import yfinance as yf  # noqa: PLC0415 — heavy dep, load only when fetching

    yf_interval = _INTERVAL_MAP.get(interval, "1d")
    start = _parse_start(start_time)
    end = _parse_start(end_time) if end_time else None
    hist = yf.Ticker(symbol.upper()).history(
        start=start, end=end, interval=yf_interval, auto_adjust=False, actions=False,
    )
    bars: list[dict] = []
    for ts, row in hist.iterrows():
        # ts is a pandas Timestamp; take the calendar date.
        day = ts.date() if hasattr(ts, "date") else _dt.date.fromisoformat(str(ts)[:10])
        try:
            bar = {
                "date": day.isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,  # NaN guard
            }
        except (KeyError, ValueError, TypeError):
            continue  # a malformed row is dropped, never fabricated
        # Skip zero/negative-price rows (not a real quote), matching bars.py policy.
        if min(bar["open"], bar["high"], bar["low"], bar["close"]) <= 0:
            continue
        bars.append(bar)
    return bars
