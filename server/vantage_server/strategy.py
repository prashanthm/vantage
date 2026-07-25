"""Strategy registry (ADR-015 lifecycle) — a named, registered Strategy behind a
registry, so the lifecycle layer looks strategies up by id and a second strategy
can register later without touching the lifecycle.

Modeled on brokers/base.py exactly: a Protocol + a @register_strategy decorator +
a STRATEGIES dict populated at import. `reclaim` is the first (and today only)
impl — it delegates to reclaim_strategy.py (the single source of truth for the
validated geometry + edge guard), it does NOT re-implement it. The registry adds
only what the lifecycle needs on top of the geometry: identity, the tradeable
universe, the strategy's champion backtest params, and the edge guard exposed
uniformly.

Pure — no I/O. The backtest BASELINE (a win-rate the promotion gate compares
against) is computed by the lifecycle layer from `champion_params()` against the
frozen backtest cache; this module only names the params, it does not run I/O.
"""
from __future__ import annotations

from typing import ClassVar, Protocol, runtime_checkable


@runtime_checkable
class Strategy(Protocol):
    """What every registered strategy must expose to the lifecycle.

    Identity + the tradeable universe + the edge guard + the champion backtest
    params (so the promotion gate can compute this strategy's own baseline).
    Signal/geometry generation stays in the strategy's source module (reclaim →
    reclaim_strategy.py); this protocol is the lifecycle's uniform view of it.
    """

    strategy_id: ClassVar[str]      # lifecycle id, e.g. "reclaim"
    display_name: ClassVar[str]     # human name
    universe: ClassVar[tuple[str, ...]]   # symbols this strategy trades

    def is_worth_taking(self, entry: float, stop: float, target: float | None,
                        side: str) -> tuple[bool, str]:
        """The edge guard — refuse a negative-edge trade before it's placed."""
        ...

    def champion_params(self) -> dict:
        """The frozen champion config the backtest baseline is computed with.
        (The lifecycle runs backtest.run_backtest with these against the frozen
        cache to get this strategy's baseline win-rate for the promotion gate.)"""
        ...


#: strategy_id -> Strategy instance. Populated by @register_strategy at import.
STRATEGIES: dict[str, Strategy] = {}


def register_strategy(cls):
    """Class decorator: instantiate the strategy and add it to STRATEGIES."""
    sid = getattr(cls, "strategy_id", None)
    if not sid or not isinstance(sid, str):
        raise ValueError(f"{cls.__name__} must define a non-empty strategy_id class attr")
    if sid in STRATEGIES:
        raise ValueError(
            f"duplicate strategy_id '{sid}': {cls.__name__} vs "
            f"{type(STRATEGIES[sid]).__name__}"
        )
    STRATEGIES[sid] = cls()
    return cls


def get_strategy(strategy_id: str) -> Strategy:
    """Look up a registered strategy instance by id."""
    try:
        return STRATEGIES[strategy_id]
    except KeyError:
        raise ValueError(
            f"unknown strategy '{strategy_id}' — registered: {sorted(STRATEGIES)}"
        ) from None


@(register_strategy if "reclaim" not in STRATEGIES else (lambda c: c))
class ReclaimStrategy:
    """The reclaim-3x5m strategy: enter after N consecutive closes back through a
    level, stop just beyond, target the next opposing level. Delegates ALL
    geometry + the edge guard to reclaim_strategy.py — the validated single
    source of truth — so this class never drifts from the discipline the goals
    proved."""

    strategy_id = "reclaim"
    display_name = "Reclaim 3×5m"
    universe = ("SPX", "SPY", "QQQ", "IWM")   # coach-snapshot symbols (GEX levels)

    def is_worth_taking(self, entry, stop, target, side):
        from .reclaim_strategy import is_worth_taking
        return is_worth_taking(entry, stop, target, side)

    def champion_params(self) -> dict:
        """The frozen reclaim champion — rr_min 1.5 + trend gate (coach-edge goal
        2026-07-16: WR 0.64 / PF 3.10 on the frozen window). These seed the
        backtest that produces this strategy's promotion baseline. Kept in sync
        with reclaim_strategy.MIN_REWARD_RISK via the self-check below."""
        from . import reclaim_strategy as rs
        return {
            "confirm_closes": rs.RECLAIM_CLOSES,
            "stop_pad_pct": rs.STOP_PAD_PCT,
            "rr_min": rs.MIN_REWARD_RISK,
            "suppress_counter_trend": True,
        }


