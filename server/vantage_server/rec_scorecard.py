"""Recommendation scorecard — the pipeline's own track record, measured.

Scores PAST decision-journal recommendations against what the bars did next:
for every dated decision, the forward close-to-close return at +5 and +20
trading days, aggregated per rule. This is the calibration loop: a synthesis
that knows "rule2_freefall_close hit 62% over 34 signals" can weigh the
signal by its record instead of taking it on faith.

Hit definition (pinned in the payload as ``hit_basis``): a decision is
directional — CLOSE_* recommendations are bearish calls (hit when the +20d
return is negative: selling avoided further loss); HOLD_* are constructive
(hit when +20d >= 0). MONITOR is not a call and is excluded from hit rates
(counted separately). Decisions younger than the horizon are pending, not
scored — never extrapolated.

PURE aggregation over injected journal days + bars; the Store-backed wrapper
computes on demand from data the nightly already syncs (no schema change —
deliberate deviation from the plan's nightly-table sketch: same determinism,
zero migration risk; revisit if journals grow past ~thousands of decisions).
"""
from __future__ import annotations

import os
from typing import Any

_HORIZONS = (5, 20)
_HIT_HORIZON = 20
_BEARISH = ("CLOSE_AND_BOOK_LOSS", "HOLD_WASH_BLOCKED")
_BULLISH = ("HOLD_AND_SELL_CALL",)


def forward_return(daily: list[dict], from_date: str, days: int) -> float | None:
    """Close-to-close return ``days`` trading days after ``from_date``, or None
    (unknown symbol/date, or the horizon hasn't elapsed yet)."""
    idx = None
    for i, bar in enumerate(daily):
        if str(bar.get("date", ""))[:10] >= from_date[:10]:
            idx = i
            break
    if idx is None or idx + days >= len(daily):
        return None
    start = daily[idx].get("close")
    end = daily[idx + days].get("close")
    if not start:
        return None
    return float(end) / float(start) - 1.0


def build_scorecard(
    journal_days: list[dict],
    bars_by_symbol: dict[str, list[dict]],
) -> dict[str, Any]:
    """Per-rule aggregation of forward returns for every scoreable decision."""
    rules: dict[str, dict[str, Any]] = {}
    pending = 0
    for day in journal_days:
        date = str(day.get("date", ""))[:10]
        for decision in day.get("decisions") or []:
            rule = str(decision.get("rule") or decision.get("recommendation") or "?")
            rec = str(decision.get("recommendation") or "")
            sym = str(decision.get("symbol") or "").upper()
            daily = bars_by_symbol.get(sym) or []
            fwd = {h: forward_return(daily, date, h) for h in _HORIZONS}
            if fwd[_HIT_HORIZON] is None:
                pending += 1
                continue
            bucket = rules.setdefault(rule, {
                "rule": rule, "recommendation": rec, "n": 0,
                "hits": 0, "calls": 0,
                **{f"sum_fwd_{h}d": 0.0 for h in _HORIZONS},
            })
            bucket["n"] += 1
            for h in _HORIZONS:
                if fwd[h] is not None:
                    bucket[f"sum_fwd_{h}d"] += fwd[h]
            if rec in _BEARISH:
                bucket["calls"] += 1
                bucket["hits"] += 1 if fwd[_HIT_HORIZON] < 0 else 0
            elif rec in _BULLISH:
                bucket["calls"] += 1
                bucket["hits"] += 1 if fwd[_HIT_HORIZON] >= 0 else 0

    out_rules = []
    for bucket in sorted(rules.values(), key=lambda b: -b["n"]):
        row: dict[str, Any] = {
            "rule": bucket["rule"],
            "recommendation": bucket["recommendation"],
            "n_scored": bucket["n"],
            "hit_rate": (round(bucket["hits"] / bucket["calls"], 3)
                         if bucket["calls"] else None),
            "n_calls": bucket["calls"],
        }
        for h in _HORIZONS:
            row[f"avg_fwd_{h}d"] = round(bucket[f"sum_fwd_{h}d"] / bucket["n"], 4)
        out_rules.append(row)

    return {
        "rules": out_rules,
        "n_pending": pending,
        "hit_basis": ("bearish calls (CLOSE_*) hit when +20d return < 0; "
                      "constructive calls (HOLD_*) hit when +20d >= 0; "
                      "MONITOR excluded from hit rates"),
        "horizons_days": list(_HORIZONS),
    }


def rec_scorecard(
    data_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any] | None:
    """Store-backed scorecard over every journaled analysis day. None when no
    journal exists yet."""
    from .store import Store, resolve_data_dir

    store = Store(resolve_data_dir(data_dir))
    days = _load_all_days(store)
    if not days:
        return None
    symbols = {str(d.get("symbol") or "").upper()
               for day in days for d in day.get("decisions") or []}
    bars: dict[str, list[dict]] = {}
    for sym in sorted(s for s in symbols if s):
        data = store.load_bars(sym)
        daily = data.get("daily") if isinstance(data, dict) else None
        if isinstance(daily, list) and daily:
            bars[sym] = daily
    return build_scorecard(days, bars)


def _load_all_days(store) -> list[dict]:
    """Every journaled analysis day, oldest first (both backends)."""
    dates = _analysis_dates(store)
    days = []
    for date in sorted(dates):
        day = store.load_analysis_day(date)
        if isinstance(day, dict) and day.get("decisions"):
            day = dict(day)
            day.setdefault("date", date)  # SQLite rows don't carry the date key
            days.append(day)
    return days


def _analysis_dates(store) -> list[str]:
    if store.uses_sqlite:
        conn = store._backend._conn()
        try:
            rows = conn.execute("SELECT DISTINCT date FROM analysis").fetchall()
        finally:
            conn.close()
        return [str(r[0]) for r in rows]
    from pathlib import Path
    analysis_dir = Path(store.data_dir) / "analysis"
    if not analysis_dir.is_dir():
        return []
    return [p.stem for p in analysis_dir.glob("*.json") if p.stem != "latest"]
