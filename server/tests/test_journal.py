"""Chart journal: forecast capture, level held/broke scoring, regime + accuracy."""
from __future__ import annotations

from vantage_server import journal as j


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _scaffold():
    return {
        "session": "2026-07-13", "generated_for": "2026-07-10",
        "regime": {"spot": 7543.0, "gamma": "positive", "vix": 16.0},
        "level_ladder": [{"kind": "gamma flip (regime line)", "price": 7477.0, "source": "GEX"}],
        "table": {"read": "above 7477 = range; fade rips 7547",
                  "structure_note": "trending up",
                  "rows": [
                      {"key": "E", "price": 7547.0, "role": "resistance", "label": "resistance (5x)", "confluence": True},
                      {"key": "H", "price": 7490.0, "role": "support", "label": "support (8x)", "confluence": True},
                      {"key": "A", "price": 7621.0, "role": "resistance", "label": "durable", "durable": True},
                  ]},
    }


# ------------------------------------------------------------ forecast capture

def test_forecast_from_scaffold():
    fc = j.forecast_from_scaffold(_scaffold())
    assert fc["gamma"] == "positive" and fc["spot"] == 7543.0
    assert fc["gamma_flip"] == 7477.0
    assert len(fc["levels"]) == 3
    e = next(l for l in fc["levels"] if l["key"] == "E")
    assert e["role"] == "resistance" and e["price"] == 7547.0


# ------------------------------------------------------------ scoring

def test_score_resistance_broken():
    fc = j.forecast_from_scaffold(_scaffold())
    # price ran 7534–7575 and closed at 7575 → 7547 resistance BROKEN, others untested
    sc = j.score_forecast(fc, price_low=7534, price_high=7575, price_last=7575, spot_at_snap=7543)
    v = {l["key"]: l["verdict"] for l in sc["levels"]}
    assert v["E"] == "broken"
    assert v["H"] == "untested" and v["A"] == "untested"
    # regime: positive gamma predicted a range; 0.42% move = held → correct
    assert sc["regime"]["correct"] is True


def test_score_support_held():
    fc = j.forecast_from_scaffold(_scaffold())
    # price dipped to 7488 (tested 7490 support) then closed back at 7510 above it
    sc = j.score_forecast(fc, price_low=7488, price_high=7515, price_last=7510, spot_at_snap=7543)
    v = {l["key"]: l["verdict"] for l in sc["levels"]}
    assert v["H"] == "held"          # tested support, closed back above → held
    assert sc["level_accuracy"] is not None


def test_score_regime_wrong_on_trend():
    fc = j.forecast_from_scaffold(_scaffold())
    # positive gamma predicted a range but price moved >1% → regime call WRONG
    sc = j.score_forecast(fc, price_low=7543, price_high=7650, price_last=7650, spot_at_snap=7543)
    assert sc["regime"]["correct"] is False
    assert sc["regime"]["moved_pct"] > 1.0


# ------------------------------------------------------------ store + accuracy

def test_store_snapshot_scorecard_and_accuracy(tmp_path):
    store = _sqlite_store(tmp_path)
    fc = j.forecast_from_scaffold(_scaffold())
    sid = store.record_journal_snapshot({
        "created_at": "2026-07-13T09:30:00-04:00", "session": "2026-07-13",
        "symbol": "SPX", "image_path": "x.png", "image_mime": "image/png",
        "note": "test", "spot_at_snap": 7543.0, "forecast": fc})
    assert sid
    snaps = store.load_journal_snapshots()
    assert len(snaps) == 1 and snaps[0]["forecast"]["gamma"] == "positive"
    # attach a scorecard + check aggregate accuracy
    sc = j.score_forecast(fc, 7488, 7515, 7510, 7543)
    assert store.update_journal_scorecard(sid, sc, "2026-07-13T16:00:00-04:00")
    acc = j.journal_accuracy(store.load_journal_snapshots())
    assert acc["n_scored"] == 1 and acc["regime_hit_rate"] is not None


def test_delete_snapshot(tmp_path):
    store = _sqlite_store(tmp_path)
    sid = store.record_journal_snapshot({
        "created_at": "2026-07-13T09:30:00-04:00", "image_path": "x.png",
        "forecast": {}})
    assert store.delete_journal_snapshot(sid)
    assert store.load_journal_snapshots() == []
