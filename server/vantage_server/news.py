"""Pluggable per-ticker news — a provider pipeline, not a hardcoded feed.

A ``NewsSource`` fetches recent headline items for one symbol. The pipeline fans
the *configured* sources, normalizes each to a ``NewsItem``, dedups across
sources (same story from Yahoo + a future Finnhub collapses to one), sorts
newest-first, and attaches a **headline sentiment lean** (the deterministic
``ml.sentiment.LexiconScorer`` over titles — clearly labeled "estimated", never
ground truth). Result is disk-cached per symbol with a short TTL.

Design mirrors ``quotes.py`` (provider protocol + env-selected registry) and
``fundamentals.py`` (injectable fetch, disk cache+TTL, dict|None). Adding a new
source later = one class implementing ``NewsSource`` + a registry entry; nothing
else changes.

Contract: a source NEVER raises for an unknown symbol — it returns [] (no news
!= an error). Any failure of a single source is swallowed so one dead provider
can't blank the whole read. On total failure the pipeline returns ``None`` and
the notebook hides the section rather than showing fabricated headlines.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, runtime_checkable

from .ml.sentiment import LexiconScorer, score_headlines
from .store import resolve_data_dir

ENV_SOURCES = "VANTAGE_NEWS_SOURCES"  # csv of source names; default "yfinance"
ENV_TTL = "VANTAGE_NEWS_TTL"
DEFAULT_TTL_SECONDS = 30 * 60.0  # 30min — headlines move faster than fundamentals
CACHE_DIRNAME = "news_cache"
DEFAULT_MAX_ITEMS = 12


# ============================================================ item shape

@dataclass(frozen=True)
class NewsItem:
    """One normalized headline. ``source`` names the provider for provenance."""

    title: str
    summary: str
    publisher: str
    published: str  # ISO-8601 (or "" when the source omits a timestamp)
    url: str
    source: str

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "summary": self.summary,
            "publisher": self.publisher,
            "published": self.published,
            "url": self.url,
            "source": self.source,
        }


# ============================================================ source protocol

@runtime_checkable
class NewsSource(Protocol):
    """Supplies recent news items for a symbol.

    ``name`` labels the provider (stamped onto each item's ``source``).
    ``fetch(symbol) -> [NewsItem]`` — most-recent-first is preferred but not
    required (the pipeline re-sorts). Must never raise for an unknown symbol;
    return [] instead."""

    name: str

    def fetch(self, symbol: str) -> list[NewsItem]:
        ...


def _yf_news(symbol: str) -> list[dict]:
    """Raw ``yf.Ticker(sym).news`` — a list of {content: {...}} dicts. Lazy import."""
    import yfinance as yf  # noqa: PLC0415

    return yf.Ticker(symbol.upper()).news or []


class YFinanceNewsSource:
    """Yahoo Finance news via yfinance (zero-credential, ~10 items/ticker).

    Projects each raw item's ``content.{title, summary, provider.displayName,
    pubDate, canonicalUrl.url}`` into a ``NewsItem``. The raw fetch is injectable
    for tests; any failure degrades to [] (never raises)."""

    name = "yfinance"

    def __init__(self, *, fetch: Callable[[str], list[dict]] | None = None):
        self._fetch = fetch or _yf_news

    def fetch(self, symbol: str) -> list[NewsItem]:
        try:
            raw = self._fetch(symbol.upper())
        except Exception:
            return []
        items: list[NewsItem] = []
        for entry in raw or []:
            # yfinance nests the fields under "content"; older shapes were flat.
            c = entry.get("content") if isinstance(entry, dict) else None
            if not isinstance(c, dict):
                c = entry if isinstance(entry, dict) else {}
            title = _clean(c.get("title"))
            if not title:
                continue
            provider = c.get("provider") or {}
            canonical = c.get("canonicalUrl") or c.get("clickThroughUrl") or {}
            items.append(
                NewsItem(
                    title=title,
                    summary=_clean(c.get("summary") or c.get("description")),
                    publisher=_clean(
                        provider.get("displayName") if isinstance(provider, dict) else provider
                    ),
                    published=_clean(c.get("pubDate") or c.get("displayTime")),
                    url=_clean(
                        canonical.get("url") if isinstance(canonical, dict) else canonical
                    ),
                    source=self.name,
                )
            )
        return items


def _clean(value) -> str:
    return str(value).strip() if value is not None else ""


# ============================================================ source registry

#: name -> zero-arg factory. Future sources (finnhub, newsapi, googlenews) add a
#: line here and implement NewsSource — the pipeline picks them up by env.
_SOURCE_FACTORIES: dict[str, Callable[[], NewsSource]] = {
    "yfinance": YFinanceNewsSource,
}


def get_news_sources(names: str | None = None) -> list[NewsSource]:
    """The configured news sources (``VANTAGE_NEWS_SOURCES`` csv, default yfinance).

    Unknown names are ignored (a typo can't crash the read). Order is preserved
    so the first-listed source wins ties on dedup."""
    raw = names if names is not None else os.environ.get(ENV_SOURCES, "")
    wanted = [n.strip().lower() for n in raw.split(",") if n.strip()] or ["yfinance"]
    out: list[NewsSource] = []
    for n in wanted:
        factory = _SOURCE_FACTORIES.get(n)
        if factory is not None:
            out.append(factory())
    return out or [YFinanceNewsSource()]


# ============================================================ pipeline

def _utc_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _resolve_ttl(ttl: float | None) -> float:
    if ttl is not None:
        return float(ttl)
    env = os.environ.get(ENV_TTL, "").strip()
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    return DEFAULT_TTL_SECONDS


def _dedup_key(item: NewsItem) -> str:
    """Collapse the same story across sources: prefer URL, else normalized title."""
    if item.url:
        return item.url.strip().lower().rstrip("/")
    return " ".join(item.title.lower().split())


def _sort_key(item: NewsItem):
    """Newest-first: parse ISO ``published``; undated items sort last."""
    ts = item.published.strip()
    if ts:
        try:
            dt = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_dt.timezone.utc)
            return (1, dt)
        except ValueError:
            pass
    return (0, _dt.datetime.min.replace(tzinfo=_dt.timezone.utc))


def _aggregate(sources: list[NewsSource], symbol: str, max_items: int) -> list[NewsItem]:
    """Fan the sources, dedup across them, sort newest-first, cap to max_items."""
    seen: dict[str, NewsItem] = {}
    for src in sources:
        try:
            items = src.fetch(symbol)
        except Exception:
            items = []
        for item in items or []:
            key = _dedup_key(item)
            if key and key not in seen:
                seen[key] = item
    ordered = sorted(seen.values(), key=_sort_key, reverse=True)
    return ordered[:max_items]


def news(
    symbol: str,
    data_dir: str | os.PathLike[str] | None = None,
    *,
    sources: list[NewsSource] | None = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    ttl: float | None = None,
    clock: Callable[[], _dt.datetime] | None = None,
) -> dict | None:
    """Aggregated, deduped, sentiment-tagged news for one symbol. None on failure.

    Returns ``{symbol, items: [NewsItem-dict], sentiment}`` where ``sentiment`` is
    the LexiconScorer lean over the item titles (``{score, band, n_headlines,
    method, estimated, ...}``, ``estimated`` always True). Disk-cached under
    ``news_cache/<SYM>.json`` with a short TTL. Returns None only when NO source
    yields any item (unknown symbol / all providers dead) — never fabricated."""
    sym = symbol.upper()
    data_dir = resolve_data_dir(data_dir)
    clock = clock or _utc_now
    ttl = _resolve_ttl(ttl)
    cache = Path(data_dir) / CACHE_DIRNAME / f"{sym}.json"

    if ttl > 0 and cache.is_file():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            fetched_at = _dt.datetime.fromisoformat(str(data["fetched_at"]))
            age = (clock() - fetched_at).total_seconds()
            if 0 <= age < ttl:
                return data["value"]
        except Exception:
            pass  # corrupt/expired cache: refetch

    srcs = sources if sources is not None else get_news_sources()
    items = _aggregate(srcs, sym, max_items)
    if not items:
        return None

    sentiment = score_headlines([it.title for it in items], scorer=LexiconScorer())
    # per_headline duplicates the items list; drop it to keep the payload lean.
    sentiment.pop("per_headline", None)
    value = {
        "symbol": sym,
        "items": [it.as_dict() for it in items],
        "sentiment": sentiment,
    }

    if ttl > 0:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(
                json.dumps(
                    {"fetched_at": clock().isoformat(timespec="seconds"), "value": value},
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass
    return value
