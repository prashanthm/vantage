"""Nightly 1m-SPX seed — backfills a rolling window into intraday_bars, idempotent."""
import datetime as dt

from vantage_server import seed_intraday as si


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _fake_ohlc(day):
    return {"ts": [f"{day}T09:30:00-04:00", f"{day}T09:31:00-04:00"],
            "open": [7500, 7501], "high": [7502, 7503],
            "low": [7499, 7500], "close": [7501, 7502], "volume": [100, 120]}


def test_trading_days_are_weekdays_newest_first():
    days = si._trading_days(30, dt.date(2026, 7, 16))
    assert len(days) == 30
    assert days[0] == "2026-07-16"                      # newest first
    assert all(dt.date.fromisoformat(d).weekday() < 5 for d in days)  # no weekends


def test_seed_fetches_missing_skips_present(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    # pre-seed one day so it's skipped
    store.save_intraday_bars("^GSPC", "2026-07-16", "1m", _fake_ohlc("2026-07-16"))
    calls = []

    def _fake_fetch(symbol, day):
        calls.append(day)
        # only "fetch" a couple of days, rest unavailable (None)
        return _fake_ohlc(day) if day in ("2026-07-15", "2026-07-14") else None

    monkeypatch.setattr(si, "_rth_1m", _fake_fetch)
    out = si.seed(store, days=5, today=dt.date(2026, 7, 16))
    assert out["already_had"] == 1                      # 07-16 skipped, not fetched
    assert "2026-07-16" not in calls
    assert out["fetched"] == 2                          # 07-15 + 07-14
    assert out["unavailable"] >= 1                      # the rest returned None
    # the fetched days landed
    assert store.load_intraday_bars("^GSPC", "2026-07-15", "1m") is not None


def test_seed_force_refetches(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    store.save_intraday_bars("^GSPC", "2026-07-16", "1m", _fake_ohlc("2026-07-16"))
    monkeypatch.setattr(si, "_rth_1m", lambda s, d: _fake_ohlc(d))
    out = si.seed(store, days=1, today=dt.date(2026, 7, 16), force=True)
    assert out["fetched"] == 1 and out["already_had"] == 0   # force re-fetches
