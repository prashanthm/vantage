"""Store validation (explicit errors on bad shapes) and quote providers.
The Stooq provider is exercised with a stubbed urlopen — no network, ever."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from vantage_server.quotes import (
    FixtureQuoteProvider,
    YFinanceQuoteProvider,
    get_provider,
    resolve_ttl,
)
from vantage_server.store import Store, StoreError


# ------------------------------------------------------------------ store

def test_loads_fixture_dataset(dataset):
    assert len(dataset.accounts) == 4
    assert len(dataset.lots) == 18
    assert len(dataset.recent_buys) == 3
    assert len(dataset.auto_buys) == 2
    assert dataset.partner_map["IWM"] == "IJR"


def _write(tmp_path, name, payload):
    (tmp_path / name).write_text(json.dumps(payload), encoding="utf-8")


def test_missing_file_is_explicit(tmp_path):
    with pytest.raises(StoreError, match="accounts.json.*not found"):
        Store(tmp_path).load_accounts()


def test_invalid_json_is_explicit(tmp_path):
    (tmp_path / "lots.json").write_text("{nope", encoding="utf-8")
    with pytest.raises(StoreError, match="invalid JSON"):
        Store(tmp_path).load_lots()


def test_missing_key_is_explicit(tmp_path):
    _write(tmp_path, "lots.json",
           [{"account": "a", "symbol": "VOO", "date": "2026-01-01", "shares": 1}])
    with pytest.raises(StoreError, match="cost_per_share"):
        Store(tmp_path).load_lots()


def test_wrong_type_is_explicit(tmp_path):
    _write(tmp_path, "lots.json",
           [{"account": "a", "symbol": "VOO", "date": "2026-01-01",
             "shares": "ten", "cost_per_share": 1}])
    with pytest.raises(StoreError, match="shares"):
        Store(tmp_path).load_lots()


def test_non_positive_shares_rejected(tmp_path):
    _write(tmp_path, "lots.json",
           [{"account": "a", "symbol": "VOO", "date": "2026-01-01",
             "shares": 0, "cost_per_share": 1}])
    with pytest.raises(StoreError, match="non-positive shares"):
        Store(tmp_path).load_lots()


def test_load_history_missing_file_is_empty_list(data_dir):
    # the fixture data dir never has a history.json — empty state, no error
    assert Store(data_dir).load_history() == []


def test_load_history_sorts_newest_first_and_drops_non_dicts(tmp_path):
    _write(tmp_path, "history.json", [
        {"account": "a", "date": "2026-06-30T14:00:00Z", "symbol": "OLD"},
        "not-a-row",
        {"account": "a", "date": "2026-07-03T10:00:00Z", "symbol": "NEW"},
    ])
    rows = Store(tmp_path).load_history()
    assert [r["symbol"] for r in rows] == ["NEW", "OLD"]


def test_load_history_rejects_non_array(tmp_path):
    _write(tmp_path, "history.json", {"not": "a list"})
    with pytest.raises(StoreError, match="top level must be a JSON array"):
        Store(tmp_path).load_history()


def test_load_strategies_missing_file_is_empty_rollup(data_dir):
    # the fixture data dir never has a strategies.json — empty state, no error
    assert Store(data_dir).load_strategies() == {
        "open": [], "closed": [], "by_ticker": [], "as_of": None}


def test_load_strategies_reads_open_closed_and_as_of(tmp_path):
    _write(tmp_path, "strategies.json", {
        "open": [{"underlying": "PLTR", "kind": "vertical"}, "junk"],
        "closed": [{"order_id": "oo-1"}],
        "by_ticker": [{"underlying": "SOXS", "spans_expiries": True}, "junk"],
        "as_of": "2026-07-05",
    })
    rollup = Store(tmp_path).load_strategies()
    assert [s["underlying"] for s in rollup["open"]] == ["PLTR"]  # non-dict dropped
    assert rollup["closed"][0]["order_id"] == "oo-1"
    assert [b["underlying"] for b in rollup["by_ticker"]] == ["SOXS"]  # non-dict dropped
    assert rollup["as_of"] == "2026-07-05"


def test_load_strategies_tolerates_missing_sections(tmp_path):
    _write(tmp_path, "strategies.json", {"as_of": "2026-07-05"})
    rollup = Store(tmp_path).load_strategies()
    assert rollup["open"] == [] and rollup["closed"] == []
    assert rollup["by_ticker"] == []  # absent by_ticker degrades to empty list


def test_load_strategies_rejects_non_object(tmp_path):
    _write(tmp_path, "strategies.json", ["not", "an", "object"])
    with pytest.raises(StoreError, match="must be a JSON object"):
        Store(tmp_path).load_strategies()


def test_partner_map_shape_enforced(tmp_path):
    _write(tmp_path, "partner_map.json", ["VOO", "VTI"])
    with pytest.raises(StoreError, match="partner_map"):
        Store(tmp_path).load_partner_map()


def test_unknown_account_reference_rejected(tmp_path, data_dir):
    for name in ("accounts.json", "recent_buys.json", "auto_buys.json", "partner_map.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    _write(tmp_path, "lots.json",
           [{"account": "ghost", "symbol": "VOO", "date": "2026-01-01",
             "shares": 1, "cost_per_share": 1}])
    with pytest.raises(StoreError, match="unknown account 'ghost'"):
        Store(tmp_path).load_dataset()


def test_env_data_dir_respected(tmp_path, monkeypatch):
    monkeypatch.setenv("VANTAGE_DATA_DIR", str(tmp_path))
    assert Store().data_dir == tmp_path


# --------------------------------------------------------------- providers
#
# yfinance is the default/real provider; the fixture provider is a test seam
# selected only by VANTAGE_QUOTES=fixture. The yfinance provider's network I/O
# is an injected `fetch(symbols) -> {SYMBOL: (last, prev_close)}` callable, so
# these tests never touch Yahoo.

def test_yfinance_provider_is_default(data_dir, monkeypatch):
    monkeypatch.delenv("VANTAGE_QUOTES", raising=False)
    assert isinstance(get_provider(data_dir), YFinanceQuoteProvider)
    monkeypatch.setenv("VANTAGE_QUOTES", "fixture")
    assert isinstance(get_provider(data_dir), FixtureQuoteProvider)


def test_fixture_snapshot(snapshot):
    # The fixture provider (test seam) reads the synthetic quotes.json verbatim.
    assert snapshot.source == "fixture"
    assert snapshot.stale is False
    assert snapshot.quotes["VOO"].price == pytest.approx(683.20)
    assert snapshot.quotes["BND"].asset_class == "bonds"


def _stub_fetch(rows: dict):
    """Return a fetch callable that yields {SYMBOL: (last, prev)} and records calls."""
    calls = []

    def fetch(symbols):
        calls.append(list(symbols))
        return {s: rows[s] for s in symbols if s in rows}

    fetch.calls = calls
    return fetch


# last, prev_close pairs — VOO up, IWM down.
YF_ROWS = {"VOO": (697.00, 690.00), "IWM": (291.00, 300.00)}


def test_yfinance_overlays_real_prices(data_dir):
    fetch = _stub_fetch(YF_ROWS)
    snap = YFinanceQuoteProvider(data_dir, fetch=fetch, ttl=0).snapshot()
    assert snap.source == "yfinance"
    assert snap.quotes["VOO"].price == pytest.approx(697.00)
    assert snap.quotes["VOO"].day_pct == pytest.approx((697 - 690) / 690 * 100, abs=0.01)
    assert snap.quotes["IWM"].price == pytest.approx(291.00)
    # metadata always comes from the stored base snapshot
    assert snap.quotes["VOO"].asset_class == "usEquity"
    assert snap.quotes["CASH"].price == 1
    # a held equity Yahoo didn't return keeps its stored price and flags stale
    assert snap.quotes["NVDA"].price == pytest.approx(194.83)
    assert snap.stale is True
    assert len(fetch.calls) == 1


def test_yfinance_failure_degrades_to_stored_with_stale_flag(data_dir):
    def exploding_fetch(symbols):
        raise OSError("network down")

    snap = YFinanceQuoteProvider(data_dir, fetch=exploding_fetch, ttl=0).snapshot()
    assert snap.source == "yfinance"  # the stored snapshot, flagged stale
    assert snap.stale is True
    assert snap.quotes["VOO"].price == pytest.approx(683.20)


def test_yfinance_never_fetches_importer_maintained_symbols(tmp_path):
    """Option marks, CRYPTO/FUTURES sleeves, CASH, and numeric CUSIPs are
    excluded from the Yahoo fetch and never flag staleness when absent."""
    (tmp_path / "quotes.json").write_text(json.dumps({
        "as_of": "2026-07-05T09:30:00-04:00",
        "quotes": {
            "VOO": {"name": "V", "price": 683.2, "day_pct": -0.12,
                    "asset_class": "usEquity"},
            "SOXL 2026-07-10 178C": {"name": "opt", "price": 2195.0,
                                     "day_pct": 0, "asset_class": "options"},
            "CRYPTO": {"name": "c", "price": 1, "day_pct": 0, "asset_class": "crypto"},
            "CASH": {"name": "cash", "price": 1, "day_pct": 0, "asset_class": "cash"},
        },
    }), encoding="utf-8")
    fetch = _stub_fetch({"VOO": (697.00, 690.00)})
    snap = YFinanceQuoteProvider(tmp_path, fetch=fetch, ttl=0).snapshot()
    requested = set(fetch.calls[0])
    assert "SOXL 2026-07-10 178C" not in requested
    assert "CRYPTO" not in requested and "CASH" not in requested
    assert snap.quotes["VOO"].price == pytest.approx(697.00)
    assert snap.quotes["SOXL 2026-07-10 178C"].price == pytest.approx(2195.0)
    assert snap.quotes["CRYPTO"].price == 1
    assert snap.stale is False  # synthetic symbols never flag staleness


# ------------------------------------------------------------ on-disk cache

@pytest.fixture
def live_dir(tmp_path, data_dir):
    """Writable data dir (quotes.json copy) so the cache can be exercised."""
    (tmp_path / "quotes.json").write_text((data_dir / "quotes.json").read_text(),
                                          encoding="utf-8")
    return tmp_path


T0 = datetime(2026, 7, 5, 13, 30, 0, tzinfo=timezone.utc)


def test_cache_hit_skips_the_network(live_dir):
    fetch = _stub_fetch(YF_ROWS)
    first = YFinanceQuoteProvider(live_dir, fetch=fetch, ttl=900,
                                  clock=lambda: T0).snapshot()
    assert first.quotes["VOO"].price == pytest.approx(697.00)
    assert (live_dir / "quotes_cache_yf.json").is_file()

    def exploding_fetch(symbols):
        raise AssertionError("cache hit must not touch the network")

    later = T0 + timedelta(seconds=899)
    second = YFinanceQuoteProvider(live_dir, fetch=exploding_fetch, ttl=900,
                                   clock=lambda: later).snapshot()
    assert second.source == "yfinance"
    assert second.quotes["VOO"].price == pytest.approx(697.00)
    assert second.as_of == first.as_of  # served as-of the cached fetch time


def test_cache_expiry_refetches(live_dir):
    YFinanceQuoteProvider(live_dir, fetch=_stub_fetch(YF_ROWS), ttl=900,
                          clock=lambda: T0).snapshot()
    fetch = _stub_fetch({"VOO": (701.00, 690.00), "IWM": (291.00, 300.00)})
    expired = T0 + timedelta(seconds=901)
    snap = YFinanceQuoteProvider(live_dir, fetch=fetch, ttl=900,
                                 clock=lambda: expired).snapshot()
    assert len(fetch.calls) == 1  # TTL elapsed: fetched again
    assert snap.quotes["VOO"].price == pytest.approx(701.00)


def test_ttl_zero_bypasses_cache(live_dir, monkeypatch):
    YFinanceQuoteProvider(live_dir, fetch=_stub_fetch(YF_ROWS), ttl=900,
                          clock=lambda: T0).snapshot()
    monkeypatch.setenv("VANTAGE_QUOTES_TTL", "0")
    fetch = _stub_fetch({"VOO": (703.00, 690.00), "IWM": (291.00, 300.00)})
    snap = YFinanceQuoteProvider(live_dir, fetch=fetch,
                                 clock=lambda: T0).snapshot()  # ttl from env
    assert len(fetch.calls) == 1  # cache bypassed despite being fresh
    assert snap.quotes["VOO"].price == pytest.approx(703.00)


def test_ttl_resolution_order(monkeypatch):
    monkeypatch.delenv("VANTAGE_QUOTES_TTL", raising=False)
    assert resolve_ttl() == 900.0
    monkeypatch.setenv("VANTAGE_QUOTES_TTL", "60")
    assert resolve_ttl() == 60.0
    assert resolve_ttl(120) == 120.0  # explicit arg beats env
    monkeypatch.setenv("VANTAGE_QUOTES_TTL", "not-a-number")
    assert resolve_ttl() == 900.0


def test_corrupt_cache_is_ignored(live_dir):
    (live_dir / "quotes_cache_yf.json").write_text("{broken", encoding="utf-8")
    fetch = _stub_fetch(YF_ROWS)
    snap = YFinanceQuoteProvider(live_dir, fetch=fetch, ttl=900,
                                 clock=lambda: T0).snapshot()
    assert len(fetch.calls) == 1  # fell through to a real fetch
    assert snap.quotes["VOO"].price == pytest.approx(697.00)


def test_resolve_data_dir_prefers_env_and_local(monkeypatch, tmp_path):
    """arg > env > data-local. There is no fixture fallback — data-local is the
    floor (empty until a broker is imported)."""
    from vantage_server import store as store_mod

    monkeypatch.delenv(store_mod.ENV_DATA_DIR, raising=False)
    local = tmp_path / "data-local"
    monkeypatch.setattr(store_mod, "LOCAL_DATA_DIR", local)
    assert store_mod.resolve_data_dir() == local  # floor is data-local, no demo fallback
    monkeypatch.setenv(store_mod.ENV_DATA_DIR, str(tmp_path / "explicit"))
    assert store_mod.resolve_data_dir() == tmp_path / "explicit"  # env wins over local
    assert store_mod.resolve_data_dir(tmp_path / "arg") == tmp_path / "arg"  # arg wins over all
