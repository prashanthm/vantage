"""The coach Pine generator — bakes the playbook's GEX/pivot levels into a
plan-execution coach (ARM → TRIGGER → HOLD/SCALE → STOP/TARGET). One indicator,
SPX-gated by symbol. Content checks (no TradingView to run it)."""
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


def test_coach_bakes_gex_and_lifecycle_states():
    s = cp.build_coach_indicator(_SCAFFOLD)
    assert "//@version=5" in s
    # GEX levels baked as a Pine array, high->low, under the gex* names
    assert "gexPx  = array.from(7600.00, 7548.10, 7517.10, 7503.00, 7450.00)" in s
    assert "gexFlip = 7503.00" in s
    # the plan-execution lifecycle states are all present
    for state in ('"ARMED"', '"TRIGGERED"', '"HOLD"', '"SCALE"', '"WAIT"'):
        assert state in s, state
    # the trigger is the reclaim (N closes back through the level)
    assert "reclaimN" in s and "triggerLong" in s and "triggerShort" in s
    # entry/stop/target + R:R are computed for the armed setup
    assert "armEntry" in s and "armStop" in s and "armT1" in s and "armRR" in s
    # session indicators still there
    assert "vwap" in s and "ta.rsi" in s and "relV" in s


def test_coach_is_spx_gated_by_symbol():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # auto-detect SPX from the chart symbol; GEX used only when on SPX
    assert "syminfo.ticker" in s
    assert "isSpx" in s and "useGex" in s
    # GEX level lines are drawn ONLY when useGex (i.e. on an SPX chart)
    line_draw = next(ln for ln in s.splitlines() if "showLines" in ln and "if " in ln)
    assert "useGex" in line_draw
    # non-SPX still arms off swing structure
    assert "ta.pivothigh" in s and "ta.pivotlow" in s
    assert '"swing low"' in s and '"swing high"' in s


def test_coach_scale_out_when_target_at_risk():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # partial/scale logic: in profit, gave back the peak / lost VWAP / stalled,
    # before T1 — advise trimming at a sensible interim level
    assert "scaleOut" in s and "scaleAt" in s
    for cue in ("gaveBack", "lostVwap", "stalledIn"):
        assert cue in s, cue
    # SCALE ranks below TRIGGERED but above a plain HOLD in the state machine.
    # (the state resolution is a multi-line ternary — TRIGGERED then SCALE then HOLD)
    assert 'firedNow ? "TRIGGERED"' in s
    scale_idx = s.index('scaleOut) ? "SCALE"')
    hold_idx = s.index('inTrade ? "HOLD"')
    trig_idx = s.index('firedNow ? "TRIGGERED"')
    assert trig_idx < scale_idx < hold_idx


def test_coach_trade_lifecycle_tracks_position():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # a live trade with entry/stop/target and stop/target resolution
    assert "tEntry" in s and "tStop" in s and "tT1" in s
    assert "stopHit" in s and "tgtHit" in s
    assert '"STOPPED"' in s and '"TARGET HIT"' in s
    # position shown in plain words
    assert '"Flat — no position"' in s
    # panel bottom-right, action drives the header
    assert "position.bottom_right" in s
    assert "table.cell(panel, 0, 0, action" in s


def test_coach_no_bgcolor_small_markers_both_sides():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # background shading removed
    assert "bgcolor(" not in s
    # BOTH a long and a short can arm/trigger (shorts were never firing before)
    assert "triggerLong" in s and "triggerShort" in s
    assert "armLong " in s and "armShort " in s
    # on-chart markers are tiny (no big triangles), with explicit LONG/SHORT triggers
    for shape_line in [ln for ln in s.splitlines() if ln.strip().startswith("plotshape(")]:
        assert "size.tiny" in shape_line, shape_line
    assert 'text="LONG"' in s and 'text="SHORT"' in s
    # a readable nearest-levels row in the panel
    assert "lvlsTxt" in s
    # GEX level labels ride the last bar (not stranded at bar_index+500)
    assert "bar_index + 500" not in s


def test_coach_rr_gate_blocks_wrong_side_and_low_rr():
    s = cp.build_coach_indicator(_SCAFFOLD)
    # a min-R:R input exists and defaults to 1.5 (backtest-validated fix)
    assert "rrMin" in s and 'input.float(1.5' in s
    # the trigger is GATED: raw reclaim must clear the target/R:R check to fire
    assert "rawTrigLong" in s and "rawTrigShort" in s
    assert "longTgtOk" in s and "shrtTgtOk" in s
    # target must sit strictly beyond the entry close (no wrong-side targets)
    assert "resPx > close" in s and "supPx < close" in s
    # and reward:risk from the entry must clear rrMin
    assert ">= rrMin" in s
    trig_l = next(ln for ln in s.splitlines() if ln.strip().startswith("triggerLong  ="))
    assert "longTgtOk" in trig_l


def test_coach_flip_missing_is_typed_na():
    """A scaffold with no gamma-flip row must still compile: `gexFlip` has to
    be a TYPED float, else Pine rejects `gexFlip = na` (untyped na assignment)."""
    scaffold = {"table": {"rows": [
        {"price": 7600.0, "label": "call wall"},
        {"price": 7548.1, "label": "resistance (9x)"},
        {"price": 7450.0, "label": "put wall"},
    ]}}
    s = cp.build_coach_indicator(scaffold)
    assert "float gexFlip = na" in s
    # never emit a bare untyped assignment
    assert "\ngexFlip = na" not in s


def test_coach_none_without_levels():
    assert cp.build_coach_indicator({"table": {"rows": []}}) is None
    assert cp.build_coach_indicator({}) is None


def test_coach_classifies_walls():
    assert cp._classify("call wall ★8d") == "callwall"
    assert cp._classify("put wall") == "putwall"
    assert cp._classify("gamma flip (regime line)") == "flip"
    assert cp._classify("support (4x)") == "support"
    assert cp._classify("resistance (9x)") == "resistance"
