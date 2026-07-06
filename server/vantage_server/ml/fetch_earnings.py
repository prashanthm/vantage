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
from pathlib import Path


def earnings_dir(data_dir: str | Path) -> Path:
    return Path(data_dir) / "ml" / "earnings"


def earnings_file(data_dir: str | Path, symbol: str) -> Path:
    return earnings_dir(data_dir) / f"{symbol.upper()}.json"


def load_cached(data_dir: str | Path, symbol: str) -> dict | None:
    """The cached earnings record for ``symbol`` ({symbol, as_of, earnings:
    [...], dates: [...]}), or None when there is no cache file / it's
    unreadable."""
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
    d = earnings_dir(data_dir)
    d.mkdir(parents=True, exist_ok=True)
    path = earnings_file(data_dir, symbol)
    payload = {
        "symbol": symbol.upper(),
        "as_of": as_of,
        "earnings": earnings,
        "dates": _dates_from(earnings),
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
