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

def test_resolve_universe_dedupes_and_caches(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    # SPY and QQQ share AAPL/MSFT; IWM distinct. Expect a deduped union, ETFs dropped.
    fake = {"SPY": ["AAPL", "MSFT", "NVDA"], "QQQ": ["AAPL", "MSFT", "AMZN"],
            "IWM": ["SMCI", "AAPL"]}
    monkeypatch.setattr(sc, "_etf_top_holdings", lambda etf: fake.get(etf, []))
    uni = sc.resolve_universe(store, refresh=True)
    assert uni["source"] == "holdings"
    assert set(uni["symbols"]) == {"AAPL", "MSFT", "NVDA", "AMZN", "SMCI"}
    # cached: a second call without refresh reads the store, doesn't refetch
    monkeypatch.setattr(sc, "_etf_top_holdings", lambda etf: [])  # would empty it
    uni2 = sc.resolve_universe(store, refresh=False)
    assert uni2["from_cache"] is True
    assert set(uni2["symbols"]) == {"AAPL", "MSFT", "NVDA", "AMZN", "SMCI"}


def test_resolve_universe_pinned_fallback_when_holdings_fail(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(sc, "_etf_top_holdings", lambda etf: [])   # all fail
    uni = sc.resolve_universe(store, refresh=True)
    assert uni["source"] == "pinned-fallback"
    assert len(uni["symbols"]) > 0


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
    # a setup that triggered long ago (bars_ago > _FRESH_BARS) is NOT surfaced —
    # the scanner shows current signals only.
    store = _sqlite_store(tmp_path)
    _seed_hourly_from_frozen(store, "AAPL")
    monkeypatch.setattr(sc._htf, "htf_setup",
                        lambda *a, **k: {"present": True, "tier": "A+", "dir": "long",
                                         "ce": 1, "entry_zone": [1, 2], "invalid": 2,
                                         "bars_ago": sc._FRESH_BARS + 5})
    got = sc._scan_ict_htf(store, "AAPL")
    assert got["present"] is False and got.get("stale_bars_ago") == sc._FRESH_BARS + 5


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
    # persisted as the latest scan
    stored = store.load_scanner_result("ict_htf")
    assert stored and stored["result"]["universe_n"] == 3


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
