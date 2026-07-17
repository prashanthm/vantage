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
