"""The EOD snapshot CLI — file writes (with backup) and the orchestration run
with a STUBBED broker connection. No network, no real data dir touched."""
from __future__ import annotations

import datetime as _dt
import json

import pytest

from vantage_server import snapshot_bars as snap
from vantage_server.brokers import robinhood


DAILY = [
    {"date": "2026-06-01", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
    {"date": "2026-06-02", "open": 11, "high": 13, "low": 10, "close": 12, "volume": 100},
    {"date": "2026-06-08", "open": 12, "high": 15, "low": 8, "close": 14, "volume": 200},
]


def test_write_bars_writes_series_and_backs_up(tmp_path):
    series = {"daily": DAILY, "weekly": [], "monthly": []}
    path, backup = snap.write_bars(tmp_path, "pltr", series, as_of="2026-07-05",
                                   lookback_days=400,
                                   now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    assert path == tmp_path / "bars" / "PLTR.json"
    assert backup is None
    data = json.loads(path.read_text())
    assert data["symbol"] == "PLTR"
    assert data["as_of"] == "2026-07-05"
    assert data["lookback_days"] == 400
    assert data["daily"] == DAILY

    # second write backs the previous file up
    path2, backup2 = snap.write_bars(tmp_path, "PLTR", series, as_of="2026-07-06",
                                     lookback_days=400,
                                     now=_dt.datetime(2026, 7, 6, 21, 0, 0))
    assert backup2 == tmp_path / "bars" / "PLTR.json.bak-2026-07-06T21-00-00"
    assert backup2.is_file()


def test_run_snapshots_explicit_symbols_with_stubbed_connection(tmp_path, monkeypatch):
    class StubConn:
        def fetch_historicals(self, symbol, *, start_time, interval="day"):
            return DAILY if symbol in ("SOXS", "PLTR") else []

    monkeypatch.setattr(snap, "get_connection", lambda broker: (lambda: StubConn()))
    monkeypatch.setattr(snap, "CONNECTIONS", {"robinhood": StubConn})

    rc = snap.main(["--broker", "robinhood", "--data-dir", str(tmp_path),
                    "--as-of", "2026-07-05", "SOXS", "PLTR"])
    assert rc == snap.EXIT_OK
    for sym in ("SOXS", "PLTR"):
        data = json.loads((tmp_path / "bars" / f"{sym}.json").read_text())
        assert data["daily"] == DAILY
        assert data["weekly"]      # derived
        assert data["monthly"]


def test_run_requires_symbols(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(snap, "CONNECTIONS", {"robinhood": object})
    rc = snap.main(["--broker", "robinhood", "--data-dir", str(tmp_path)])
    assert rc == snap.EXIT_USER_ERROR
    assert "no symbols" in capsys.readouterr().err


def test_run_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    class StubConn:
        def fetch_historicals(self, symbol, *, start_time, interval="day"):
            return DAILY

    monkeypatch.setattr(snap, "get_connection", lambda broker: (lambda: StubConn()))
    monkeypatch.setattr(snap, "CONNECTIONS", {"robinhood": StubConn})
    rc = snap.main(["--broker", "robinhood", "--data-dir", str(tmp_path),
                    "--dry-run", "SOXS"])
    assert rc == snap.EXIT_OK
    assert not (tmp_path / "bars").exists()
    assert "[dry-run]" in capsys.readouterr().out


def test_snapshot_bars_default_fetch_is_robinhood(monkeypatch):
    """The orchestrator wires to robinhood.fetch_historicals when no fetch is
    injected — the read-only broker path."""
    seen = []
    monkeypatch.setattr(robinhood, "fetch_historicals",
                        lambda symbol, *, start_time, interval="day":
                        seen.append(symbol) or DAILY)
    from vantage_server.bars import snapshot_bars
    out = snapshot_bars(["SNK"], today=_dt.date(2026, 7, 5))
    assert seen == ["SNK"]
    assert out["SNK"]["daily"] == DAILY


def test_underlying_extraction():
    from vantage_server.snapshot_bars import _underlying
    assert _underlying("PLTR") == "PLTR"
    assert _underlying("SOXL 2026-07-10 178C") == "SOXL"  # option → underlying
    assert _underlying("spy 2026-01-16 500p") == "SPY"    # case-insensitive
    assert _underlying("CASH") is None                    # sleeves dropped
    assert _underlying("CRYPTO") is None
    assert _underlying("FUTURES") is None
    assert _underlying("") is None
