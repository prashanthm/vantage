"""Parity gate for the hourly ICT signal layer (ict_htf).

The ict-concepts-edge goal validated two tradeable signals on 3 years of SPX hourly:
the CONFLUENCE stack (+0.59R/trade) and disp-gated FVG-REACTION (+0.42R). This test
re-backtests the PRODUCTION port (vantage_server.ict_htf) through the same frozen
data and asserts it reproduces the goal's numbers — so a port bug can never silently
change the shipped edge. Golden numbers are from claudedocs/goals/ict-concepts-edge/
findings.md (SEED-free: the signal set + P&L are deterministic).

Skips cleanly if the frozen dataset isn't present (it lives in server/backtest_data/).
"""
import json
import os

import pytest

from vantage_server import ict, ict_htf

_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "backtest_data", "bars_hourly_730d.json")


def _load_hourly():
    with open(_DATA) as fh:
        d = json.load(fh)
    b = (d.get("bars") or d)["^GSPC"]
    return b["ts"], b["open"], b["high"], b["low"], b["close"]


def _simulate(hi, lo, cl, entry_i, direction, entry, stop, target, max_bars=24):
    """R multiple at first stop/target hit, else mark-to-close (mirrors the
    validated scratch simulate_trade exactly)."""
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    end = min(entry_i + max_bars, len(cl) - 1)
    for k in range(entry_i + 1, end + 1):
        if direction > 0:
            if lo[k] <= stop:
                return -1.0
            if hi[k] >= target:
                return (target - entry) / risk
        else:
            if hi[k] >= stop:
                return -1.0
            if lo[k] <= target:
                return (entry - target) / risk
    return (direction * (cl[end] - entry)) / risk


def _pnl(hi, lo, cl, sigs, rr, stop_buf=0.25):
    rs = []
    for (ti, d, ce, far, _fi) in sigs:
        hatr = ict.atr(hi, lo, cl, ti, 14)
        if not hatr:
            continue
        stop = far - stop_buf * hatr if d > 0 else far + stop_buf * hatr
        risk = abs(ce - stop)
        if risk <= 0:
            continue
        target = ce + d * rr * risk
        r = _simulate(hi, lo, cl, ti, d, ce, stop, target)
        if r is not None:
            rs.append(r)
    n = len(rs)
    return n, (sum(rs) / n if n else 0.0)


@pytest.fixture(scope="module")
def bars():
    if not os.path.isfile(_DATA):
        pytest.skip("frozen hourly dataset not present")
    return _load_hourly()


def test_confluence_signal_count(bars):
    ts, op, hi, lo, cl = bars
    sigs = ict_htf.confluence_signals(hi, lo, cl, op)
    # goal: 149 confluence signals on the frozen 3-yr hourly set
    assert len(sigs) == 149


def test_confluence_pnl_reproduces_goal(bars):
    ts, op, hi, lo, cl = bars
    sigs = ict_htf.confluence_signals(hi, lo, cl, op)
    n, avg = _pnl(hi, lo, cl, sigs, rr=2.0)
    assert n == 149
    # findings.md: +0.59R/trade at rr2.0 (the headline confluence edge)
    assert avg == pytest.approx(0.593, abs=0.01)


def test_fvg_reaction_signal_count(bars):
    ts, op, hi, lo, cl = bars
    sigs = ict_htf.fvg_reaction_signals(hi, lo, cl, op)
    # goal: 1356 FVG-reaction signals (all FVGs, the +0.42R workhorse)
    assert len(sigs) == 1356


def test_fvg_reaction_pnl_reproduces_goal(bars):
    ts, op, hi, lo, cl = bars
    sigs = ict_htf.fvg_reaction_signals(hi, lo, cl, op)
    n, avg = _pnl(hi, lo, cl, sigs, rr=2.0)
    assert n == 1356
    # findings.md: +0.42R/trade at rr2.0
    assert avg == pytest.approx(0.421, abs=0.01)


def test_htf_setup_shape(bars):
    ts, op, hi, lo, cl = bars
    # a full-history setup call returns a well-formed dict (present or not)
    out = ict_htf.htf_setup(hi, lo, cl, op, hour_of_day=ts[-1][11:16], active_obs=[])
    assert "present" in out
    if out["present"]:
        assert out["tier"] in ("A+", "B")
        assert out["dir"] in ("long", "short")
        assert "reason" in out and out["ce"] is not None
