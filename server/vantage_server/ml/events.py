"""Event proximity — the deterministic, free EVENT features.

PURE, I/O-free, fully deterministic. Given a round-trip's open/close dates and a
list of the underlying's earnings report dates, answers the two questions that
matter for P/L: was there an earnings report shortly BEFORE the entry (so the
trade was opened into a fresh reaction), and did one land DURING the hold
(earnings-in-hold is a classic P/L driver — a gap right through your position)?

This is the PRIMARY event feature: no LLM, no network, no credentials — just
date arithmetic against dates the broker already exposes. ``earnings_within`` is
the pure kernel; ``fetch_earnings`` (the I/O sibling module) supplies the dates.
"""
from __future__ import annotations

import datetime as _dt


def _parse_date(value) -> _dt.date | None:
    """ISO date/timestamp -> date (tolerates trailing Z and bare dates), or None.

    Mirrors features._parse_date so this module stays self-contained."""
    if not value:
        return None
    if isinstance(value, _dt.date):
        return value
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _dt.datetime.fromisoformat(text).date()
    except ValueError:
        try:
            return _dt.date.fromisoformat(text[:10])
        except ValueError:
            return None


def earnings_within(
    open_date, close_date, earnings_dates, *, window_days: int = 5,
) -> dict:
    """Was earnings near the entry or inside the hold?

    ``open_date`` / ``close_date`` are the round-trip's ISO dates (or date
    objects). ``earnings_dates`` is an iterable of ISO earnings-report dates for
    the underlying (from fetch_earnings). ``window_days`` is the look-back
    window before entry.

    Returns::

        {before_entry: bool, during_hold: bool, nearest_days: int | None}

    where

      * ``before_entry`` — an earnings report fell in
        [open_date - window_days, open_date] (opened into a fresh reaction).
      * ``during_hold``  — an earnings report fell strictly AFTER open_date and
        on/before close_date (a report gapped through the open position). When
        close_date is unknown the hold is open-ended, so any earnings after
        open_date counts.
      * ``nearest_days`` — signed day-distance from open_date to the CLOSEST
        earnings date (negative = earnings before entry, positive = after), or
        None when there are no parseable earnings dates / no open_date.

    All three are computed only from the dates given — deterministic, no
    fabrication. With no earnings dates: before/during are False,
    nearest_days is None (unknown, not zero)."""
    od = _parse_date(open_date)
    cd = _parse_date(close_date)
    dates = [d for e in (earnings_dates or []) if (d := _parse_date(e)) is not None]

    if od is None or not dates:
        return {"before_entry": False, "during_hold": False, "nearest_days": None}

    before_entry = False
    during_hold = False
    nearest_days: int | None = None

    for ed in dates:
        delta = (ed - od).days  # negative = earnings before entry
        if nearest_days is None or abs(delta) < abs(nearest_days):
            nearest_days = delta

        # before entry: within window_days BEFORE (inclusive of the day itself)
        if -window_days <= delta <= 0:
            before_entry = True

        # during hold: strictly after entry, on/before exit (open-ended if no exit)
        if delta > 0 and (cd is None or ed <= cd):
            during_hold = True

    return {
        "before_entry": before_entry,
        "during_hold": during_hold,
        "nearest_days": nearest_days,
    }


def next_earnings(earnings_dates, today) -> dict:
    """Forward calendar read from a list of earnings dates — the analyst's
    "is a report imminent?" question, same pure-kernel contract as
    :func:`earnings_within`.

    Returns::

        {next_date, days_until, last_date, days_since}

    ``next_date``/``days_until`` cover the nearest date on/after ``today``;
    ``last_date``/``days_since`` the most recent one before it. All None when
    no dates parse. ``next_date`` None with ``last_date`` set means "no future
    date IN THIS LIST" — the caller must not read it as "no earnings scheduled"
    (broker caches go stale the day after each report)."""
    ref = _parse_date(today)
    dates = sorted(d for e in (earnings_dates or []) if (d := _parse_date(e)) is not None)
    if ref is None or not dates:
        return {"next_date": None, "days_until": None,
                "last_date": None, "days_since": None}

    future = [d for d in dates if d >= ref]
    past = [d for d in dates if d < ref]
    nxt = future[0] if future else None
    last = past[-1] if past else None
    return {
        "next_date": nxt.isoformat() if nxt else None,
        "days_until": (nxt - ref).days if nxt else None,
        "last_date": last.isoformat() if last else None,
        "days_since": (ref - last).days if last else None,
    }
