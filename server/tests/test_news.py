"""News pipeline: projection, multi-source dedup, sentiment lean, cache, failure.

All tests use injected stub sources (or an injected raw yfinance fetch) so none
touch the network. The disk cache is exercised at a temp dir.
"""
from __future__ import annotations

import datetime as _dt
import json

from vantage_server import news as N
from vantage_server.news import NewsItem, YFinanceNewsSource, news


class _StubSource:
    def __init__(self, name, items):
        self.name = name
        self._items = items

    def fetch(self, symbol):
        return list(self._items)


def _item(title, *, url="", published="", source="stub", publisher="Pub"):
    return NewsItem(title=title, summary="", publisher=publisher,
                    published=published, url=url, source=source)


# ------------------------------------------------------------ yfinance projection

def test_yfinance_source_projects_nested_content():
    raw = [
        {"content": {
            "title": "ACME beats earnings",
            "summary": "strong quarter",
            "provider": {"displayName": "Reuters"},
            "pubDate": "2026-07-05T12:00:00Z",
            "canonicalUrl": {"url": "https://x/1"},
        }},
        {"content": {"title": ""}},  # titleless -> dropped
    ]
    src = YFinanceNewsSource(fetch=lambda s: raw)
    items = src.fetch("ACME")
    assert len(items) == 1
    it = items[0]
    assert it.title == "ACME beats earnings"
    assert it.publisher == "Reuters"
    assert it.url == "https://x/1"
    assert it.source == "yfinance"


def test_yfinance_source_never_raises_on_bad_fetch():
    src = YFinanceNewsSource(fetch=lambda s: (_ for _ in ()).throw(RuntimeError("boom")))
    assert src.fetch("ACME") == []


# ------------------------------------------------------------ pipeline: dedup

def test_two_sources_dedup_by_url(tmp_path):
    a = _StubSource("a", [_item("Same story", url="https://x/1", source="a")])
    b = _StubSource("b", [_item("Same story (rewrite)", url="https://x/1/", source="b")])
    out = news("ACME", tmp_path, sources=[a, b], ttl=0)
    assert out is not None
    assert len(out["items"]) == 1  # trailing-slash normalized, deduped
    assert out["items"][0]["source"] == "a"  # first source wins


def test_dedup_by_title_when_no_url(tmp_path):
    a = _StubSource("a", [_item("Big News Today", source="a")])
    b = _StubSource("b", [_item("big news today", source="b")])
    out = news("ACME", tmp_path, sources=[a, b], ttl=0)
    assert len(out["items"]) == 1


def test_distinct_items_all_kept(tmp_path):
    a = _StubSource("a", [_item("One", url="https://x/1"), _item("Two", url="https://x/2")])
    out = news("ACME", tmp_path, sources=[a], ttl=0)
    assert len(out["items"]) == 2


# ------------------------------------------------------------ pipeline: sort

def test_sorted_newest_first(tmp_path):
    a = _StubSource("a", [
        _item("older", url="https://x/1", published="2026-07-01T00:00:00Z"),
        _item("newer", url="https://x/2", published="2026-07-05T00:00:00Z"),
    ])
    out = news("ACME", tmp_path, sources=[a], ttl=0)
    assert [i["title"] for i in out["items"]] == ["newer", "older"]


# ------------------------------------------------------------ pipeline: sentiment

def test_sentiment_lean_positive(tmp_path):
    a = _StubSource("a", [
        _item("ACME surges after record profit", url="https://x/1"),
        _item("ACME beats and raises guidance", url="https://x/2"),
    ])
    out = news("ACME", tmp_path, sources=[a], ttl=0)
    s = out["sentiment"]
    assert s["band"] == "positive"
    assert s["estimated"] is True
    assert s["method"] == "lexicon"
    assert "per_headline" not in s  # trimmed from payload


# ------------------------------------------------------------ pipeline: failure

def test_no_items_returns_none(tmp_path):
    empty = _StubSource("a", [])
    assert news("NOPE", tmp_path, sources=[empty], ttl=0) is None


def test_source_failure_is_swallowed(tmp_path):
    class _Boom:
        name = "boom"

        def fetch(self, symbol):
            raise RuntimeError("down")

    good = _StubSource("good", [_item("Still here", url="https://x/1")])
    out = news("ACME", tmp_path, sources=[_Boom(), good], ttl=0)
    assert out is not None
    assert len(out["items"]) == 1


# ------------------------------------------------------------ cache

def test_cache_roundtrip_and_ttl(tmp_path):
    calls = {"n": 0}

    class _Counting:
        name = "c"

        def fetch(self, symbol):
            calls["n"] += 1
            return [_item("cached", url="https://x/1")]

    src = _Counting()
    now = _dt.datetime(2026, 7, 5, tzinfo=_dt.timezone.utc)
    out1 = news("ACME", tmp_path, sources=[src], ttl=1800, clock=lambda: now)
    assert out1 is not None
    assert calls["n"] == 1
    # within TTL -> served from disk, no re-fetch
    out2 = news("ACME", tmp_path, sources=[src], ttl=1800,
                clock=lambda: now + _dt.timedelta(seconds=60))
    assert calls["n"] == 1
    assert out2 == out1
    # past TTL -> refetch
    news("ACME", tmp_path, sources=[src], ttl=1800,
         clock=lambda: now + _dt.timedelta(seconds=3600))
    assert calls["n"] == 2
    # cache file exists and is well-formed
    cache = tmp_path / N.CACHE_DIRNAME / "ACME.json"
    assert cache.is_file()
    data = json.loads(cache.read_text())
    assert data["value"]["symbol"] == "ACME"


# ------------------------------------------------------------ source registry

def test_get_news_sources_default_and_unknown(monkeypatch):
    monkeypatch.delenv("VANTAGE_NEWS_SOURCES", raising=False)
    assert [s.name for s in N.get_news_sources()] == ["yfinance"]
    # unknown names ignored; falls back to yfinance
    assert [s.name for s in N.get_news_sources("nope,alsobad")] == ["yfinance"]
    assert [s.name for s in N.get_news_sources("yfinance")] == ["yfinance"]
