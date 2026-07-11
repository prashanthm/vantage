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


# ------------------------------------------------------------ entry + prior pick

def test_normalize_entry():
    assert j.normalize_entry(None) is None
    assert j.normalize_entry({"action": "  "}) is None          # all-blank → None
    assert j.normalize_entry({"action": " bought 7550C ", "junk": "x"}) == {
        "action": "bought 7550C"}                                # trimmed, junk dropped


def test_snapshot_without_image(tmp_path):
    """A data-only entry (no reference image) round-trips fine."""
    store = _sqlite_store(tmp_path)
    sid = store.record_journal_snapshot({
        "created_at": "2026-07-13T09:30:00-04:00", "forecast": {},
        "forecast_kind": "prior"})
    row = store.load_journal_snapshot(sid)
    assert row["image_path"] is None and row["forecast_kind"] == "prior"


def test_update_journal_entry(tmp_path):
    store = _sqlite_store(tmp_path)
    sid = store.record_journal_snapshot({
        "created_at": "2026-07-13T09:30:00-04:00", "forecast": {}})
    assert store.load_journal_snapshot(sid)["entry"] is None
    entry = j.normalize_entry({"action": "bought 7550C", "result": "+1.5R"})
    assert store.update_journal_entry(sid, entry, "2026-07-13T16:05:00-04:00")
    got = store.load_journal_snapshot(sid)
    assert got["entry"] == {"action": "bought 7550C", "result": "+1.5R"}
    assert got["entry_updated_at"] == "2026-07-13T16:05:00-04:00"
    # clearing
    assert store.update_journal_entry(sid, None, "2026-07-13T16:10:00-04:00")
    assert store.load_journal_snapshot(sid)["entry"] is None


def test_pick_forecast_prefers_prior_session(tmp_path):
    store = _sqlite_store(tmp_path)
    # last night's playbook (dated before today) and a today playbook
    prior = _scaffold(); prior["session"] = "2026-07-13"; prior["regime"]["spot"] = 7500.0
    live = _scaffold(); live["session"] = "2026-07-14"; live["regime"]["spot"] = 7600.0
    store.upsert_spx_playbook("2026-07-13", prior)
    store.upsert_spx_playbook("2026-07-14", live)
    # prior: freezes yesterday's (7500), even though today's exists
    _, fc, kind = j.pick_forecast(store, "2026-07-14", "prior")
    assert kind == "prior" and fc["spot"] == 7500.0
    # live: freezes today's (7600)
    _, fc2, kind2 = j.pick_forecast(store, "2026-07-14", "live")
    assert kind2 == "live" and fc2["spot"] == 7600.0


def test_pick_forecast_falls_back_when_no_prior(tmp_path):
    store = _sqlite_store(tmp_path)
    only = _scaffold(); only["session"] = "2026-07-14"; only["regime"]["spot"] = 7600.0
    store.upsert_spx_playbook("2026-07-14", only)
    # asking for prior with no earlier session → falls back to live
    _, fc, kind = j.pick_forecast(store, "2026-07-14", "prior")
    assert kind == "live" and fc["spot"] == 7600.0


# ------------------------------------------------------------ daily auto-entry

def test_ensure_today_is_idempotent(tmp_path, monkeypatch):
    """First open creates today's entry (last night's forecast); repeat opens
    don't create a second. Price scoring is stubbed out (no network)."""
    store = _sqlite_store(tmp_path)
    # a playbook dated well before any real 'today' so pick_forecast('prior') hits it
    prior = _scaffold(); prior["session"] = "2000-01-03"; prior["regime"]["spot"] = 7500.0
    store.upsert_spx_playbook("2000-01-03", prior)
    monkeypatch.setattr(j, "score_snapshot", lambda snap, symbol="^GSPC": None)

    r1 = j.ensure_today_entry(store)
    assert r1["created"] is True and r1["id"]
    snaps = store.load_journal_snapshots()
    assert len(snaps) == 1
    assert snaps[0]["forecast_kind"] == "prior"
    assert snaps[0]["forecast"]["spot"] == 7500.0     # last night's

    r2 = j.ensure_today_entry(store)                   # second open
    assert r2["created"] is False and r2["id"] == r1["id"]
    assert len(store.load_journal_snapshots()) == 1    # still just one


