"""The reclaim trade — ONE source of truth for the validated setup.

The strategy-winrate + reclaim-interval goals validated this discipline:
enter only after N consecutive closes back through a level (never on the
touch), stop just beyond the level, target the next opposing level. That rule
lived in three places (paper.py's fill logic, the two Pine generators), which
drift. This module is the single definition every surface derives from:

* paper.py imports RECLAIM_CLOSES / STOP_PAD_PCT and the geometry helpers so
  the paper track record IS the validated strategy;
* the Pine generators seed their inputs from these constants (a test asserts
  the generated defaults equal them, so Python and Pine can't disagree);
* the standalone shareable Pine strategy()/indicator() carry the same numbers.

Pure, deterministic, no I/O — just the numbers and the trade geometry.
"""
from __future__ import annotations

# --- the validated discipline (do not change without re-running the goal) ----

#: Consecutive closes back through a level required before an entry fires. The
#: interval sweep found 3 consecutive 5m closes beat every alternative tested.
RECLAIM_CLOSES = 3

#: The stop sits this % beyond the reclaimed signal level (below for a long,
#: above for a short).
STOP_PAD_PCT = 0.20

#: A pending reclaim that never confirms within this window expires unfilled.
PENDING_EXPIRE_HOURS = 48.0

#: Default notional size for P&L display / paper trades.
DEFAULT_SHARES = 100


def stop_for(level: float, side: str) -> float:
    """The stop price for a reclaim entry at ``level``. Long → stop below by
    STOP_PAD_PCT; short → stop above. (util for paper + any Python consumer.)"""
    pad = STOP_PAD_PCT / 100.0
    return level * (1 - pad) if side == "long" else level * (1 + pad)


def target_for(level: float, side: str,
               supports: list[float], resistances: list[float]) -> float | None:
    """The target price: the NEXT OPPOSING level. Long (buy the dip at support)
    → next resistance above; short (fade the rally at resistance) → next support
    below. None when there is no opposing level (open-ended)."""
    if side == "long":
        return next((r for r in sorted(resistances) if r > level), None)
    return next((s for s in sorted(supports, reverse=True) if s < level), None)


#: How many laddered targets a reclaim trade scales out to (T1/T2/T3 = the next
#: N opposing levels beyond the entry). T1 is the validated :func:`target_for`.
TARGET_COUNT = 3

# --- durable-levels filter (live-pivot mode: any symbol without GEX) ----------
# A raw fractal pivot is noise; a level is a pivot price returns to and respects.
# These defaults gate a self-computed level before it can trigger a reclaim, so
# the any-symbol version isn't a wall of signals. GEX levels bypass the filter
# (already durable). Tunable per symbol via the Pine inputs.

#: A pivot must be re-tested this many times before it counts as a level.
MIN_TOUCHES = 2

#: Suppress a new signal within this % of the previous one (de-cluster).
MIN_GAP_PCT = 0.35

#: Skip a reclaim whose nearest target isn't worth the stop (0 = no gate).
MIN_RR = 1.0

#: Structural dimensions that must stack at a level before a reclaim can fire
#: there (the pivot itself counts as 1; fib / round number / prior-day H-L-C /
#: daily 50-200 MA / second-TF pivot agreement add one each). 2 = the playbook's
#: "confluence ✦" bar: a pivot alone is not a tradeable level. GEX levels
#: bypass (already curated). Backtested: 2 validated, 3 starves the edge.
MIN_CONFLUENCE = 2

#: How close (% of price) a dimension must sit to a level to count as stacking.
#: Mirrors the backtest champion's zone-clustering tolerance
#: (backtest.DEFAULT_PARAMS["confluence_tol_pct"]) — tighter widths starve the
#: confluence gate into producing no levels at all.
CONF_TOL_PCT = 0.15


def target_ladder(level: float, side: str,
                  supports: list[float], resistances: list[float],
                  count: int = TARGET_COUNT) -> list[float]:
    """The next ``count`` OPPOSING levels beyond ``level``, nearest first —
    T1/T2/T3 for scaling out. Long → the ascending resistances above; short →
    the descending supports below. Shorter than ``count`` (or empty) when the
    book runs out of levels; T1 always equals :func:`target_for`."""
    if side == "long":
        ladder = [r for r in sorted(resistances) if r > level]
    else:
        ladder = [s for s in sorted(supports, reverse=True) if s < level]
    return ladder[:count]


def risk_reward(entry: float, stop: float, target: float | None) -> float | None:
    """Reward:risk ratio for the trade, or None when target is open-ended."""
    risk = abs(entry - stop)
    if not risk or target is None:
        return None
    return round(abs(target - entry) / risk, 2)
