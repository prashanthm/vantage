"""Deterministic 15-min SPX forecaster — the control arm (mira-inputs E9/E10).

E9 showed a rules-only read of the snapshot ties Mira's LLM forecast on
hit-rate (pooled 0.516 vs 0.556, no material edge) — so this ships as a LIVE
parallel forecaster that scores into the same table under run_id="baseline:
<day>", alongside Mira's production forecast (run_id NULL). Neither retires;
they accrue and self-score so the wash is confirmed (or refuted) live.

Pure + deterministic (ADR-008): snapshot in → {bias,target,invalidation} out.
No model, no orders. The logic is the pre-registered E9 rule, verbatim.
"""
from __future__ import annotations

import datetime as _dt
import logging

from . import spx_snapshot as _snap
from .store import Store

log = logging.getLogger("vantage.baseline_forecast")

_MAX_TGT_ATR = 3.0     # cap the target at 3x ATR — a 15-min-plausible draw


def _levels_around(snapshot: dict, price: float):
    lv = snapshot.get("levels") or []
    prices = sorted(float(x["price"]) for x in lv if x.get("price") is not None)
    return [p for p in prices if p > price], [p for p in prices if p < price]


def _pools(snapshot: dict, price: float):
    ict = (snapshot.get("ict") or {}).get("unswept_liquidity") or {}
    bsl = sorted(p for p in ict.get("bsl", []) if p > price)
    ssl = sorted((p for p in ict.get("ssl", []) if p < price), reverse=True)
    return (bsl[0] if bsl else None), (ssl[0] if ssl else None)


def forecast(snapshot: dict) -> dict | None:
    """The E9 rules plot from a snapshot, or None if it lacks price. Direction:
    RSI-stretch mean-reverts, else follow the VWAP side. Target: nearest ICT
    pool/level in-direction, capped 3xATR. Invalidation: SYMMETRIC (R:R=1),
    tightened only to a nearer real level — never widened (the falsifiable
    stop; E5/E6 lesson)."""
    price = float(snapshot.get("price") or 0)
    if not price:
        return None
    tech = snapshot.get("technicals") or {}
    vwap, rsi = tech.get("vwap"), tech.get("rsi")
    atr = float(tech.get("atr") or 3.0)
    above, below = _levels_around(snapshot, price)
    bsl, ssl = _pools(snapshot, price)

    if rsi is not None and rsi <= 30:
        bias = "up"
    elif rsi is not None and rsi >= 70:
        bias = "down"
    elif vwap is not None:
        bias = "up" if price >= vwap else "down"
    else:
        bias = "up"

    if bias == "up":
        cands = [c for c in (bsl, above[0] if above else None) if c is not None]
        target = min(min(cands) if cands else price + 2 * atr, price + _MAX_TGT_ATR * atr)
        stop_ref = below[0] if below else price - 2 * atr
    else:
        cands = [c for c in (ssl, below[0] if below else None) if c is not None]
        target = max(max(cands) if cands else price - 2 * atr, price - _MAX_TGT_ATR * atr)
        stop_ref = above[0] if above else price + 2 * atr

    tgt_dist = abs(target - price)
    if bias == "up":
        invalid = price - tgt_dist
        if stop_ref < price and (price - stop_ref) < tgt_dist:
            invalid = stop_ref
    else:
        invalid = price + tgt_dist
        if stop_ref > price and (stop_ref - price) < tgt_dist:
            invalid = stop_ref

    return {"bias": bias, "target": round(target, 1), "invalidation": round(invalid, 1)}


def tick(store: Store, symbol: str = "SPX") -> dict | None:
    """One live baseline forecast for the current snapshot, saved under
    run_id="baseline:<day>". Dedups per (day, 15-min bucket) so the 60s
    heartbeat writes at most one row per step. Store-only; returns the saved
    plot summary or None. Best-effort — never raises into the poll."""
    if not getattr(store, "uses_sqlite", False):
        return None
    try:
        snapshot = _snap.build_snapshot(store, _today(), symbol)
        if not snapshot or not snapshot.get("available") or not snapshot.get("as_of"):
            return None
        day = snapshot["day"]
        as_of = snapshot["as_of"]
        run_id = f"baseline:{day}"
        bucket = as_of[:16]   # minute precision is fine; the loop is 15-min-ish
        existing = store.list_spx_forecasts_by_run(run_id)
        if any((r.get("as_of") or "")[:16] == bucket for r in existing):
            return None       # already have this step
        plot = forecast(snapshot)
        if plot is None:
            return None
        store.save_spx_forecast(
            symbol=symbol, day=day, as_of=as_of,
            price_at=snapshot.get("price"), snapshot=snapshot,
            forecast={"plot": plot,
                      "headline": f"baseline {plot['bias']} → {plot['target']}"},
            forecast_text=(f"deterministic control (E9): {plot['bias']} toward "
                           f"{plot['target']}, invalid {plot['invalidation']}"),
            run_id=run_id)
        return {"as_of": as_of, **plot}
    except Exception as exc:  # noqa: BLE001 — the control arm never breaks the poll
        log.warning("baseline_forecast tick failed: %s", exc)
        return None


def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).astimezone(
        _dt.timezone(_dt.timedelta(hours=-4))).date().isoformat()  # ET


def _demo() -> None:
    """assert-based self-check (python -m vantage_server.baseline_forecast)."""
    # RSI-stretched-low → up; symmetric stop as far as the target.
    snap = {"price": 100.0, "technicals": {"vwap": 102.0, "rsi": 22, "atr": 2.0},
            "levels": [{"price": 106.0}, {"price": 94.0}],
            "ict": {"unswept_liquidity": {"bsl": [104.0], "ssl": [96.0]}}}
    p = forecast(snap)
    assert p["bias"] == "up" and p["target"] == 104.0
    assert abs((100.0 - p["invalidation"]) - (104.0 - 100.0)) < 0.01  # symmetric
    # RSI-high → down
    snap2 = {**snap, "technicals": {"vwap": 98.0, "rsi": 75, "atr": 2.0}}
    assert forecast(snap2)["bias"] == "down"
    # no price → None
    assert forecast({"technicals": {}}) is None
    print("ok — baseline_forecast self-check passed")


if __name__ == "__main__":
    _demo()