def test_ensure_today_per_underlying(tmp_path, monkeypatch):
    """Each underlying gets its OWN daily entry (idempotent per (day, symbol)) —
    SPX, QQQ, IWM don't suppress each other."""
    store = _sqlite_store(tmp_path)
    for sym, spot in [("SPX", 7500.0), ("QQQ", 500.0), ("IWM", 220.0)]:
        sc = _scaffold(); sc["session"] = "2000-01-03"; sc["regime"]["spot"] = spot
        store.upsert_spx_playbook("2000-01-03", sc, symbol=sym)
    monkeypatch.setattr(j, "score_snapshot", lambda snap, symbol=None: None)

    res = j.ensure_all_underlyings(store)
    assert all(r["created"] for r in res)               # all three created
    assert len(store.load_journal_snapshots()) == 3
    # each entry froze its own underlying's forecast + is tagged with its symbol
    by_sym = {s["symbol"]: s for s in store.load_journal_snapshots()}
    assert by_sym["QQQ"]["forecast"]["spot"] == 500.0
    assert by_sym["IWM"]["forecast"]["spot"] == 220.0
    # re-open: no duplicates per underlying
    res2 = j.ensure_all_underlyings(store)
    assert not any(r["created"] for r in res2)
    assert len(store.load_journal_snapshots()) == 3
    # symbol-filtered view returns just that underlying
    assert len(j.build_journal(store, "QQQ")["snapshots"]) == 1


def test_score_snapshot_bar_symbol_from_underlying(monkeypatch):
    """score_snapshot derives the bar symbol from the snapshot's own underlying
    (QQQ→QQQ, not the SPX default)."""
    seen = {}
    def fake_range(sym, day):
        seen["sym"] = sym
        return (498.0, 505.0, 503.0, 10)
    monkeypatch.setattr(j, "_price_range_for_day", fake_range)
    snap = {"symbol": "QQQ", "created_at": "2026-07-10T09:35:00-04:00",
            "forecast": {"levels": []}, "spot_at_snap": 500.0}
    sc = j.score_snapshot(snap)
    assert seen["sym"] == "QQQ" and sc["price_high"] == 505.0


def test_ensure_today_rescores(tmp_path, monkeypatch):
    """On open, today's entry is re-scored against a (stubbed) price read."""
    store = _sqlite_store(tmp_path)
    prior = _scaffold(); prior["session"] = "2000-01-03"
    store.upsert_spx_playbook("2000-01-03", prior)
    monkeypatch.setattr(j, "score_snapshot",
                        lambda snap, symbol="^GSPC": {"price_low": 7490, "price_high": 7560,
                                                      "price_last": 7555, "levels": []})
    r = j.ensure_today_entry(store)
    assert r["created"] and r["rescored"]
    assert store.load_journal_snapshot(r["id"])["scorecard"]["price_high"] == 7560


def test_score_snapshot_uses_full_session(tmp_path, monkeypatch):
    """score_snapshot scores against the WHOLE day's bars, not just bars after
    the snapshot's creation time (so opening after close still scores)."""
    import pandas as pd
    from vantage_server import spx_playbook as sp
    # bars across the full 2026-07-13 session; snapshot is created at 15:00 that day
    idx = pd.to_datetime([
        "2026-07-13 09:45", "2026-07-13 12:00", "2026-07-13 15:45",
    ]).tz_localize("America/New_York")
    df = pd.DataFrame({"Low": [7480, 7495, 7540], "High": [7500, 7560, 7580],
                       "Close": [7490, 7550, 7570]}, index=idx)
    monkeypatch.setattr(sp, "_fetch_15m", lambda symbol: df)
    snap = {"created_at": "2026-07-13T15:00:00-04:00",
            "forecast": j.forecast_from_scaffold(_scaffold()), "spot_at_snap": 7543.0}
    sc = j.score_snapshot(snap)
    # full-session range: low 7480, high 7580 — includes the 09:45 bar BEFORE 15:00
    assert sc is not None
    assert sc["price_low"] == 7480.0 and sc["price_high"] == 7580.0
    assert sc["bars_since"] == 3


def test_update_journal_image(tmp_path):
    store = _sqlite_store(tmp_path)
    sid = store.record_journal_snapshot({
        "created_at": "2026-07-13T09:30:00-04:00", "forecast": {}})
    assert store.load_journal_snapshot(sid)["image_path"] is None
    assert store.update_journal_image(sid, "chart.png", "image/png")
    got = store.load_journal_snapshot(sid)
    assert got["image_path"] == "chart.png" and got["image_mime"] == "image/png"
