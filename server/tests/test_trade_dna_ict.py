"""The DNA's entry-time ICT block — direction derivation + validated flags.

Locks the deterministic flag semantics the ict-coach / ict-concepts-edge goals
validated (against_draw, midday_entry, htf_setup_aligned) so a refactor can't
silently flip them. The full _ict_at_entry path (build_snapshot as-of) is covered
by the live/integration checks; here we pin the pure logic."""
import datetime as _dt

from vantage_server import trade_dna as dna


def test_trade_dir_from_strategy():
    assert dna._trade_dir({"strategy": "long_call"}) == 1
    assert dna._trade_dir({"strategy": "long_call_spread"}) == 1
    assert dna._trade_dir({"strategy": "long_put"}) == -1
    assert dna._trade_dir({"strategy": "long_put_spread"}) == -1
    assert dna._trade_dir({"strategy": "iron_condor"}) == 0   # both -> unknown
    assert dna._trade_dir({"strategy": None}) == 0


def _et(h, m):
    from zoneinfo import ZoneInfo
    return _dt.datetime(2026, 7, 16, h, m, tzinfo=ZoneInfo("America/New_York"))


def test_midday_flag_window():
    # the validated 11:00-14:00 ET level-trap window
    assert (11 <= _et(11, 0).hour < 14) is True
    assert (11 <= _et(13, 59).hour < 14) is True
    assert (11 <= _et(10, 59).hour < 14) is False   # open-90, not midday
    assert (11 <= _et(14, 30).hour < 14) is False   # afternoon


class _FakeStore:
    """Minimal store that yields a controlled snapshot so we can assert the flag
    logic without real bars. uses_sqlite True so _ict_at_entry proceeds."""
    uses_sqlite = True

    def __init__(self, snap):
        self._snap = snap


def _patch_snapshot(monkeypatch, snap):
    from vantage_server import spx_snapshot
    monkeypatch.setattr(spx_snapshot, "build_snapshot",
                        lambda *a, **k: snap)


def test_against_draw_flag(monkeypatch):
    # draw pulls UP; a long_put (bearish, -1) is AGAINST it
    snap = {"as_of": "2026-07-16T12:00:00-04:00", "price": 7550,
            "ict": {"draw": {"dir": "up", "level": 7580, "dist": 30},
                    "unswept_liquidity": {}, "active_order_blocks": [], "fresh_fvgs": []},
            "ict_htf": {"present": False}}
    _patch_snapshot(monkeypatch, snap)
    out = dna._ict_at_entry(_FakeStore(snap), "2026-07-16", "SPX",
                            _et(12, 0), {"strategy": "long_put"})
    assert out["flags"]["against_draw"] is True
    assert out["flags"]["midday_entry"] is True   # 12:00 ET
    # a long_call (bullish, +1) WITH the up-draw is not against it
    out2 = dna._ict_at_entry(_FakeStore(snap), "2026-07-16", "SPX",
                             _et(12, 0), {"strategy": "long_call"})
    assert out2["flags"]["against_draw"] is False


def test_htf_setup_aligned_flag(monkeypatch):
    snap = {"as_of": "2026-07-16T10:00:00-04:00", "price": 7550,
            "ict": {"draw": {"dir": None, "level": None, "dist": None},
                    "unswept_liquidity": {}, "active_order_blocks": [], "fresh_fvgs": []},
            "ict_htf": {"present": True, "tier": "A+", "dir": "long"}}
    _patch_snapshot(monkeypatch, snap)
    # long_call aligns with an A+ long setup
    out = dna._ict_at_entry(_FakeStore(snap), "2026-07-16", "SPX",
                            _et(10, 0), {"strategy": "long_call"})
    assert out["flags"]["htf_setup_aligned"] is True
    assert out["htf_setup"]["tier"] == "A+"
    # long_put does NOT align with a long setup
    out2 = dna._ict_at_entry(_FakeStore(snap), "2026-07-16", "SPX",
                             _et(10, 0), {"strategy": "long_put"})
    assert out2["flags"]["htf_setup_aligned"] is False


def test_none_when_no_entry_time():
    assert dna._ict_at_entry(_FakeStore({}), "2026-07-16", "SPX", None,
                             {"strategy": "long_call"}) is None


