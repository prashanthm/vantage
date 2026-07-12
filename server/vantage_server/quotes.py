"""Quote providers — the market-data I/O in the service.

The default and only real provider is ``YFinanceQuoteProvider``: it fetches real
delayed prices from Yahoo Finance (via the ``yfinance`` package) for the plain
equity symbols in the portfolio, layered over the store's own persisted quote
metadata (name / asset_class) and the importer-maintained marks for symbols
Yahoo cannot price — option contracts (spaces in the symbol), CUSIPs, and the
CRYPTO / FUTURES / CASH sleeves. Any fetch failure degrades to the stored
snapshot flagged ``stale=True`` — the engine always has prices, never demo data.

``FixtureQuoteProvider`` remains ONLY as a deterministic test seam: it reads a
``quotes.json`` from whatever data dir it is pointed at (tests point it at a
synthetic temp dir). It is selected at runtime solely by ``VANTAGE_QUOTES=fixture``
and is never the product default — there is no packaged demo dataset.

To avoid hammering the feed, successful yfinance fetches are cached on disk
(``<data_dir>/quotes_cache_yf.json``, with a fetched_at timestamp) and reused for
``VANTAGE_QUOTES_TTL`` seconds (default 900). Set ``VANTAGE_QUOTES_TTL=0`` to
bypass the cache (every snapshot fetches). Both the fetch callable and the clock
are injectable so cache hit/expiry and network behavior are unit-testable
without touching Yahoo.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from dataclasses import replace
from pathlib import Path
from typing import Callable, Protocol

from .models import Quote, QuoteSnapshot
from .store import Store, StoreError, resolve_data_dir

ENV_QUOTES = "VANTAGE_QUOTES"
ENV_QUOTES_TTL = "VANTAGE_QUOTES_TTL"
DEFAULT_TTL_SECONDS = 900.0
CACHE_FILENAME = "quotes_cache_yf.json"

#: Asset classes Yahoo can actually price. Importer-maintained synthetic entries
#: (option marks with spaces, CRYPTO/FUTURES sleeves, CASH) keep their stored
#: price and are never fetched, never counted as stale when Yahoo lacks them.
LIVE_FETCHABLE_CLASSES = frozenset({"usEquity", "intlEquity", "bonds"})


def _utc_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _is_listed_ticker(sym: str) -> bool:
    """True for plain listed-equity symbols Yahoo can price. Excludes option
    contracts (a space), numeric CUSIPs, and empty strings. Robinhood-style
    option marks like ``-ALAB260710C400`` start with '-' and are excluded."""
    if not sym or " " in sym or sym.startswith("-"):
        return False
    return not sym.lstrip("-").isdigit()


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


def _snapshot_from_data(data: dict, source: str) -> QuoteSnapshot:
    """Build a QuoteSnapshot from a {as_of, quotes:{sym:{...}}} dict."""
    quotes: dict[str, Quote] = {}
    for sym, q in data["quotes"].items():
        if not isinstance(q, dict) or "price" not in q or "asset_class" not in q:
            raise StoreError(f"quote for {sym} needs price and asset_class")
        quotes[sym] = Quote(
            symbol=sym,
            name=str(q.get("name", sym)),
            price=float(q["price"]),
            day_pct=float(q.get("day_pct", 0)),
            asset_class=str(q["asset_class"]),
            currency=currency_for_symbol(sym),
        )
    return QuoteSnapshot(quotes=quotes, as_of=str(data.get("as_of") or ""), source=source)


#: Yahoo market suffix -> currency. A bare ticker is USD; a suffixed listing
#: is quoted in its home currency (yfinance returns the local price).
_SUFFIX_CCY = {".NS": "INR", ".BO": "INR", ".L": "GBP", ".TO": "CAD",
               ".HK": "HKD", ".T": "JPY", ".AX": "AUD", ".DE": "EUR", ".PA": "EUR"}


def currency_for_symbol(symbol: str) -> str:
    """The currency a symbol's price is denominated in, from its market suffix
    (default USD for a plain US ticker)."""
    up = symbol.upper()
    for suf, ccy in _SUFFIX_CCY.items():
        if up.endswith(suf):
            return ccy
    return "USD"


def base_snapshot(data_dir: str | os.PathLike[str] | None = None) -> QuoteSnapshot:
    """The store's own persisted quote snapshot — real data, no fixtures.

    SQLite: the ``quotes`` table (written by refresh). JSON: a ``quotes.json``
    in the data dir (the test seam / offline import). Raises StoreError when
    neither exists — there is no demo fallback.
    """
    data_dir = resolve_data_dir(data_dir)
    store = Store(data_dir)
    if store.uses_sqlite:
        data = store.load_quotes()
        if not data or not data.get("quotes"):
            raise StoreError(f"{data_dir}: no quotes in vantage.db — import a broker first")
        return _snapshot_from_data(data, source="store")
    path = Path(data_dir) / "quotes.json"
    if not path.is_file():
        raise StoreError(f"{path}: file not found — no quotes available")
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise StoreError(f"{path}: invalid JSON ({e})") from e
    if not isinstance(data, dict) or "quotes" not in data or "as_of" not in data:
        raise StoreError(f"{path}: must be an object with 'as_of' and 'quotes' keys")
    return _snapshot_from_data(data, source="store")


class FixtureQuoteProvider:
    """Deterministic quotes from <data_dir>/quotes.json — a TEST seam only.

    Not the product default and not backed by any packaged demo dataset; tests
    point it at a synthetic temp dir. Selected at runtime only by
    VANTAGE_QUOTES=fixture.
    """

    source = "fixture"

    def __init__(self, data_dir: str | os.PathLike[str] | None = None):
        self.data_dir = resolve_data_dir(data_dir)

    def snapshot(self) -> QuoteSnapshot:
        snap = base_snapshot(self.data_dir)
        return replace(snap, source=self.source)


def _yf_fetch(symbols: list[str], timeout: float = 15.0) -> dict[str, tuple[float, float]]:
    """Fetch {SYMBOL: (last_price, prev_close)} from Yahoo via yfinance.

    Uses fast_info (a light metadata call) per symbol; symbols yfinance can't
    resolve are simply absent from the result (they fall back to stored price).
    Imported lazily so a partial install still imports this module.
    """
    import yfinance as yf  # noqa: PLC0415 — heavy dep, load only when fetching

    out: dict[str, tuple[float, float]] = {}
    if not symbols:
        return out
    tickers = yf.Tickers(" ".join(symbols))
    for sym in symbols:
        try:
            fi = tickers.tickers[sym].fast_info
            last = fi.get("lastPrice") if hasattr(fi, "get") else getattr(fi, "last_price", None)
            prev = fi.get("previousClose") if hasattr(fi, "get") else getattr(fi, "previous_close", None)
            if last is None:
                continue
            out[sym.upper()] = (float(last), float(prev) if prev else float(last))
        except Exception:
            continue  # one bad symbol never sinks the batch
    return out


class YFinanceQuoteProvider:
    """Real delayed quotes from Yahoo, layered over the store's stored snapshot.

    The stored snapshot supplies name + asset_class for every symbol and the
    price for everything Yahoo can't quote (options, CUSIPs, sleeves). Real
    fetched prices overwrite only the plain-equity symbols. Any failure degrades
    to the stored snapshot with stale=True. `fetch` and `clock` are injectable
    so tests never touch the network.
    """

    source = "yfinance"

    def __init__(
        self,
        data_dir: str | os.PathLike[str] | None = None,
        fetch: Callable[[list[str]], dict[str, tuple[float, float]]] | None = None,
        ttl: float | None = None,
        clock: Callable[[], _dt.datetime] | None = None,
    ):
        self.data_dir = resolve_data_dir(data_dir)
        self._fetch_fn = fetch or _yf_fetch
        self.ttl = resolve_ttl(ttl)
        self._clock = clock or _utc_now

    @property
    def _cache_path(self) -> Path:
        return Path(self.data_dir) / CACHE_FILENAME

    def _augment_with_held(self, stored: dict[str, Quote]) -> dict[str, Quote]:
        """Add a synthesized base Quote for every held symbol missing from the
        stored quote table, so a newly-imported holding still gets fetched +
        priced. Held symbol list comes from the store's lots (real data)."""
        merged = dict(stored)
        try:
            lots = Store(self.data_dir).load_lots()
        except StoreError:
            return merged
        for lot in lots:
            sym = lot.symbol
            if sym in merged:
                continue
            # Non-listed held symbols (options, sleeves, CUSIPs) fall back to
            # cost basis so the engine has a value; listed ones get a $0 base
            # that the yfinance fetch overwrites (or stays stale if unfetched).
            listed = _is_listed_ticker(sym)
            merged[sym] = Quote(
                symbol=sym, name=sym,
                price=0.0 if listed else float(getattr(lot, "cost_per_share", 0.0) or 0.0),
                day_pct=0.0, asset_class="usEquity" if listed else "cash",
                currency=currency_for_symbol(sym),
            )
        return merged

    def snapshot(self) -> QuoteSnapshot:
        base = base_snapshot(self.data_dir)
        # Universe = every HELD symbol (from lots), not just the ones already in
        # the stored quotes table — a fresh holding must get a real price too.
        # Held symbols absent from stored quotes get a synthesized usEquity base
        # entry (name = symbol) which the fetched price then overwrites.
        base = replace(base, quotes=self._augment_with_held(base.quotes))
        # Only real listed tickers go to Yahoo: importer-maintained synthetic
        # entries (options marks with spaces, CRYPTO/FUTURES sleeves, CASH,
        # numeric CUSIPs) are excluded by asset class and shape.
        fetchable = {
            s for s, q in base.quotes.items()
            if q.asset_class in LIVE_FETCHABLE_CLASSES and _is_listed_ticker(s)
        }
        symbols = sorted(fetchable)

        cached = self._read_cache(needed=fetchable)
        if cached is not None:
            live, as_of = cached
        else:
            try:
                live = self._fetch_fn(symbols)
            except Exception:
                return replace(base, source=self.source, stale=True)
            as_of = self._clock().isoformat(timespec="seconds")
            self._write_cache(live, as_of, requested=fetchable)

        quotes: dict[str, Quote] = {}
        missing = False
        for sym, quote in base.quotes.items():
            row = live.get(sym.upper())
            if row is None:
                if sym in fetchable:
                    missing = True  # a fetchable symbol Yahoo didn't return: stored price stands
                quotes[sym] = quote
            else:
                last, prev = row
                day_pct = round((last - prev) / prev * 100, 2) if prev else 0.0
                quotes[sym] = replace(quote, price=last, day_pct=day_pct)
        return QuoteSnapshot(quotes=quotes, as_of=as_of, source=self.source, stale=missing)

    # ------------------------------------------------------------- cache

    def _read_cache(self, needed: set[str] | None = None
                    ) -> tuple[dict[str, tuple[float, float]], str] | None:
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
            # A cache that predates a freshly-imported symbol must MISS, or the
            # new holding stays unpriced until TTL expiry. Compare against the
            # REQUESTED set (what the cached fetch asked for) — a symbol Yahoo
            # simply didn't return is still "covered" and won't force endless
            # refetches; only a genuinely NEW symbol invalidates.
            requested = set(str(x) for x in data.get("requested", rows.keys()))
            if needed and not needed.issubset(requested):
                return None
            return rows, fetched_at
        except Exception:
            return None

    def _write_cache(self, rows: dict[str, tuple[float, float]], fetched_at: str,
                     requested: set[str] | None = None) -> None:
        if self.ttl <= 0:
            return
        try:
            payload = {"fetched_at": fetched_at,
                       "requested": sorted(requested) if requested else sorted(rows),
                       "rows": {sym: list(pair) for sym, pair in rows.items()}}
            self._cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        except OSError:
            pass  # a read-only data dir must never break quote serving


def get_provider(data_dir: str | os.PathLike[str] | None = None) -> QuoteProvider:
    """Provider selection: yfinance is the default (real data). VANTAGE_QUOTES=fixture
    opts into the deterministic test seam (synthetic data dir only)."""
    if os.environ.get(ENV_QUOTES, "").strip().lower() == "fixture":
        return FixtureQuoteProvider(data_dir)
    return YFinanceQuoteProvider(data_dir)
