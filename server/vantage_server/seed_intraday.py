"""Seed / refresh a rolling window of 1-minute SPX bars into ``intraday_bars``.

The DNA path already persists a session's 1m bars when it fetches them (store.
save_intraday_bars), but that only captures sessions the operator VIEWS. This
module proactively backfills the trailing ~30 days of 1m SPX every night — while
yfinance still serves them — so the SPX-analyst forecast loop always has a full
month of 1m history to seed the chart/technicals from, even for sessions never
opened in the journal.

Idempotent: only fetches days not already stored (or --force to re-fetch).
SPX only by default (the forecast feature is SPX-first); pass --symbol to widen.

Run nightly:  python -m vantage_server.seed_intraday [--days 30] [--symbol ^GSPC]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import logging

from .store import Store, resolve_data_dir

log = logging.getLogger("vantage.seed_intraday")

ET_OPEN = 9 * 60 + 30
ET_CLOSE = 16 * 60


def _rth_1m(symbol: str, day: str):
    """One RTH session of 1m bars for ``day`` as the compact OHLC dict, or None.
    yfinance caps 1m history at ~30 days — older days simply return empty."""
    try:
        import yfinance as yf
        from zoneinfo import ZoneInfo
        nxt = (_dt.date.fromisoformat(day) + _dt.timedelta(1)).isoformat()
        h = yf.Ticker(symbol).history(start=day, end=nxt, interval="1m")
        if h.empty:
            return None
        if h.index.tz is None:
            h.index = h.index.tz_localize("UTC")
        h.index = h.index.tz_convert(ZoneInfo("America/New_York"))
        mins = h.index.hour * 60 + h.index.minute
        h = h[(mins >= ET_OPEN) & (mins < ET_CLOSE)]
        if h.empty:
            return None
        return {
            "ts": [t.isoformat() for t in h.index],
            "open": [float(v) for v in h["Open"]],
            "high": [float(v) for v in h["High"]],
            "low": [float(v) for v in h["Low"]],
            "close": [float(v) for v in h["Close"]],
            "volume": [float(v) for v in h.get("Volume", h["Close"] * 0)],
        }
    except Exception as e:  # network/library issue for this day — skip, don't fail the run
        log.warning("1m fetch failed for %s %s: %s", symbol, day, e)
        return None


def _trading_days(days_back: int, today: _dt.date) -> list[str]:
    """The last ``days_back`` weekdays up to (and including) today, newest→oldest.
    Weekend skip only — market holidays just fetch empty and are skipped."""
    out, d = [], today
    while len(out) < days_back:
        if d.weekday() < 5:      # Mon-Fri
            out.append(d.isoformat())
        d -= _dt.timedelta(1)
    return out


def seed(store: Store, symbol: str = "^GSPC", days: int = 30,
         today: _dt.date | None = None, force: bool = False) -> dict:
    """Backfill missing 1m sessions for the trailing window. Returns a summary."""
    if not getattr(store, "uses_sqlite", False):
        return {"error": "seed_intraday needs the SQLite backend", "stored": 0}
    today = today or _dt.date.today()
    fetched = skipped = empty = 0
    for day in _trading_days(days, today):
        if not force and store.load_intraday_bars(symbol, day, "1m"):
            skipped += 1
            continue
        ohlc = _rth_1m(symbol, day)
        if ohlc is None:
            empty += 1
            continue
        if store.save_intraday_bars(symbol, day, "1m", ohlc):
            fetched += 1
    return {"symbol": symbol, "window_days": days, "fetched": fetched,
            "already_had": skipped, "unavailable": empty}


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="vantage_server.seed_intraday",
        description="Backfill a rolling window of 1m SPX bars into intraday_bars.")
    p.add_argument("--symbol", default="^GSPC", help="bar symbol (default ^GSPC = SPX)")
    p.add_argument("--days", type=int, default=30, help="trailing trading days to keep")
    p.add_argument("--force", action="store_true", help="re-fetch even days already stored")
    p.add_argument("--data-dir", default=None)
    return p


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = _build_parser().parse_args(argv)
    store = Store(resolve_data_dir(args.data_dir))
    summary = seed(store, symbol=args.symbol, days=args.days, force=args.force)
    log.info("seed_intraday %s: %s", args.symbol, summary)
    return 0 if "error" not in summary else 1


if __name__ == "__main__":
    raise SystemExit(main())
