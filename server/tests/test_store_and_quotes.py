"""Store validation (explicit errors on bad shapes) and quote providers.
The Stooq provider is exercised with a stubbed urlopen — no network, ever."""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone

import pytest

from vantage_server.quotes import (
    FixtureQuoteProvider,
    StooqQuoteProvider,
    get_provider,
    resolve_ttl,
    stooq_symbol,
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

def test_fixture_provider_is_default(data_dir, monkeypatch):
    monkeypatch.delenv("VANTAGE_QUOTES", raising=False)
    assert isinstance(get_provider(data_dir), FixtureQuoteProvider)
    monkeypatch.setenv("VANTAGE_QUOTES", "stooq")
    assert isinstance(get_provider(data_dir), StooqQuoteProvider)


def test_fixture_snapshot(snapshot):
    assert snapshot.source == "fixture"
    assert snapshot.stale is False
    assert snapshot.as_of == "2026-07-05T09:30:00-04:00"
    assert snapshot.quotes["VOO"].price == pytest.approx(683.20)
    assert snapshot.quotes["BND"].asset_class == "bonds"
    assert len(snapshot.quotes) == 13


class _StubResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _stub_urlopen(csv_body: str):
    calls = []

    def urlopen(url, timeout=None):
        calls.append(url)
        return _StubResponse(csv_body.encode("utf-8"))

    urlopen.calls = calls
    return urlopen


STOOQ_CSV = (
    "Symbol,Date,Time,Open,High,Low,Close,Volume\n"
    "VOO.US,2026-07-06,16:00:00,690.00,700.00,688.00,697.00,1000\n"
    "IWM.US,2026-07-06,16:00:00,300.00,301.00,290.00,291.00,2000\n"
)


def test_stooq_overlays_prices_on_fixture(data_dir):
    urlopen = _stub_urlopen(STOOQ_CSV)
    snap = StooqQuoteProvider(data_dir, urlopen=urlopen, ttl=0).snapshot()
    assert snap.source == "stooq"
    assert snap.quotes["VOO"].price == pytest.approx(697.00)
    assert snap.quotes["VOO"].day_pct == pytest.approx((697 - 690) / 690 * 100, abs=0.01)
    assert snap.quotes["IWM"].price == pytest.approx(291.00)
    # metadata always comes from the fixture
    assert snap.quotes["VOO"].asset_class == "usEquity"
    assert snap.quotes["CASH"].price == 1
    # symbols Stooq didn't return keep fixture prices and mark the snapshot stale
    assert snap.quotes["NVDA"].price == pytest.approx(194.83)
    assert snap.stale is True
    assert len(urlopen.calls) == 1 and "stooq.com" in urlopen.calls[0]


def test_stooq_nd_rows_skipped(data_dir):
    csv = ("Symbol,Date,Time,Open,High,Low,Close,Volume\n"
           "VOO.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n")
    snap = StooqQuoteProvider(data_dir, urlopen=_stub_urlopen(csv), ttl=0).snapshot()
    assert snap.quotes["VOO"].price == pytest.approx(683.20)  # fixture fallback
    assert snap.stale is True


def test_stooq_failure_degrades_to_fixture_with_stale_flag(data_dir):
    def exploding_urlopen(url, timeout=None):
        raise OSError("network down")

    snap = StooqQuoteProvider(data_dir, urlopen=exploding_urlopen, ttl=0).snapshot()
    assert snap.source == "fixture"  # degraded snapshot is the fixture itself
    assert snap.stale is True
    assert snap.quotes["VOO"].price == pytest.approx(683.20)


# ----------------------------------------------------- stooq symbol mapping

def test_stooq_symbol_mapping():
    assert stooq_symbol("SPY") == "spy.us"
    assert stooq_symbol("brk.b".upper()) == "brk.b.us"


def test_stooq_url_uses_lowercase_dot_us_symbols(data_dir):
    urlopen = _stub_urlopen(STOOQ_CSV)
    StooqQuoteProvider(data_dir, urlopen=urlopen, ttl=0).snapshot()
    url = urlopen.calls[0]
    for sym in ("voo.us", "spy.us", "nvda.us", "iwm.us"):
        assert sym in url
    assert "cash" not in url.lower().split("?")[1]  # CASH is never fetched
    assert "VOO" not in url  # no uppercase leaks


# ------------------------------------------------------------ on-disk cache

@pytest.fixture
def live_dir(tmp_path, data_dir):
    """Writable data dir (quotes.json copy) so the cache can be exercised."""
    (tmp_path / "quotes.json").write_text((data_dir / "quotes.json").read_text(),
                                          encoding="utf-8")
    return tmp_path


T0 = datetime(2026, 7, 5, 13, 30, 0, tzinfo=timezone.utc)


def test_cache_hit_skips_the_network(live_dir):
    urlopen = _stub_urlopen(STOOQ_CSV)
    first = StooqQuoteProvider(live_dir, urlopen=urlopen, ttl=900,
                               clock=lambda: T0).snapshot()
    assert first.quotes["VOO"].price == pytest.approx(697.00)
    assert (live_dir / "quotes_cache.json").is_file()

    def exploding_urlopen(url, timeout=None):
        raise AssertionError("cache hit must not touch the network")

    later = T0 + timedelta(seconds=899)
    second = StooqQuoteProvider(live_dir, urlopen=exploding_urlopen, ttl=900,
                                clock=lambda: later).snapshot()
    assert second.source == "stooq"
    assert second.quotes["VOO"].price == pytest.approx(697.00)
    assert second.as_of == first.as_of  # served as-of the cached fetch time


def test_cache_expiry_refetches(live_dir):
    StooqQuoteProvider(live_dir, urlopen=_stub_urlopen(STOOQ_CSV), ttl=900,
                       clock=lambda: T0).snapshot()
    fresher = STOOQ_CSV.replace("697.00", "701.00")
    urlopen = _stub_urlopen(fresher)
    expired = T0 + timedelta(seconds=901)
    snap = StooqQuoteProvider(live_dir, urlopen=urlopen, ttl=900,
                              clock=lambda: expired).snapshot()
    assert len(urlopen.calls) == 1  # TTL elapsed: fetched again
    assert snap.quotes["VOO"].price == pytest.approx(701.00)


def test_ttl_zero_bypasses_cache(live_dir, monkeypatch):
    StooqQuoteProvider(live_dir, urlopen=_stub_urlopen(STOOQ_CSV), ttl=900,
                       clock=lambda: T0).snapshot()
    monkeypatch.setenv("VANTAGE_QUOTES_TTL", "0")
    urlopen = _stub_urlopen(STOOQ_CSV.replace("697.00", "703.00"))
    snap = StooqQuoteProvider(live_dir, urlopen=urlopen,
                              clock=lambda: T0).snapshot()  # ttl from env
    assert len(urlopen.calls) == 1  # cache bypassed despite being fresh
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
    (live_dir / "quotes_cache.json").write_text("{broken", encoding="utf-8")
    urlopen = _stub_urlopen(STOOQ_CSV)
    snap = StooqQuoteProvider(live_dir, urlopen=urlopen, ttl=900,
                              clock=lambda: T0).snapshot()
    assert len(urlopen.calls) == 1  # fell through to a real fetch
    assert snap.quotes["VOO"].price == pytest.approx(697.00)


def test_resolve_data_dir_prefers_local_over_fixtures(monkeypatch, tmp_path):
    """env > data-local (when present) > fixtures — real data never mixes with the oracle."""
    from vantage_server import store as store_mod

    monkeypatch.delenv(store_mod.ENV_DATA_DIR, raising=False)
    local = tmp_path / "data-local"
    monkeypatch.setattr(store_mod, "LOCAL_DATA_DIR", local)
    assert store_mod.resolve_data_dir() == store_mod.DEFAULT_DATA_DIR  # absent → fixtures
    local.mkdir()
    assert store_mod.resolve_data_dir() == local  # present → real data wins
    monkeypatch.setenv(store_mod.ENV_DATA_DIR, str(tmp_path / "explicit"))
    assert store_mod.resolve_data_dir() == tmp_path / "explicit"  # env wins over both
    assert store_mod.resolve_data_dir(tmp_path / "arg") == tmp_path / "arg"  # arg wins
