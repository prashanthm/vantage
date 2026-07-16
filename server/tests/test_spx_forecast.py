"""SPX forecast persistence + accuracy scoring."""
from vantage_server import spx_snapshot as ss


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _seed(store, day="2026-07-16"):
    # bars: flat at 7550 until 12:00, then a clean rise to 7580
    ts, hi, lo, cl, op, vol = [], [], [], [], [], []
    for i in range(60):
        t = f"{day}T{9 + (30 + i)//60:02d}:{(30 + i) % 60:02d}:00-04:00"
        c = 7550.0 if i < 30 else 7550.0 + (i - 30)   # rise after bar 30 (~10:00)
        ts.append(t); cl.append(c); op.append(c - 0.2)
        hi.append(c + 1); lo.append(c - 1); vol.append(1000)
    store.save_intraday_bars("^GSPC", day, "1m",
                             {"ts": ts, "open": op, "high": hi, "low": lo,
                              "close": cl, "volume": vol})
    return ts


def test_save_list_load_roundtrip(tmp_path):
    store = _sqlite_store(tmp_path)
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of="2026-07-16T10:00:00-04:00",
        price_at=7550.0, snapshot={"price": 7550.0, "day": "2026-07-16"},
        forecast={"bias": "up", "target": 7570, "invalidation": 7540},
        forecast_text="reaches 7570 before 7540")
    assert fid
    lst = store.list_spx_forecasts("SPX")
    assert len(lst) == 1 and lst[0]["id"] == fid
    row = store.load_spx_forecast(fid)
    assert row["forecast"]["bias"] == "up" and row["price_at"] == 7550.0
    assert row["score"] is None            # unscored


def test_score_hit_target(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed(store)   # rises to 7580 after 10:00
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of="2026-07-16T10:00:00-04:00",
        price_at=7550.0, snapshot={"price": 7550.0, "day": "2026-07-16"},
        forecast={"bias": "up", "target": 7570, "invalidation": 7540},
        forecast_text="up to 7570")
    score = ss.score_forecast(store, store.load_spx_forecast(fid))
    assert score is not None
    assert score["verdict"] == "hit target"
    assert score["direction_ok"] is True
    assert score["moved_pt"] > 0


def test_score_direction_wrong(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed(store)   # actually rises
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of="2026-07-16T10:00:00-04:00",
        price_at=7550.0, snapshot={"price": 7550.0, "day": "2026-07-16"},
        forecast={"bias": "down", "target": 7530, "invalidation": 7560},
        forecast_text="down to 7530")
    score = ss.score_forecast(store, store.load_spx_forecast(fid))
    # price rose, so a down call is invalidated / wrong
    assert score["verdict"] in ("invalidated", "direction wrong")


def test_score_too_early_returns_none(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed(store)
    # as_of after the LAST bar → no future bars → unscoreable
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of="2026-07-16T23:00:00-04:00",
        price_at=7580.0, snapshot={"price": 7580.0, "day": "2026-07-16"},
        forecast={"bias": "up", "target": 7600, "invalidation": 7560},
        forecast_text="late")
    assert ss.score_forecast(store, store.load_spx_forecast(fid)) is None


def test_score_reads_a2ui_keyvals_forecast(tmp_path):
    # the analyst emits bias/target/invalidation as A2UI keyvals rows, not top-level
    store = _sqlite_store(tmp_path)
    _seed(store)
    a2ui = {"headline": "up into 7570", "sections": [
        {"kind": "keyvals", "rows": [
            {"k": "Bias", "v": "up"},
            {"k": "Target", "v": "7570"},
            {"k": "Invalidation", "v": "7540"},
        ]}]}
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of="2026-07-16T10:00:00-04:00",
        price_at=7550.0, snapshot={"price": 7550.0, "day": "2026-07-16"},
        forecast=a2ui, forecast_text="")
    score = ss.score_forecast(store, store.load_spx_forecast(fid))
    assert score["verdict"] == "hit target"
