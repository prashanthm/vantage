"""Regime-gated 15-min forecaster — the E11 shadow arm (mira-inputs).

STEP-LEVEL finding (E11 preview, reversed the day-level E10b read): on TREND
steps (neg-gamma, stretched from VWAP) the DETERMINISTIC baseline wins
(0.658 vs Mira 0.500) — price runs to the mechanical liquidity draws the
pool-targeting nails; on CHOP steps MIRA wins (0.738 vs baseline 0.405) — the
LLM's contextual read of which way a range breaks beats fading to VWAP. So the
gate is: baseline on trend, Mira on chop. (My initial hypothesis had it
backwards — a day-aggregation illusion; the step-level truth inverts it, and
the flipped gate previews 0.700 vs Mira 0.625 / baseline 0.525.)

This is a THIRD shadow arm (run_id="gated:<day>"), scored alongside baseline
(run_id="baseline:<day>") and Mira (run_id NULL). Nothing is displayed or
retired until E11's live accrual proves the gate beats the better standalone
arm by >= 0.03 — it's overfit-prone on 6 backtest days, so it must earn it
live. Pure classifier + a selector over already-produced plots; no new LLM
call (it reuses Mira's live forecast when it picks "trend").
"""
from __future__ import annotations

import datetime as _dt
import logging

from . import baseline_forecast as _bf
from . import spx_snapshot as _snap
from .store import Store

log = logging.getLogger("vantage.gated_forecast")

#: live-available TREND test (no hindsight): amplify-mode gamma + a real
#: directional push (stretched from VWAP on decent volume). Tuned to the E10b
#: observation, deliberately simple; E11 measures whether it generalizes.
_VWAP_STRETCH_PT = 8.0
_MIN_RELVOL = 1.0


def classify_regime(snapshot: dict) -> str:
    """'trend' | 'chop' from live snapshot signal only."""
    reg = snapshot.get("regime") or {}
    tech = snapshot.get("technicals") or {}
    gamma = str(reg.get("gamma") or "").lower()
    vs_vwap = abs(float(tech.get("vs_vwap_pt") or 0))
    relvol = float(tech.get("rel_volume") or 0)
    if gamma == "negative" and vs_vwap >= _VWAP_STRETCH_PT and relvol >= _MIN_RELVOL:
        return "trend"
    return "chop"


def _mira_plot_for(store: Store, day: str, as_of: str) -> dict | None:
    """Mira's live forecast plot at this step (run_id NULL, matching as_of)."""
    for r in store.list_spx_forecasts_by_run(f"live:SPX:{day}"):
        if r.get("as_of") == as_of:
            fc = r.get("forecast") or {}
            plot = fc.get("plot") if isinstance(fc, dict) else None
            return plot if isinstance(plot, dict) else None
    return None


def gated_plot(store: Store, snapshot: dict, day: str, as_of: str) -> tuple[dict | None, str]:
    """The gated pick + which arm produced it. CHOP → Mira's live plot (the LLM
    reads range breaks; falls back to baseline if Mira hasn't forecast this step
    yet); TREND → baseline (mechanical liquidity draws win the directional run)."""
    regime = classify_regime(snapshot)
    if regime == "chop":
        mplot = _mira_plot_for(store, day, as_of)
        if mplot is not None:
            return mplot, "chop→mira"
        # Mira not yet available this step → don't fabricate; use baseline.
        return _bf.forecast(snapshot), "chop→baseline(mira-absent)"
    return _bf.forecast(snapshot), "trend→baseline"


def tick(store: Store, symbol: str = "SPX") -> dict | None:
    """One gated forecast for the current snapshot, saved under
    run_id="gated:<day>". Dedups per 15-min bucket. Store-only, best-effort."""
    if not getattr(store, "uses_sqlite", False):
        return None
    try:
        snapshot = _snap.build_snapshot(store, _today(), symbol)
        if not snapshot or not snapshot.get("price") or not snapshot.get("as_of"):
            return None
        day, as_of = snapshot["day"], snapshot["as_of"]
        run_id = f"gated:{day}"
        bucket = as_of[:16]
        if any((r.get("as_of") or "")[:16] == bucket
               for r in store.list_spx_forecasts_by_run(run_id)):
            return None
        plot, arm = gated_plot(store, snapshot, day, as_of)
        if plot is None:
            return None
        store.save_spx_forecast(
            symbol=symbol, day=day, as_of=as_of,
            price_at=snapshot.get("price"), snapshot=snapshot,
            forecast={"plot": plot, "headline": f"gated [{arm}] {plot['bias']}"},
            forecast_text=f"regime-gated ({arm}): {plot['bias']} -> {plot.get('target')}",
            run_id=run_id)
        return {"as_of": as_of, "arm": arm, **plot}
    except Exception as exc:  # noqa: BLE001 — shadow arm never breaks the poll
        log.warning("gated_forecast tick failed: %s", exc)
        return None


def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).astimezone(
        _dt.timezone(_dt.timedelta(hours=-4))).date().isoformat()


def _demo() -> None:
    """python -m vantage_server.gated_forecast — classifier self-check."""
    trend = {"regime": {"gamma": "negative"},
             "technicals": {"vs_vwap_pt": 14.0, "rel_volume": 1.2, "vwap": 100,
                            "rsi": 55, "atr": 2}, "price": 114.0, "levels": [],
             "ict": {"unswept_liquidity": {}}}
    chop = {"regime": {"gamma": "positive"},
            "technicals": {"vs_vwap_pt": 2.0, "rel_volume": 1.1}}
    assert classify_regime(trend) == "trend"
    assert classify_regime(chop) == "chop"
    # neg-gamma but NOT stretched → chop
    assert classify_regime({"regime": {"gamma": "negative"},
                            "technicals": {"vs_vwap_pt": 3.0, "rel_volume": 1.2}}) == "chop"
    print("ok — gated_forecast self-check passed")


if __name__ == "__main__":
    _demo()
