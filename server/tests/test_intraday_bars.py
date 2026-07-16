"""Persist per-session 1m intraday bars so real FVG entries can be tested at 1m
resolution after yfinance's intraday retention rolls past."""
import pandas as pd
import pytest

from vantage_server import session_activity as sa


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _df():
    idx = pd.to_datetime([
        "2026-07-16T09:30:00-04:00", "2026-07-16T09:31:00-04:00",
        "2026-07-16T09:32:00-04:00",
    ])
    return pd.DataFrame({
        "Open": [7500, 7501, 7502], "High": [7502, 7503, 7505],
        "Low": [7499, 7500, 7501], "Close": [7501, 7502, 7504],
        "Volume": [100, 120, 90],
    }, index=idx)


def test_save_load_roundtrip(tmp_path):
    store = _sqlite_store(tmp_path)
    ohlc = sa._df_to_ohlc(_df())
    assert store.save_intraday_bars("^GSPC", "2026-07-16", "1m", ohlc) is True
    back = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    assert back and len(back["ts"]) == 3
    df = sa._ohlc_to_df(back)
    assert df.shape == (3, 5)
    assert float(df["Close"].iloc[-1]) == 7504.0
    assert float(df["High"].iloc[2]) == 7505.0


def test_save_is_idempotent_overwrite(tmp_path):
    store = _sqlite_store(tmp_path)
    ohlc = sa._df_to_ohlc(_df())
    store.save_intraday_bars("^GSPC", "2026-07-16", "1m", ohlc)
    store.save_intraday_bars("^GSPC", "2026-07-16", "1m", ohlc)   # again
    back = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    assert len(back["ts"]) == 3   # one row, not doubled


def test_load_missing_returns_none(tmp_path):
    store = _sqlite_store(tmp_path)
    assert store.load_intraday_bars("^GSPC", "2020-01-01", "1m") is None


def test_save_empty_is_noop(tmp_path):
    store = _sqlite_store(tmp_path)
    assert store.save_intraday_bars("^GSPC", "2026-07-16", "1m", {}) is False
    assert store.save_intraday_bars("^GSPC", "2026-07-16", "1m", {"ts": []}) is False


def test_intraday_bars_reads_store_when_live_fetch_fails(tmp_path, monkeypatch):
    # simulate: 1m fetch dead → the stored capture is used before dropping to 15m
    store = _sqlite_store(tmp_path)
    store.save_intraday_bars("^GSPC", "2026-07-16", "1m", sa._df_to_ohlc(_df()))

    class _DeadTicker:
        def __init__(self, *a, **k): pass
        def history(self, *a, **k): return pd.DataFrame()   # empty → "no 1m"

    monkeypatch.setattr("yfinance.Ticker", _DeadTicker)
    out = sa._intraday_bars("^GSPC", "2026-07-16", store=store)
    assert out is not None and len(out) == 3   # served from the store, not 15m
