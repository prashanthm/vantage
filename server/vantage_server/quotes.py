"""Quote providers — the only market-data I/O in the service.

Default is the deterministic FixtureQuoteProvider (reads quotes.json from the
data dir — same numbers as the SPA's MARKET table). StooqQuoteProvider fetches
free delayed CSV quotes from stooq.com over stdlib urllib (no credentials);
it is only constructed when VANTAGE_QUOTES=stooq, and any failure degrades to
the fixture snapshot with stale=True — the engine always has prices.
"""
from __future__ import annotations

import datetime as _dt
import os
from dataclasses import replace
from pathlib import Path
from typing import Protocol

from .models import Quote, QuoteSnapshot
from .store import StoreError, resolve_data_dir

ENV_QUOTES = "VANTAGE_QUOTES"
STOOQ_URL = "https://stooq.com/q/l/?s={symbols}&f=sd2t2ohlcv&h&e=csv"


class QuoteProvider(Protocol):
    """Anything that can produce a QuoteSnapshot."""

    def snapshot(self) -> QuoteSnapshot: ...


class FixtureQuoteProvider:
    """Deterministic quotes from <data_dir>/quotes.json. The default."""

    source = "fixture"

    def __init__(self, data_dir: str | os.PathLike[str] | None = None):
        self.data_dir = resolve_data_dir(data_dir)

    def snapshot(self) -> QuoteSnapshot:
        import json

        path = Path(self.data_dir) / "quotes.json"
        if not path.is_file():
            raise StoreError(f"{path}: file not found")
        try:
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise StoreError(f"{path}: invalid JSON ({e})") from e
        if not isinstance(data, dict) or "quotes" not in data or "as_of" not in data:
            raise StoreError(f"{path}: must be an object with 'as_of' and 'quotes' keys")
        quotes: dict[str, Quote] = {}
        for sym, q in data["quotes"].items():
            if not isinstance(q, dict) or "price" not in q or "asset_class" not in q:
                raise StoreError(f"{path}: quote for {sym} needs price and asset_class")
            quotes[sym] = Quote(
                symbol=sym,
                name=str(q.get("name", sym)),
                price=float(q["price"]),
                day_pct=float(q.get("day_pct", 0)),
                asset_class=str(q["asset_class"]),
            )
        return QuoteSnapshot(quotes=quotes, as_of=str(data["as_of"]), source=self.source)


class StooqQuoteProvider:
    """Free delayed quotes from stooq.com CSV, layered over fixture metadata.

    Stooq's light endpoint returns Symbol,Date,Time,Open,High,Low,Close,Volume.
    We take Close as the price and (Close-Open)/Open as an intraday day_pct
    approximation; name and asset_class always come from the fixture (Stooq
    has neither). CASH is never fetched (price is definitionally 1).

    Any failure — network, HTTP, unparsable CSV, or 'N/D' rows — degrades to
    the fixture snapshot flagged stale=True. `urlopen` is injectable so tests
    never touch the network.
    """

    source = "stooq"

    def __init__(self, data_dir: str | os.PathLike[str] | None = None, urlopen=None, timeout: float = 10.0):
        self.data_dir = resolve_data_dir(data_dir)
        self._urlopen = urlopen  # test seam; resolved lazily to stdlib when None
        self.timeout = timeout

    def snapshot(self) -> QuoteSnapshot:
        fixture = FixtureQuoteProvider(self.data_dir).snapshot()
        try:
            live = self._fetch(sorted(s for s in fixture.quotes if s != "CASH"))
        except Exception:
            return replace(fixture, stale=True)  # degrade: fixture prices, flagged stale

        quotes: dict[str, Quote] = {}
        missing = False
        for sym, base in fixture.quotes.items():
            row = live.get(sym)
            if row is None:
                if sym != "CASH":
                    missing = True
                quotes[sym] = base
            else:
                close, open_ = row
                day_pct = round((close - open_) / open_ * 100, 2) if open_ else 0.0
                quotes[sym] = replace(base, price=close, day_pct=day_pct)
        as_of = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
        return QuoteSnapshot(quotes=quotes, as_of=as_of, source=self.source, stale=missing)

    def _fetch(self, symbols: list[str]) -> dict[str, tuple[float, float]]:
        """Return {SYMBOL: (close, open)} for symbols Stooq knows."""
        urlopen = self._urlopen
        if urlopen is None:
            from urllib.request import urlopen  # stdlib, imported only when live quotes are on
        url = STOOQ_URL.format(symbols="+".join(f"{s.lower()}.us" for s in symbols))
        with urlopen(url, timeout=self.timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        out: dict[str, tuple[float, float]] = {}
        lines = [ln for ln in body.strip().splitlines() if ln]
        for line in lines[1:]:  # skip header
            parts = line.split(",")
            if len(parts) < 8:
                continue
            sym_raw, _date, _time, open_s, _hi, _lo, close_s = parts[0], *parts[1:7]
            sym = sym_raw.split(".")[0].upper()
            try:
                out[sym] = (float(close_s), float(open_s))
            except ValueError:
                continue  # 'N/D' — symbol unknown to Stooq; fixture fills in
        return out


def get_provider(data_dir: str | os.PathLike[str] | None = None) -> QuoteProvider:
    """Provider selection: VANTAGE_QUOTES=stooq opts into live quotes; anything
    else (including unset) is the deterministic fixture."""
    if os.environ.get(ENV_QUOTES, "").strip().lower() == "stooq":
        return StooqQuoteProvider(data_dir)
    return FixtureQuoteProvider(data_dir)
