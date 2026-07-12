"""Forward catalyst path — the dated events ahead, from sources we already have.

The next earnings date is one catalyst; a real analyst also watches the ex-
dividend date and the monthly/quarterly OpEx where dealer positioning rolls
off. This module fuses the THREE cheaply-sourced dated events into one ordered
forward path with days-until:

* earnings — the cached broker dates (ml/fetch_earnings)
* ex-dividend — yfinance ``exDividendDate`` (via fundamentals cache)
* opex — deterministic third-Friday math (spx_playbook.opex_layer)

PURE assembly over provided inputs; nothing is fabricated — a source with no
date simply contributes no event. No speculative "product launch" guesses:
only events with a real, verifiable date. The nearest event is the catalyst
gate an "act now" recommendation should be conditional on.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any


def _parse(value) -> _dt.date | None:
    if not value:
        return None
    if isinstance(value, _dt.date):
        return value
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1]
    try:
        return _dt.date.fromisoformat(text[:10])
    except ValueError:
        return None


def catalyst_path(
    today: _dt.date | str,
    *,
    earnings_dates: list | None = None,
    ex_dividend: _dt.date | str | None = None,
    opex: dict | None = None,
    horizon_days: int = 90,
) -> dict[str, Any]:
    """The ordered forward catalysts within ``horizon_days``.

    Returns ``{events: [{kind, date, days_until, note}], next, horizon_days}``
    sorted by date; ``next`` is the nearest (the gate). Every event has a real
    date — missing sources contribute nothing. ``next`` is None when no dated
    event falls in the window."""
    ref = _parse(today)
    events: list[dict[str, Any]] = []
    if ref is None:
        return {"events": [], "next": None, "horizon_days": horizon_days}

    def add(kind: str, date, note: str) -> None:
        d = _parse(date)
        if d is None or d < ref:
            return
        days = (d - ref).days
        if days > horizon_days:
            return
        events.append({"kind": kind, "date": d.isoformat(),
                       "days_until": days, "note": note})

    # earnings — nearest future report from the cached dates
    for e in sorted({str(x)[:10] for x in (earnings_dates or []) if x}):
        d = _parse(e)
        if d is not None and d >= ref:
            add("earnings", d, "quarterly earnings report — biggest single-name catalyst")
            break  # only the next one

    if ex_dividend is not None:
        add("ex_dividend", ex_dividend,
            "ex-dividend date — price drops ~the dividend; not a P/L event if you hold through")

    if isinstance(opex, dict):
        kind = ("triple_witching" if opex.get("next_opex_quarterly") else "opex")
        note = ("quarterly triple-witching — heavy dealer gamma roll-off, "
                "regime can shift after" if opex.get("next_opex_quarterly")
                else "monthly OpEx — dealer positioning rolls off")
        add(kind, opex.get("next_opex"), note)

    events.sort(key=lambda e: e["date"])
    return {
        "events": events,
        "next": events[0] if events else None,
        "horizon_days": horizon_days,
    }
