"""ICT Scanner — universe resolution, hourly seeding, and scan-over-universe that
reproduces the validated htf_setup detector exactly."""
import json
import os

from vantage_server import scanner as sc, ict, ict_htf

_HOURLY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "backtest_data", "bars_hourly_730d.json")


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _seed_hourly_from_frozen(store, symbol, n=400):
    """Seed a symbol's 60m bars into the store from the frozen ^GSPC hourly set,
    split by session-day, so the scanner has real hourly structure to detect on."""
    with open(_HOURLY) as fh:
        d = json.load(fh)
    b = (d.get("bars") or d)["^GSPC"]
    ts, op, hi, lo, cl = b["ts"][-n:], b["open"][-n:], b["high"][-n:], b["low"][-n:], b["close"][-n:]
    by_day = {}
    for i, t in enumerate(ts):
        day = t[:10]
        g = by_day.setdefault(day, {"ts": [], "open": [], "high": [], "low": [], "close": [], "volume": []})
        g["ts"].append(t); g["open"].append(op[i]); g["high"].append(hi[i])
        g["low"].append(lo[i]); g["close"].append(cl[i]); g["volume"].append(0.0)
    for day, g in by_day.items():
        store.save_intraday_bars(symbol, day, "60m", g)
    return ts, op, hi, lo, cl


# ── universe ─────────────────────────────────────────────────────────────────

def test_universe_is_weighted_union_of_qqq_and_spy(tmp_path):
    store = _sqlite_store(tmp_path)
    uni = sc.resolve_universe(store, refresh=True)
    syms = uni["symbols"]
    assert uni["source"] == "qqq100+spy100"
    # deduped union of the two pinned 100-lists
    assert len(syms) == len(set(syms))                      # no dups
    assert 100 < len(syms) <= sc._UNIVERSE_CAP              # ~162 after overlap
    assert syms[0] == "NVDA"                                # weight order preserved
    assert "BRK-B" in syms and "JPM" in syms               # SPY-only names present
    assert "PANW" in syms                                   # shared name once
    # cached: a second call reads the store
    assert sc.resolve_universe(store, refresh=False)["from_cache"] is True


def test_universe_cap_keeps_weighted_head(tmp_path):
    store = _sqlite_store(tmp_path)
    uni = sc.resolve_universe(store, refresh=True, cap=20)
    assert len(uni["symbols"]) == 20
    assert uni["symbols"][0] == "NVDA"                      # top-weight kept


def test_manual_tickers_add_remove_and_always_included(tmp_path):
    store = _sqlite_store(tmp_path)
    sc.add_manual_ticker(store, "spce")                     # lowercased → SPCE
    sc.add_manual_ticker(store, "BRK.A")                    # dot → dash
    assert set(sc.manual_tickers(store)) == {"SPCE", "BRK-A"}
    # even a tiny cap keeps manual names (appended past the cap)
    uni = sc.resolve_universe(store, refresh=True, cap=5)
    assert "SPCE" in uni["symbols"] and "BRK-A" in uni["symbols"]
    assert set(uni["manual"]) == {"SPCE", "BRK-A"}
    sc.remove_manual_ticker(store, "SPCE")
    assert sc.manual_tickers(store) == ["BRK-A"]


# ── scan reproduces the detector ─────────────────────────────────────────────

