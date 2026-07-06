"""Quote providers — the only market-data I/O in the service.

Default is the deterministic FixtureQuoteProvider (reads quotes.json from the
data dir — same numbers as the SPA's MARKET table). StooqQuoteProvider fetches
free delayed CSV quotes from stooq.com over stdlib urllib (no credentials);
it is only constructed when VANTAGE_QUOTES=stooq, and any failure degrades to
the fixture snapshot with stale=True — the engine always has prices.

To avoid hammering the free feed, successful Stooq fetches are cached on disk
(<data_dir>/quotes_cache.json, with a fetched_at timestamp) and reused for
VANTAGE_QUOTES_TTL seconds (default 900). Set VANTAGE_QUOTES_TTL=0 to bypass
the cache entirely (every snapshot fetches). The clock is injectable so cache
hit/expiry is unit-testable without sleeping.
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import json
import os
from dataclasses import replace
from pathlib import Path
from typing import Callable, Protocol

from .models import Quote, QuoteSnapshot
from .store import StoreError, resolve_data_dir

ENV_QUOTES = "VANTAGE_QUOTES"
ENV_QUOTES_TTL = "VANTAGE_QUOTES_TTL"
DEFAULT_TTL_SECONDS = 900.0
CACHE_FILENAME = "quotes_cache.json"
STOOQ_URL = "https://stooq.com/q/l/?s={symbols}&f=sd2t2ohlcv&h&e=csv"

#: Asset classes Stooq can actually price. Imported real portfolios carry
#: synthetic-symbol quote entries ("SPY 2026-07-17 750C" options marks,
#: CRYPTO/FUTURES sleeves, CASH) whose prices are maintained by the importer
#: — never fetched, and never counted as stale when absent from Stooq.
STOOQ_FETCHABLE_CLASSES = frozenset({"usEquity", "intlEquity", "bonds"})


def _utc_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def resolve_ttl(ttl: float | None = None) -> float:
    """Explicit arg > VANTAGE_QUOTES_TTL env > 900s default. <= 0 disables
    the cache (every snapshot fetches; nothing is written)."""
    if ttl is not None:
        return float(ttl)
    env = os.environ.get(ENV_QUOTES_TTL, "").strip()
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    return DEFAULT_TTL_SECONDS


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

        from .store import Store

        store = Store(self.data_dir)
        if store.uses_sqlite:
            data = store.load_quotes()
            if not data or not data.get("quotes"):
                raise StoreError(f"{self.data_dir}: no quotes in vantage.db")
        else:
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


def stooq_symbol(symbol: str) -> str:
    """Stooq wants lowercase with a '.us' suffix for US tickers: SPY -> spy.us."""
    return f"{symbol.lower()}.us"


class StooqQuoteProvider:
    """Free delayed quotes from stooq.com CSV, layered over fixture metadata.

    Stooq's light endpoint returns Symbol,Date,Time,Open,High,Low,Close,Volume.
    We take Close as the price and (Close-Open)/Open as an intraday day_pct
    approximation; name and asset_class always come from the fixture (Stooq
    has neither). CASH is never fetched (price is definitionally 1).

    Any failure — network, HTTP, unparsable CSV, or 'N/D' rows — degrades to
    the fixture snapshot flagged stale=True per symbol. `urlopen` is
    injectable so tests never touch the network; `clock` is injectable so the
    on-disk cache (quotes_cache.json, TTL `ttl` seconds) is testable.
    """

    source = "stooq"

    def __init__(
        self,
        data_dir: str | os.PathLike[str] | None = None,
        urlopen=None,
        timeout: float = 10.0,
        ttl: float | None = None,
        clock: Callable[[], _dt.datetime] | None = None,
    ):
        self.data_dir = resolve_data_dir(data_dir)
        self._urlopen = urlopen  # test seam; resolved lazily to stdlib when None
        self.timeout = timeout
        self.ttl = resolve_ttl(ttl)
        self._clock = clock or _utc_now

    @property
    def _cache_path(self) -> Path:
        return Path(self.data_dir) / CACHE_FILENAME

    def snapshot(self) -> QuoteSnapshot:
        fixture = FixtureQuoteProvider(self.data_dir).snapshot()
        # Only real listed tickers go to Stooq: importer-maintained synthetic
        # entries (options marks with spaces in the symbol, CRYPTO/FUTURES
        # sleeves, CASH) are excluded by asset class — a space would corrupt
        # the request URL and the feed cannot know them anyway.
        fetchable = {
            s for s, q in fixture.quotes.items()
            if q.asset_class in STOOQ_FETCHABLE_CLASSES and " " not in s
        }
        symbols = sorted(fetchable)

        cached = self._read_cache()
        if cached is not None:
            live, as_of = cached
        else:
            try:
                live = self._fetch(symbols)
            except Exception:
                return replace(fixture, stale=True)  # degrade: fixture prices, flagged stale
            as_of = self._clock().isoformat(timespec="seconds")
            self._write_cache(live, as_of)

        quotes: dict[str, Quote] = {}
        missing = False
        for sym, base in fixture.quotes.items():
            row = live.get(sym)
            if row is None:
                if sym in fetchable:
                    missing = True  # N/D or absent row: this symbol falls back to fixture
                quotes[sym] = base
            else:
                close, open_ = row
                day_pct = round((close - open_) / open_ * 100, 2) if open_ else 0.0
                quotes[sym] = replace(base, price=close, day_pct=day_pct)
        return QuoteSnapshot(quotes=quotes, as_of=as_of, source=self.source, stale=missing)

    # ------------------------------------------------------------- fetch

    def _fetch(self, symbols: list[str]) -> dict[str, tuple[float, float]]:
        """Return {SYMBOL: (close, open)} for symbols Stooq knows."""
        urlopen = self._urlopen
        if urlopen is None:
            from urllib.request import urlopen  # stdlib, imported only when live quotes are on
        url = STOOQ_URL.format(symbols="+".join(stooq_symbol(s) for s in symbols))
        with urlopen(url, timeout=self.timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        return self._parse_csv(body)

    @staticmethod
    def _parse_csv(body: str) -> dict[str, tuple[float, float]]:
        """Parse Stooq's 'Symbol,Date,Time,Open,High,Low,Close,Volume' CSV.
        'N/D' cells (symbol unknown / market closed) skip the row so the
        fixture price backfills that symbol (per-symbol stale fallback)."""
        out: dict[str, tuple[float, float]] = {}
        reader = csv.reader(io.StringIO(body))
        for parts in reader:
            if len(parts) < 7 or parts[0].strip().lower() == "symbol":
                continue  # header, blank, or truncated row
            sym = parts[0].split(".")[0].strip().upper()
            open_s, close_s = parts[3].strip(), parts[6].strip()
            if not sym or "N/D" in (open_s, close_s):
                continue
            try:
                out[sym] = (float(close_s), float(open_s))
            except ValueError:
                continue  # anything unparsable: fixture fills in
        return out

    # ------------------------------------------------------------- cache

    def _read_cache(self) -> tuple[dict[str, tuple[float, float]], str] | None:
        """Return (rows, fetched_at) when a fresh cache exists; else None.
        A corrupt or expired cache is simply ignored."""
        if self.ttl <= 0:
            return None
        try:
            data = json.loads(self._cache_path.read_text(encoding="utf-8"))
            fetched_at = str(data["fetched_at"])
            age = (self._clock() - _dt.datetime.fromisoformat(fetched_at)).total_seconds()
            if age < 0 or age >= self.ttl:
                return None
            rows = {
                str(sym): (float(pair[0]), float(pair[1]))
                for sym, pair in dict(data["rows"]).items()
            }
            return rows, fetched_at
        except Exception:
            return None

    def _write_cache(self, rows: dict[str, tuple[float, float]], fetched_at: str) -> None:
        if self.ttl <= 0:
            return  # cache disabled
        try:
            payload = {"fetched_at": fetched_at,
                       "rows": {sym: list(pair) for sym, pair in rows.items()}}
            self._cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        except OSError:
            pass  # a read-only data dir must never break quote serving


def get_provider(data_dir: str | os.PathLike[str] | None = None) -> QuoteProvider:
    """Provider selection: VANTAGE_QUOTES=stooq opts into live quotes; anything
    else (including unset) is the deterministic fixture."""
    if os.environ.get(ENV_QUOTES, "").strip().lower() == "stooq":
        return StooqQuoteProvider(data_dir)
    return FixtureQuoteProvider(data_dir)
