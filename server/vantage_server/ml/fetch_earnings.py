"""Earnings-date fetch + cache — the I/O sibling of events.py.

Fetches each underlying's earnings-report dates (READ-ONLY, via the broker's
allowlisted get_earnings_results) and caches them to
<data_dir>/ml/earnings/<UND>.json so a rebuild doesn't re-hit the broker. The
pure events.earnings_within kernel consumes the DATES this module produces.

Like the rest of the ml build layer this is OPERATOR-side (outside the read-only
service surface): only the build CLI calls it, and it only ever READS from the
broker. Index/ETF symbols (SPXW, QDTE, ...) legitimately have no earnings — an
empty list is cached so they aren't re-fetched every build.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path


def earnings_dir(data_dir: str | Path) -> Path:
    return Path(data_dir) / "ml" / "earnings"


def earnings_file(data_dir: str | Path, symbol: str) -> Path:
    return earnings_dir(data_dir) / f"{symbol.upper()}.json"


def load_cached(data_dir: str | Path, symbol: str) -> dict | None:
    """The cached earnings record for ``symbol`` ({symbol, as_of, earnings:
    [...], dates: [...]}), or None when there is no cache / it's unreadable.
    Reads through the Store backend (SQLite earnings table or JSON file)."""
    from ..store import Store

    store = Store(data_dir)
    if store.uses_sqlite:
        return store.load_earnings(symbol)
    path = earnings_file(data_dir, symbol)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _dates_from(earnings: list[dict]) -> list[str]:
    """The sorted, de-duplicated ISO report dates from normalized earnings rows."""
    seen = sorted({str(e.get("date"))[:10] for e in earnings if e.get("date")})
    return seen


def write_cache(
    data_dir: str | Path, symbol: str, earnings: list[dict], *, as_of: str,
) -> Path:
    """Persist a symbol's earnings (dates + est/actual EPS) to
    ml/earnings/<UND>.json. Returns the path written."""
    from ..store import Store

    store = Store(data_dir)
    dates = _dates_from(earnings)
    if store.uses_sqlite:
        store.put_earnings(symbol, earnings, dates, as_of=as_of)
        return Path(data_dir) / "vantage.db"
    d = earnings_dir(data_dir)
    d.mkdir(parents=True, exist_ok=True)
    path = earnings_file(data_dir, symbol)
    payload = {
        "symbol": symbol.upper(),
        "as_of": as_of,
        "earnings": earnings,
        "dates": dates,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def fetch_and_cache(
    data_dir: str | Path, symbol: str, *, fetch, as_of: str,
    refresh: bool = False,
) -> list[str]:
    """Earnings report DATES for ``symbol`` (ISO strings), fetching+caching once.

    ``fetch`` is a ``(symbol) -> [normalized earnings rows]`` callable (the
    broker's fetch_earnings). When a cache file already exists and ``refresh`` is
    False, the cached dates are returned WITHOUT a broker call. Otherwise the
    broker is called (READ-ONLY), the result cached, and its dates returned.

    A broker error is swallowed to a [] (never blocks the build) — the caller
    treats "no earnings dates" as unknown, so events.earnings_within reports the
    flags as False rather than fabricating them."""
    if not refresh:
        cached = load_cached(data_dir, symbol)
        if cached is not None:
            return list(cached.get("dates") or [])
    try:
        earnings = fetch(symbol) or []
    except Exception:  # broker/network failure -> cache nothing, degrade to []
        return []
    write_cache(data_dir, symbol, earnings, as_of=as_of)
    return _dates_from(earnings)


def has_future_date(data_dir: str | Path, symbol: str, today: str) -> bool:
    """True when the cache already holds an earnings date on/after ``today``.

    The nightly fetch's skip predicate: a cache whose dates are all in the past
    is stale by definition (the next report exists, we just don't have it yet),
    while a cache with a future date needs no broker call."""
    cached = load_cached(data_dir, symbol)
    if cached is None:
        return False
    return any(str(d)[:10] >= today for d in (cached.get("dates") or []))


# Plausible equity ticker: letters (optionally a class-share dot), 1-7 chars.
# Filters what _underlying passes through untouched — broker option symbols
# ("-ALAB260710C400"), CUSIP rows ("089693105") — so a lots-derived fetch never
# burns a broker call on a symbol that cannot have earnings.
_EQUITY_TICKER = re.compile(r"[A-Z]{1,6}(\.[A-Z])?")


def underlyings_from_lots(data_dir: str | Path) -> list[str]:
    """The distinct equity underlyings currently held, sorted.

    Lot symbols carry options ("ACN 2028-01-21 160C" -> ACN), sleeves
    (CASH/CRYPTO -> dropped), broker option ids and CUSIPs (dropped) — only
    plausible equity tickers survive, so the earnings fetch hits the broker
    once per real underlying."""
    from ..snapshot_bars import _underlying
    from ..store import Store

    out: set[str] = set()
    for lot in Store(data_dir).load_lots():
        underlying = _underlying(lot.symbol)
        if underlying and _EQUITY_TICKER.fullmatch(underlying):
            out.add(underlying)
    return sorted(out)


def main(argv=None) -> int:
    """Refresh the earnings-date cache for held symbols (nightly-friendly).

    Default mode is CONDITIONAL: a symbol is re-fetched only when its cache has
    no date on/after today — otherwise each nightly run would re-hit the broker
    for every symbol for no gain. ``--refresh`` forces an unconditional
    re-fetch. READ-ONLY against the broker, like the rest of the ml layer.
    """
    import argparse

    from ..brokers import get_connection
    from ..store import resolve_data_dir

    parser = argparse.ArgumentParser(
        description="Fetch/refresh cached earnings dates for held underlyings")
    parser.add_argument("--broker", default="robinhood")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--symbols", default="",
                        help="comma-separated symbols (default: underlyings from held lots)")
    parser.add_argument("--from-lots", action="store_true",
                        help="derive equity underlyings from held lots "
                             "(default when --symbols absent)")
    parser.add_argument("--refresh", action="store_true",
                        help="re-fetch every symbol, even with a future date cached")
    args = parser.parse_args(argv)

    data_dir = resolve_data_dir(args.data_dir)
    today = _dt.date.today().isoformat()

    if args.symbols.strip():
        symbols = sorted({s.strip().upper() for s in args.symbols.split(",") if s.strip()})
    else:
        symbols = underlyings_from_lots(data_dir)
    if not symbols:
        print("no symbols to fetch (no lots and no --symbols)")
        return 0

    conn = get_connection(args.broker)()
    fetch = getattr(conn, "fetch_earnings", None)
    if fetch is None:
        print(f"{args.broker}: no earnings capability — nothing fetched")
        return 0

    fetched, skipped = [], []
    for sym in symbols:
        if not args.refresh and has_future_date(data_dir, sym, today):
            skipped.append(sym)
            continue
        dates = fetch_and_cache(data_dir, sym, fetch=fetch, as_of=today, refresh=True)
        fetched.append(f"{sym}({len(dates)})")
    print(f"earnings: fetched {len(fetched)} symbol(s)"
          + (f" [{', '.join(fetched)}]" if fetched else "")
          + f", skipped {len(skipped)} with future dates cached")
    return 0


def load_earnings_by_symbol(
    data_dir: str | Path, symbols, *, fetch=None, as_of: str,
    refresh: bool = False,
) -> dict[str, list[str]]:
    """{underlying: [ISO earnings dates]} for every symbol, from cache + optional
    fetch.

    When ``fetch`` is None, only the cache is read (symbols with no cache map to
    []). When ``fetch`` is provided, uncached symbols are fetched+cached (unless
    ``refresh``, which re-fetches all). Deterministic in the symbols' upper-cased
    order. Blank symbols are skipped."""
    as_of = as_of or _dt.date.today().isoformat()
    out: dict[str, list[str]] = {}
    for raw in sorted({str(s or "").upper() for s in symbols}):
        if not raw:
            continue
        if fetch is None:
            cached = load_cached(data_dir, raw)
            out[raw] = list(cached.get("dates") or []) if cached else []
        else:
            out[raw] = fetch_and_cache(
                data_dir, raw, fetch=fetch, as_of=as_of, refresh=refresh)
    return out


if __name__ == "__main__":
    raise SystemExit(main())