class _ScannerFamilyStrategy:
    """Base for the scanner families (ADR-015 lifecycle entries). Their gate
    differs from reclaim's in both inputs:
      * paper win-rate comes from the SCANNER SPREAD BOOK (by-strategy stats,
        money-at-risk closes only) — flagged via ``paper_book = "scanner"``;
      * the baseline is a FROZEN CONSTANT from the pre-registered backtest
        record (claudedocs/goals/*), not a harness re-run — flagged via
        ``frozen_baseline_win_rate``. Change it only with a new frozen run.
    Setup quality is gated at scan time (tier A+ arms the paper trade), so the
    per-ticket edge guard is a pass-through here."""

    def is_worth_taking(self, entry, stop, target, side):
        return True, "gated at scan time (A+ tier arms the paper trade)"

    def champion_params(self) -> dict:
        return {}   # baseline is frozen, not re-derived (see class docstring)


@(register_strategy if "ict_htf" not in STRATEGIES else (lambda c: c))
class IctHtfStrategy(_ScannerFamilyStrategy):
    """A+ ICT hourly confluence stack (sweep → displacement FVG). Baseline
    0.378 = MEASURED on the frozen tape with the exact spread expression
    (arm at A+ scan, first-touch zone target vs invalidation, stop-first,
    245-bar cap): n=2234, halves 0.361/0.396 — scanner-families log,
    baseline run 2026-07-25 (research/ict_spread_baseline.py). NOTE: at the
    debit spread's ~1:1 payoff this WR is below breakeven — the lifecycle
    gate therefore also enforces PF ≥ 1.0 for scanner families."""
    strategy_id = "ict_htf"
    display_name = "A+ ICT hourly"
    universe = ("Nasdaq-100", "S&P top-100")
    paper_book = "scanner"
    frozen_baseline_win_rate = 0.378


@(register_strategy if "breakout_hold" not in STRATEGIES else (lambda c: c))
class BreakoutHoldStrategy(_ScannerFamilyStrategy):
    """Breakout-hold: 3 consecutive hourly closes above a ≥2-pivot resistance
    cluster (long-only). Baseline 0.822 = the frozen record n=416 PF 3.61 —
    scanner-families log, H1 addendum 2026-07-24."""
    strategy_id = "breakout_hold"
    display_name = "Breakout hold"
    universe = ("Nasdaq-100", "S&P top-100")
    paper_book = "scanner"
    frozen_baseline_win_rate = 0.822


@(register_strategy if "rsi2_mr" not in STRATEGIES else (lambda c: c))
class Rsi2MrStrategy(_ScannerFamilyStrategy):
    """RSI(2) dip in uptrend (Connors), time/MA exit, long-only. Baseline
    0.703 = the frozen record n=532 PF 1.487 halves 1.517/1.463 —
    scanner-families log, H6 2026-07-24."""
    strategy_id = "rsi2_mr"
    display_name = "RSI(2) dip"
    universe = ("Nasdaq-100", "S&P top-100")
    paper_book = "scanner"
    frozen_baseline_win_rate = 0.703


def _demo() -> None:
    """assert-based self-check (run: python -m vantage_server.strategy)."""
    from . import reclaim_strategy as rs

    assert "reclaim" in STRATEGIES
    # the three scanner families register with frozen baselines + scanner book
    for sid, wr in (("ict_htf", 0.378), ("breakout_hold", 0.822), ("rsi2_mr", 0.703)):
        st = get_strategy(sid)
        assert st.paper_book == "scanner" and st.frozen_baseline_win_rate == wr
    s = get_strategy("reclaim")
    assert s.strategy_id == "reclaim" and "SPX" in s.universe

    # the edge guard delegates to the SSOT (same verdict as reclaim_strategy).
    ok, _ = s.is_worth_taking(100.0, 99.8, 101.0, "long")     # R:R 5.0 → ok
    assert ok
    bad, why = s.is_worth_taking(100.0, 99.8, 99.5, "long")   # target wrong side
    assert not bad and "wrong side" in why

    # champion params stay in sync with the SSOT constants (drift guard).
    p = s.champion_params()
    assert p["rr_min"] == rs.MIN_REWARD_RISK
    assert p["confirm_closes"] == rs.RECLAIM_CLOSES
    assert p["stop_pad_pct"] == rs.STOP_PAD_PCT

    # unknown strategy is a clear error, not a KeyError.
    try:
        get_strategy("nope"); raise AssertionError("expected ValueError")
    except ValueError:
        pass

    print("ok — strategy registry self-check passed")


if __name__ == "__main__":
    _demo()
