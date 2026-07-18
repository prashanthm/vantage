"""Multi-timeframe chart candles — resampler correctness + per-tf sourcing."""
from vantage_server import chart_data as cd


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _seed_1m(store, sym, day, n=30, start_min=9 * 60 + 30):
    ts, op, hi, lo, cl, vol = [], [], [], [], [], []
    for i in range(n):
        m = start_min + i
        ts.append(f"{day}T{m // 60:02d}:{m % 60:02d}:00-04:00")
        c = 100.0 + i
        op.append(c - 0.5); cl.append(c); hi.append(c + 1); lo.append(c - 1); vol.append(10 + i)
    store.save_intraday_bars(sym, day, "1m",
                             {"ts": ts, "open": op, "high": hi, "low": lo, "close": cl, "volume": vol})


# ── resampler ────────────────────────────────────────────────────────────────

def test_resample_5m_buckets_by_wall_clock(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_1m(store, "AAA", "2026-07-16", n=15)   # 09:30..09:44 → three 5m buckets
    out = cd.chart_candles(store, "AAA", "5m")
    assert out["available"] and out["tf"] == "5m"
    c = out["candles"]
    assert len(c) == 3                            # 09:30-34, 09:35-39, 09:40-44
    # first 5m bucket: open = first 1m open, high/low span the 5 bars, close = last
    assert c[0]["open"] == 99.5                   # bar0 open (100-0.5)
    assert c[0]["close"] == 104.0                 # bar4 close (100+4)
    assert c[0]["high"] == 105.0 and c[0]["low"] == 99.0
    assert c[0]["volume"] == sum(10 + i for i in range(5))


def test_1m_passthrough_is_one_candle_per_bar(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_1m(store, "AAA", "2026-07-16", n=12)
    out = cd.chart_candles(store, "AAA", "1m")
    assert len(out["candles"]) == 12
    assert out["candles"][0]["close"] == 100.0


def test_15m_aggregates_wider(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_1m(store, "AAA", "2026-07-16", n=30)    # 30 min → two 15m buckets
    out = cd.chart_candles(store, "AAA", "15m")
    assert len(out["candles"]) == 2


# ── sourcing per timeframe ───────────────────────────────────────────────────

def test_1h_reads_stored_60m(tmp_path):
    store = _sqlite_store(tmp_path)
    ts = [f"2026-07-16T{9+i:02d}:30:00-04:00" for i in range(6)]
    store.save_intraday_bars("NVDA", "2026-07-16", "60m",
                             {"ts": ts, "open": [1] * 6, "high": [2] * 6, "low": [0] * 6,
                              "close": [1.5] * 6, "volume": [5] * 6})
    out = cd.chart_candles(store, "NVDA", "1H")
    assert out["available"] and len(out["candles"]) == 6


def test_1d_reads_daily_bars_table(tmp_path):
    store = _sqlite_store(tmp_path)
    store.put_bars("^GSPC", {"daily": [
        {"date": "2026-07-15", "open": 100, "high": 102, "low": 99, "close": 101},
        {"date": "2026-07-16", "open": 101, "high": 105, "low": 100, "close": 104},
    ]}, as_of="2026-07-16T20:00:00Z")
    out = cd.chart_candles(store, "SPX", "1D")
    assert out["available"] and len(out["candles"]) == 2
    assert out["candles"][-1]["close"] == 104


def test_spx_maps_to_gspc(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_1m(store, "^GSPC", "2026-07-16", n=10)
    out = cd.chart_candles(store, "SPX", "5m")   # SPX → ^GSPC
    assert out["available"] and out["candles"]


def test_unavailable_when_no_bars(tmp_path):
    store = _sqlite_store(tmp_path)
    out = cd.chart_candles(store, "ZZZ", "5m")
    assert out["available"] is False and "note" in out


def test_bad_tf_falls_back_to_5m(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_1m(store, "AAA", "2026-07-16", n=10)
    out = cd.chart_candles(store, "AAA", "bogus")
    assert out["tf"] == "5m" and out["available"]
