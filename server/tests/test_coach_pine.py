"""The coach Pine generator — bakes the playbook's GEX/pivot levels into a live
discipline coach. Content checks (no TradingView to run it)."""
from vantage_server import coach_pine as cp

_SCAFFOLD = {
    "session": "2026-07-16",
    "regime": {"gamma": "positive", "spot": 7543.59, "vwap_regime": "above VWAP"},
    "table": {"rows": [
        {"price": 7600.0, "label": "call wall ★8d"},
        {"price": 7548.1, "label": "fib 78.6% + resistance (9x)"},
        {"price": 7517.1, "label": "support (4x) + max pain"},
        {"price": 7503.0, "label": "gamma flip (regime line)"},
        {"price": 7450.0, "label": "put wall"},
    ]},
}


def test_coach_bakes_levels_and_states():
    s = cp.build_coach_indicator(_SCAFFOLD)
    assert s.startswith("// SPX 0DTE COACH") or "//@version=5" in s
    # levels baked as a Pine array, high->low
    assert "array.from(7600.00, 7548.10, 7517.10, 7503.00, 7450.00)" in s
    assert "flipLevel = 7503.00" in s
    # all five coach states present
    for state in ("WAIT", "ENTER", "EXIT", "HOLD", "WARN"):
        assert f'"{state}"' in s
    # the four documented leaks are coded
    for leak in ("wrongSideLong", "frontRun", "chaseLong", "knife"):
        assert leak in s
    # session indicators
    assert "vwap" in s and "ta.rsi" in s and "relV" in s


def test_coach_hold_tracks_red_position():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # HOLD keys off the coach's own last ENTER going underwater
    assert "posEntry" in s and "pnlPts" in s
    assert "hold = red and not exitCue" in s


def test_coach_none_without_levels():
    assert cp.build_coach_indicator({"table": {"rows": []}}) is None
    assert cp.build_coach_indicator({}) is None


def test_coach_classifies_walls():
    assert cp._classify("call wall ★8d") == "callwall"
    assert cp._classify("put wall") == "putwall"
    assert cp._classify("gamma flip (regime line)") == "flip"
    assert cp._classify("support (4x)") == "support"
    assert cp._classify("resistance (9x)") == "resistance"
