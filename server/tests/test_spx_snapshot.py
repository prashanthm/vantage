"""SPX snapshot + ICT detection — the chart-centric payload for spx_analyst."""
from vantage_server import ict, spx_snapshot as ss


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


# ── ICT unit checks ──────────────────────────────────────────────────────────

def test_draw_is_the_nearer_opposing_level():
    # price 7550, levels 7529 (below, 21 away) and 7580 (above, 30 away) → draw DOWN
    d = ict.draw_from_levels(7550, [7529.4, 7580.0, 7600.0])
    assert d["dir"] == "down" and d["level"] == 7529.4


def test_fresh_fvg_detects_bull_gap():
    # a clean bullish gap: low[2]=102 > high[0]=100
    hi = [100, 101, 105]
    lo = [98, 99, 102]
    fvgs = ict.fresh_fvgs(hi, lo)
    assert any(f["side"] == "bull" and f["lo"] == 100 and f["hi"] == 102 for f in fvgs)


def test_unswept_liquidity_drops_taken_pools():
    # a pivot high at bar 2 (100) later exceeded → not unswept
    hi = [95, 96, 100, 98, 97, 96, 101, 99, 98]
    lo = [90, 91, 92, 93, 94, 92, 93, 92, 91]
    liq = ict.unswept_liquidity(hi, lo, piv=2)
    assert all(p != 100 for p in liq["bsl"])   # 100 was taken by the 101 bar


# ── snapshot integration ─────────────────────────────────────────────────────

def _seed_day(store, day):
    # 60 bars, a clean uptrend then pullback, so structures exist
    n = 60
    ts = [f"{day}T{9 + (30 + i)//60:02d}:{(30 + i) % 60:02d}:00-04:00" for i in range(n)]
    base = 7500.0
    op, hi, lo, cl, vol = [], [], [], [], []
    for i in range(n):
        c = base + (i if i < 40 else 40 - (i - 40))    # up then down
        o = c - 0.5
        op.append(o); cl.append(c)
        hi.append(max(o, c) + 1); lo.append(min(o, c) - 1); vol.append(1000 + i)
    store.save_intraday_bars("^GSPC", day, "1m",
                             {"ts": ts, "open": op, "high": hi, "low": lo,
                              "close": cl, "volume": vol})


def test_snapshot_has_price_technicals_levels_ict(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    snap = ss.build_snapshot(store, "2026-07-16")
    assert snap is not None
    assert snap["symbol"] == "SPX" and snap["day"] == "2026-07-16"
    assert snap["price"] > 0
    t = snap["technicals"]
    assert "vwap" in t and "rsi" in t and "rel_volume" in t and "atr" in t
    ic = snap["ict"]
    assert "unswept_liquidity" in ic and "active_order_blocks" in ic
    assert "fresh_fvgs" in ic and "draw" in ic
    assert "bsl" in ic["unswept_liquidity"] and "ssl" in ic["unswept_liquidity"]


def test_snapshot_as_of_truncates(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    early = ss.build_snapshot(store, "2026-07-16", as_of="2026-07-16T09:45:00-04:00")
    full = ss.build_snapshot(store, "2026-07-16")
    assert early["bar"] < full["bar"]   # as-of stops earlier in the session


def test_snapshot_none_without_bars(tmp_path):
    store = _sqlite_store(tmp_path)
    assert ss.build_snapshot(store, "2020-01-01") is None
