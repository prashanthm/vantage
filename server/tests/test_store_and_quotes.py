"""Store validation (explicit errors on bad shapes) and quote providers.
The Stooq provider is exercised with a stubbed urlopen — no network, ever."""
from __future__ import annotations

import io
import json

import pytest

from vantage_server.quotes import FixtureQuoteProvider, StooqQuoteProvider, get_provider
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
    snap = StooqQuoteProvider(data_dir, urlopen=urlopen).snapshot()
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
    snap = StooqQuoteProvider(data_dir, urlopen=_stub_urlopen(csv)).snapshot()
    assert snap.quotes["VOO"].price == pytest.approx(683.20)  # fixture fallback
    assert snap.stale is True


def test_stooq_failure_degrades_to_fixture_with_stale_flag(data_dir):
    def exploding_urlopen(url, timeout=None):
        raise OSError("network down")

    snap = StooqQuoteProvider(data_dir, urlopen=exploding_urlopen).snapshot()
    assert snap.source == "fixture"  # degraded snapshot is the fixture itself
    assert snap.stale is True
    assert snap.quotes["VOO"].price == pytest.approx(683.20)