# ── entry-anchored FVG adjacency + hourly sweep context ──────────────────────

def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def test_fvg_sweep_context(tmp_path):
    """Two-day synthetic tape: a PRIOR-day hourly swing high (7520) is swept on
    the current morning (wick 7522, close back), and a bull FVG straddling the
    entry price shows on 1m. Everything anchored to the ENTRY bar."""
    from zoneinfo import ZoneInfo

    def _seed(store, day, spike_hi=None, spike_minute=None, fvg=False):
        ts, op, hi, lo, cl = [], [], [], [], []
        for i in range(390):
            m = 570 + i
            ts.append(f"{day}T{m // 60:02d}:{m % 60:02d}:00-04:00")
            o = c = 7500.0
            h, l = 7500.5, 7499.5
            if spike_minute is not None and i == spike_minute:
                h = spike_hi
                c = 7515.0 if spike_hi > 7520 else c   # sweep bar closes back below
            if fvg and i == 200:
                o = c = 7503.0; h, l = 7504.0, 7502.0
            elif fvg and i == 201:
                o = c = 7506.0; h, l = 7508.5, 7503.5
            elif fvg and i == 202:
                o = c = 7509.0; h, l = 7510.0, 7508.0
            op.append(o); cl.append(c); hi.append(h); lo.append(l)
        store.save_intraday_bars("^GSPC", day, "1m",
                                 {"ts": ts, "open": op, "high": hi, "low": lo,
                                  "close": cl, "volume": [1000] * 390})

    store = _sqlite_store(tmp_path)
    # prior day: a 12:00-hour swing high at 7520 (the hourly pivot to sweep)
    _seed(store, "2026-07-15", spike_hi=7520.0, spike_minute=150)
    # current day: 10:15 wick to 7522 closing 7515 (the sweep) + the 1m FVG
    _seed(store, "2026-07-16", spike_hi=7522.0, spike_minute=45, fvg=True)

    entry = _dt.datetime(2026, 7, 16, 13, 0, tzinfo=ZoneInfo("America/New_York"))
    ctx = dna._fvg_sweep_context(store, "2026-07-16", "SPX", entry, 7506.0)
    assert ctx and ctx["entry_price"] == 7506.0
    g1 = ctx["fvgs_at_entry"]["1m"]
    assert any(g["side"] == "bull" and g["lo"] == 7504.0 and g["hi"] == 7508.0
               and g["inside"] for g in g1)
    assert any(s["side"] == "BSL" and s["level"] == 7520.0
               for s in ctx["htf_sweeps"])
    # entry BEFORE the FVG formed -> not visible (anchored to entry, no lookahead)
    early = _dt.datetime(2026, 7, 16, 12, 0, tzinfo=ZoneInfo("America/New_York"))
    ctx2 = dna._fvg_sweep_context(store, "2026-07-16", "SPX", early, 7506.0)
    assert not any(g["lo"] == 7504.0 for g in ctx2["fvgs_at_entry"]["1m"])


def test_intraday_plan_slot_never_shadows_the_record(tmp_path):
    """Intraday recomputes live under '{sym}:intraday' — the overnight plan of
    record must stay untouched under 'SPX' (the journal grades against it),
    while the snapshot's freshness chain prefers the intraday row."""
    store = _sqlite_store(tmp_path)
    store.upsert_spx_playbook("2026-07-23", {"session": "2026-07-23", "v": "overnight"}, symbol="SPX")
    store.upsert_spx_playbook("2026-07-23", {"session": "2026-07-23", "v": "live"}, symbol="SPX:intraday")
    rec = store.load_spx_playbook("2026-07-23", symbol="SPX")
    live = store.load_spx_playbook("2026-07-23", symbol="SPX:intraday")
    assert rec["scaffold"]["v"] == "overnight"        # record intact
    assert live["scaffold"]["v"] == "live"
    # the snapshot preference chain: intraday first, overnight fallback
    row = (store.load_spx_playbook("2026-07-23", symbol="SPX:intraday")
           or store.load_spx_playbook("2026-07-23", symbol="SPX"))
    assert row["scaffold"]["v"] == "live"
    assert store.load_spx_playbook("2026-07-24", symbol="SPX:intraday") is None