def test_scan_ict_htf_matches_htf_setup(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_hourly_from_frozen(store, "AAPL")
    got = sc._scan_ict_htf(store, "AAPL")
    assert got is not None
    # recompute htf_setup independently from the same stored series → identical read
    ser = sc.load_hourly_series(store, "AAPL", days=15)
    hi, lo, cl, op = ser["high"], ser["low"], ser["close"], ser["open"]
    import datetime as dt
    last_hour = dt.datetime.fromisoformat(ser["ts"][-1]).strftime("%H:%M")
    expect = ict_htf.htf_setup(hi, lo, cl, op, last_hour, active_obs=ict.active_obs(hi, lo, cl, op))
    assert got["present"] == expect["present"]
    if expect["present"]:
        assert got["tier"] == expect["tier"] and got["dir"] == expect["dir"]


def test_scan_gates_stale_setups(tmp_path, monkeypatch):
    # a setup that triggered long ago (bars_ago > _FRESH_BARS) is tagged stale
    # with a resolved outcome — run_scan retires stale setups to history, so
    # they never reach `hits` (and thus never arm paper spreads).
    store = _sqlite_store(tmp_path)
    _seed_hourly_from_frozen(store, "AAPL")
    monkeypatch.setattr(sc._htf, "htf_setup",
                        lambda *a, **k: {"present": True, "tier": "A+", "dir": "long",
                                         "ce": 1, "entry_zone": [1, 2], "invalid": 2,
                                         "bars_ago": sc._FRESH_BARS + 5})
    got = sc._scan_ict_htf(store, "AAPL")
    assert got["stale"] is True and got.get("outcome") == "open"
    assert got["present"] is True     # kept + tagged, not hidden (retired by run_scan)


def test_scan_none_without_enough_bars(tmp_path):
    store = _sqlite_store(tmp_path)
    # only a handful of hourly bars → below the 32-bar floor → no data
    store.save_intraday_bars("XYZ", "2026-07-16", "60m",
                             {"ts": [f"2026-07-16T{9+i}:30:00-04:00" for i in range(5)],
                              "open": [1] * 5, "high": [2] * 5, "low": [0] * 5,
                              "close": [1] * 5, "volume": [0] * 5})
    assert sc._scan_ict_htf(store, "XYZ") is None


def test_run_scan_buckets_and_persists(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    _seed_hourly_from_frozen(store, "AAPL")
    _seed_hourly_from_frozen(store, "MSFT")
    monkeypatch.setattr(sc, "resolve_universe",
                        lambda *a, **k: {"symbols": ["AAPL", "MSFT", "NODATA"],
                                         "source": "holdings", "fetched_at": None})
    res = sc.run_scan(store, "ict_htf", refresh_bars=False)
    assert res["universe_n"] == 3
    assert "NODATA" in res["no_data"]
    assert res["covered_n"] == 2
    # every hit is present with a tier; hits sorted A+ before B
    ranks = [sc._TIER_RANK.get(h.get("tier"), 9) for h in res["hits"]]
    assert ranks == sorted(ranks)
    # persisted as the latest scan, marked complete
    stored = store.load_scanner_result("ict_htf")
    assert stored and stored["result"]["universe_n"] == 3
    assert stored["result"]["status"] == "complete"


def test_run_scan_writes_running_then_complete_status(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    _seed_hourly_from_frozen(store, "AAPL")
    monkeypatch.setattr(sc, "resolve_universe",
                        lambda *a, **k: {"symbols": ["AAPL"], "source": "x",
                                         "fetched_at": None, "manual": []})
    seen = []
    orig = store.save_scanner_result
    monkeypatch.setattr(store, "save_scanner_result",
                        lambda s, r: (seen.append(r.get("status")), orig(s, r))[1])
    res = sc.run_scan(store, "ict_htf", refresh_bars=False)
    assert "running" in seen and seen[-1] == "complete"   # progressed then finished
    assert res["status"] == "complete"


def test_background_scan_lock_rejects_overlap(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    # hold the lock → a start returns already_running
    assert sc._SCAN_LOCK.acquire(blocking=False)
    try:
        assert sc.start_background_scan(store)["status"] == "already_running"
    finally:
        sc._SCAN_LOCK.release()


# ── fresh-A+ alert diff ──────────────────────────────────────────────────────

def test_scan_alerts_only_fires_fresh_aplus():
    prev = {"hits": [{"symbol": "AAPL", "dir": "long", "tier": "A+"}]}
    curr = {"hits": [
        {"symbol": "AAPL", "dir": "long", "tier": "A+"},    # already alerted → no
        {"symbol": "NVDA", "dir": "short", "tier": "A+", "entry_zone": [100, 105],
         "invalid": 108, "reason": "sweep → FVG"},           # NEW A+ → yes
        {"symbol": "MSFT", "dir": "long", "tier": "B"},      # B → never
    ]}
    lines = sc.scan_alerts(prev, curr)
    assert len(lines) == 1
    assert "NVDA" in lines[0] and "A+" in lines[0]


def test_scan_alerts_none_when_no_prior():
    curr = {"hits": [{"symbol": "AAPL", "dir": "long", "tier": "A+",
                      "entry_zone": [1, 2], "invalid": 3, "reason": "x"}]}
    lines = sc.scan_alerts(None, curr)
    assert len(lines) == 1   # all current A+ are fresh when there's no prior scan
