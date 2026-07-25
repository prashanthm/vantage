"""Forecast calibration — the analyst's OWN scored record, bucketed by the
conditions it forecasts under (gamma regime × time-of-day). Every 15-minute
call is scored and stored; this module is the first thing that reads that
record back as a prior. Code-side only (ADR-008): the table is computed
here and DISPLAYED next to the standing call — injecting it into the
forecast prompt is a separate, pre-registered replay experiment (E9 in the
mira-inputs goal), not something this module does.

LIVE rows only (run_id IS NULL): replay-experiment forecasts carry prompt
variants and would contaminate the production record.
"""
from __future__ import annotations

from .store import Store

_MIN_N = 8   # a bucket below this renders as sample-only, no rate quoted


def _hour_bucket(as_of: str) -> str | None:
    hm = str(as_of)[11:16]
    if ":" not in hm:
        return None
    h, m = hm.split(":")
    mins = int(h) * 60 + int(m)
    if mins < 630:
        return "open"     # 9:30–10:30 ET
    if mins < 840:
        return "midday"   # 10:30–14:00
    return "late"         # 14:00+


def calibration(store: Store, symbol: str = "SPX") -> dict:
    """Bucketed verdict rates over all SCORED live forecasts. Returns
    {overall, conditions: [{gamma, hour, n, hit_rate, invalidated_rate}]}."""
    if not getattr(store, "uses_sqlite", False):
        return {"available": False}
    conn = store._backend._conn()  # noqa: SLF001 — read-only SELECT
    try:
        rows = conn.execute(
            "SELECT as_of, snapshot, score FROM spx_forecast "
            "WHERE run_id IS NULL AND symbol=? AND score IS NOT NULL",
            (symbol,)).fetchall()
    finally:
        conn.close()
    from . import db as _db
    buckets: dict[tuple, dict] = {}
    tot = {"n": 0, "hit": 0, "invalidated": 0}
    for r in rows:
        score = _db.loads(r["score"], {}) or {}
        verdict = str(score.get("verdict") or "")
        if not verdict or verdict == "inconclusive":
            continue
        snap = _db.loads(r["snapshot"], {}) or {}
        gamma = ((snap.get("regime") or {}).get("gamma")) or "?"
        hour = _hour_bucket(r["as_of"]) or "?"
        b = buckets.setdefault((gamma, hour), {"n": 0, "hit": 0, "invalidated": 0})
        for d in (b, tot):
            d["n"] += 1
            d["hit"] += verdict == "hit"
            d["invalidated"] += verdict.startswith("invalid")
    conds = []
    for (gamma, hour), b in sorted(buckets.items()):
        row = {"gamma": gamma, "hour": hour, "n": b["n"]}
        if b["n"] >= _MIN_N:
            row["hit_rate"] = round(b["hit"] / b["n"], 3)
            row["invalidated_rate"] = round(b["invalidated"] / b["n"], 3)
        conds.append(row)
    overall = {"n": tot["n"]}
    if tot["n"]:
        overall["hit_rate"] = round(tot["hit"] / tot["n"], 3)
        overall["invalidated_rate"] = round(tot["invalidated"] / tot["n"], 3)
    return {"available": True, "symbol": symbol, "min_n": _MIN_N,
            "overall": overall, "conditions": conds}
