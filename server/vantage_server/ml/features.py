"""Entry-condition FEATURES — "what were the conditions when I opened this?"

PURE, I/O-free, fully deterministic. Given a labeled round-trip and the bars
AVAILABLE AT ITS ENTRY, computes the regime/momentum/setup/timing features that
the Bayesian bucket layer (buckets.py) groups win/loss by.

THE NO-LEAKAGE RULE (critical). Entry-time features describe the chart as it
looked at ``open_date`` — they MUST be computed from bars dated <= open_date
only, never from bars that only exist after the trade opened. ``entry_features``
takes bars that are ALREADY SLICED to <= open_date by the caller (this is the
contract; see the ``bars_daily_at_entry`` docstring). ``features_for_all`` does
that slicing per trip via ``slice_bars_at``, so appending later bars to a
symbol's series can never change an old trade's features. A test asserts exactly
this invariant.

For OPTIONS the round-trip carries only the underlying in ``symbol``; the
strike/expiry/right needed for DTE + moneyness come from the OPTION DISPLAY
SYMBOL ("UND YYYY-MM-DD STRIKE[C|P]"), passed in as ``display_symbol`` (the
caller resolves it from the opening order). Regime/momentum/vol features use the
UNDERLYING's bars for both equities and options.
"""
from __future__ import annotations

import datetime as _dt
import re
import statistics

from . import events as events_engine
from .. import technicals as tech

_MULTIPLIER = 100.0  # option contract multiplier (shares per contract)


# --------------------------------------------------------------- date utils

def _parse_date(value) -> _dt.date | None:
    """ISO date/timestamp -> date (tolerates trailing Z and bare dates), or None."""
    if not value:
        return None
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


def slice_bars_at(bars: list[dict], open_date) -> list[dict]:
    """Bars dated ON OR BEFORE ``open_date`` — the no-leakage slice.

    Keeps only bars whose date <= open_date so a feature computed for an entry
    reflects only the chart available at that entry, never post-entry data.
    ``open_date`` may be an ISO string or a date. Returns [] when open_date is
    unparseable (no anchor -> no entry-time window). Input order is preserved
    (bars are oldest -> newest by contract)."""
    cutoff = _parse_date(open_date)
    if cutoff is None:
        return []
    out = []
    for b in bars or []:
        d = _parse_date(b.get("date"))
        if d is not None and d <= cutoff:
            out.append(b)
    return out


# ----------------------------------------------------------- feature helpers

def _closes(bars: list[dict]) -> list[float]:
    out = []
    for b in bars:
        c = b.get("close")
        if c not in (None, ""):
            try:
                out.append(float(c))
            except (TypeError, ValueError):
                continue
    return out


def _ma_position(closes: list[float], period: int) -> str | None:
    """"above" | "below" | None (too few bars) — last close vs its SMA(period)."""
    if len(closes) < period:
        return None
    ma = sum(closes[-period:]) / period
    if ma == 0:
        return None
    return "above" if closes[-1] >= ma else "below"


def _realized_vol_percentile(closes: list[float], window: int = 20) -> dict:
    """Where the recent ~``window``-day realized vol sits vs the trailing year.

    Realized vol = stdev of daily simple returns over the last ``window`` bars.
    We then compute that same rolling vol at every day across the (up to ~252)
    trailing bars and return the PERCENTILE rank of the latest value among them:
    "did I enter in a high-vol or low-vol regime?".

    Returns {vol, percentile (0..1 or None), band ("low"|"medium"|"high"|None)}.
    Percentile/band are None when there aren't enough bars to form even two
    rolling windows to rank against (percentile is undefined with one sample)."""
    def returns(seq: list[float]) -> list[float]:
        out = []
        for i in range(1, len(seq)):
            if seq[i - 1] != 0:
                out.append((seq[i] - seq[i - 1]) / seq[i - 1])
        return out

    if len(closes) < window + 1:
        return {"vol": None, "percentile": None, "band": None}

    rets = returns(closes)
    # rolling stdev of returns over ``window`` return-observations
    rolling: list[float] = []
    for end in range(window, len(rets) + 1):
        chunk = rets[end - window:end]
        if len(chunk) >= 2:
            rolling.append(statistics.pstdev(chunk))
    if not rolling:
        return {"vol": None, "percentile": None, "band": None}

    latest = rolling[-1]
    # trailing-year context: rank the latest among the trailing rolling values.
    history = rolling[-252:] if len(rolling) > 252 else rolling
    if len(history) < 2:
        return {"vol": round(latest, 8), "percentile": None, "band": None}
    below = sum(1 for v in history if v < latest)
    equal = sum(1 for v in history if v == latest)
    # mid-rank percentile (handles ties): (below + equal/2) / n
    pct = (below + equal / 2.0) / len(history)
    if pct < 1.0 / 3.0:
        band = "low"
    elif pct < 2.0 / 3.0:
        band = "medium"
    else:
        band = "high"
    return {"vol": round(latest, 8), "percentile": round(pct, 6), "band": band}


def _nearest_distance(levels: list, current_price: float) -> float | None:
    """Signed pct distance from ``current_price`` to the nearest level, or None
    when there are no levels. Positive = level is above price; the caller reads
    magnitude for "how close"."""
    if not levels or current_price == 0:
        return None
    nearest = min(levels, key=lambda lv: abs(lv.price - current_price))
    return (nearest.price - current_price) / current_price


def _holding_bucket(holding_days) -> str | None:
    """0-1d | 2-5d | 1-4wk | >1mo — the coarse duration band, or None."""
    if holding_days is None:
        return None
    d = int(holding_days)
    if d <= 1:
        return "0-1d"
    if d <= 5:
        return "2-5d"
    if d <= 28:
        return "1-4wk"
    return ">1mo"


_NEAR_PCT = 0.03  # within 3% of a level counts as "at" that level

_OPTION_RE = re.compile(
    r"^\s*(?P<und>\S+)\s+(?P<exp>\d{4}-\d{2}-\d{2})\s+(?P<strike>[\d.]+)(?P<right>[CP])\s*$",
    re.IGNORECASE,
)


def parse_option_symbol(display_symbol: str) -> dict | None:
    """Parse "UND YYYY-MM-DD STRIKE[C|P]" -> {underlying, expiry, strike, right}.

    ``right`` is "call" | "put". Returns None when the string is not an option
    display symbol (a plain equity ticker, or a malformed string)."""
    m = _OPTION_RE.match(str(display_symbol or ""))
    if not m:
        return None
    return {
        "underlying": m.group("und").upper(),
        "expiry": m.group("exp"),
        "strike": float(m.group("strike")),
        "right": "call" if m.group("right").upper() == "C" else "put",
    }


def _option_features(
    display_symbol: str, *, open_date: _dt.date, underlying_price: float | None,
) -> dict:
    """DTE + moneyness for an option, from its display symbol + entry price.

    dte = expiry - open_date in days; dte_band buckets it (0dte | <7dte |
    1-4wk | >1mo). moneyness compares strike to the underlying price at entry:
    ITM/ATM/OTM (ATM within 1%), plus signed moneyness_pct. When the underlying
    price at entry is unknown, moneyness is None."""
    parsed = parse_option_symbol(display_symbol)
    if parsed is None:
        return {}
    exp = _parse_date(parsed["expiry"])
    dte = (exp - open_date).days if exp is not None else None
    if dte is None:
        dte_band = None
    elif dte <= 0:
        dte_band = "0dte"
    elif dte < 7:
        dte_band = "<7dte"
    elif dte <= 28:
        dte_band = "1-4wk"
    else:
        dte_band = ">1mo"

    strike = parsed["strike"]
    right = parsed["right"]
    moneyness = None
    moneyness_pct = None
    if underlying_price and underlying_price > 0:
        # signed pct the option is in the money by (positive = ITM)
        if right == "call":
            itm_pct = (underlying_price - strike) / underlying_price
        else:
            itm_pct = (strike - underlying_price) / underlying_price
        moneyness_pct = round(itm_pct, 6)
        if abs(itm_pct) <= 0.01:
            moneyness = "ATM"
        elif itm_pct > 0:
            moneyness = "ITM"
        else:
            moneyness = "OTM"

    return {
        "option_type": right,
        "strike": strike,
        "expiry": parsed["expiry"],
        "dte": dte,
        "dte_band": dte_band,
        "moneyness": moneyness,
        "moneyness_pct": moneyness_pct,
    }


# ------------------------------------------------------------- entry_features

def entry_features(
    roundtrip,
    *,
    bars_daily_at_entry: list[dict],
    bars_weekly_at_entry: list[dict] | None = None,
    display_symbol: str | None = None,
    earnings_dates: list[str] | None = None,
    account_value: float | None = None,
    earnings_window_days: int = 5,
) -> dict:
    """Entry-time features for one round-trip.

    ``roundtrip`` is a RoundTrip (or a dict with the same fields). The bars are
    the caller's slice of the underlying's series to <= open_date — see the
    NO-LEAKAGE RULE in the module docstring; this function trusts the slice and
    only reads the LAST bar's close as "price at entry". (``features_for_all``
    produces the slice; ``entry_features`` never looks past what it's given.)

    ``bars_daily_at_entry``: daily bars dated <= open_date, oldest -> newest.
    ``bars_weekly_at_entry``: weekly bars dated <= open_date (optional; when
    None, weekly trend is None).
    ``display_symbol``: the OPTION display symbol ("UND YYYY-MM-DD STRIKE[C|P]")
    for kind=="option" — supplies strike/expiry/right for DTE + moneyness. None
    for equities.
    ``earnings_dates``: ISO dates of the symbol's earnings; when provided,
    ``earnings_within_window`` is True if any falls within
    ±``earnings_window_days`` of open_date. Default None -> the flag is None
    (unknown, not False).
    ``account_value``: when provided, the position notional vs it buckets
    ``size_tertile`` (small<1%/med 1-5%/large>5% of account) — else None.

    Returns a flat dict of features (values are strings/bools/numbers/None).
    Fields that can't be computed (too few bars, unknown entry) are None, never
    fabricated."""
    rt = _as_dict(roundtrip)
    open_date = _parse_date(rt.get("open_date"))
    kind = str(rt.get("kind") or "")
    daily = bars_daily_at_entry or []
    weekly = bars_weekly_at_entry or []
    closes = _closes(daily)
    entry_bar_price = closes[-1] if closes else None

    feats: dict = {}

    # --- regime / trend -------------------------------------------------
    if daily:
        d_trend = tech.trend(daily)
        feats["daily_trend"] = d_trend.direction
        feats["daily_trend_strength"] = round(d_trend.strength, 4)
    else:
        feats["daily_trend"] = None
        feats["daily_trend_strength"] = None
    feats["weekly_trend"] = tech.trend(weekly).direction if weekly else None

    feats["price_vs_ma20"] = _ma_position(closes, 20)
    feats["price_vs_ma50"] = _ma_position(closes, 50)
    feats["price_vs_ma200"] = _ma_position(closes, 200)

    # --- volatility regime (percentile vs trailing year) ----------------
    vol = _realized_vol_percentile(closes)
    feats["realized_vol"] = vol["vol"]
    feats["vol_percentile"] = vol["percentile"]
    feats["vol_percentile_band"] = vol["band"]

    # --- momentum -------------------------------------------------------
    if daily:
        mom = tech.momentum(daily)
        feats["rsi"] = round(mom.rsi, 2)
        feats["rsi_declining"] = bool(mom.declining)
    else:
        feats["rsi"] = None
        feats["rsi_declining"] = None

    # --- setup location (distance to nearest S/R) -----------------------
    feats["near_support"] = None
    feats["near_resistance"] = None
    feats["dist_to_support"] = None
    feats["dist_to_resistance"] = None
    if daily and entry_bar_price:
        sr = tech.support_resistance(daily, current_price=entry_bar_price)
        d_sup = _nearest_distance(sr["support"], entry_bar_price)
        d_res = _nearest_distance(sr["resistance"], entry_bar_price)
        feats["dist_to_support"] = round(d_sup, 6) if d_sup is not None else None
        feats["dist_to_resistance"] = round(d_res, 6) if d_res is not None else None
        if d_sup is not None:
            feats["near_support"] = abs(d_sup) <= _NEAR_PCT
        if d_res is not None:
            feats["near_resistance"] = abs(d_res) <= _NEAR_PCT

    # --- options: DTE + moneyness ---------------------------------------
    feats["option_type"] = None
    feats["dte"] = None
    feats["dte_band"] = None
    feats["moneyness"] = None
    feats["moneyness_pct"] = None
    if kind == "option" and display_symbol and open_date is not None:
        feats.update(_option_features(
            display_symbol, open_date=open_date,
            underlying_price=entry_bar_price,
        ))

    # --- timing ---------------------------------------------------------
    if open_date is not None:
        dow = open_date.strftime("%A")
        feats["day_of_week"] = dow
        feats["is_monday"] = dow == "Monday"
        feats["is_friday"] = dow == "Friday"
    else:
        feats["day_of_week"] = None
        feats["is_monday"] = None
        feats["is_friday"] = None
    feats["holding_bucket"] = _holding_bucket(rt.get("holding_days"))

    # --- earnings window + event proximity ------------------------------
    # earnings_within_window: legacy ±window flag (None when unknown, unchanged).
    feats["earnings_within_window"] = _earnings_within(
        earnings_dates, open_date, earnings_window_days)
    # events.earnings_within: the richer before-entry / during-hold split. When
    # earnings_dates is unknown (None), the flags are None (not a fabricated
    # False) so an absent earnings feed never invents a "no earnings" bucket.
    if earnings_dates is None or open_date is None:
        feats["earnings_before_entry"] = None
        feats["earnings_during_hold"] = None
        feats["earnings_nearest_days"] = None
    else:
        ev = events_engine.earnings_within(
            open_date, rt.get("close_date"), earnings_dates,
            window_days=earnings_window_days)
        feats["earnings_before_entry"] = ev["before_entry"]
        feats["earnings_during_hold"] = ev["during_hold"]
        feats["earnings_nearest_days"] = ev["nearest_days"]

    # --- size tertile ---------------------------------------------------
    feats["size_tertile"] = _size_tertile(rt, account_value, kind)

    return feats


def _earnings_within(earnings_dates, open_date, window_days) -> bool | None:
    """True/False when earnings_dates is provided (any earnings within ±window
    of open_date), else None (unknown — never a fabricated False)."""
    if earnings_dates is None or open_date is None:
        return None
    for e in earnings_dates:
        ed = _parse_date(e)
        if ed is not None and abs((ed - open_date).days) <= window_days:
            return True
    return False


def _size_tertile(rt: dict, account_value, kind) -> str | None:
    """small | med | large by position notional as a fraction of account_value,
    or None when account_value/entry are unknown. Options notional uses the
    per-contract entry (already ×multiplier in the round-trip)."""
    if not account_value or account_value <= 0:
        return None
    entry = rt.get("entry_price")
    qty = rt.get("quantity")
    if entry in (None, "") or qty in (None, ""):
        return None
    try:
        notional = abs(float(entry) * float(qty))
    except (TypeError, ValueError):
        return None
    frac = notional / account_value
    if frac < 0.01:
        return "small"
    if frac <= 0.05:
        return "med"
    return "large"


def _as_dict(roundtrip) -> dict:
    """Accept a RoundTrip dataclass or a plain dict uniformly."""
    if isinstance(roundtrip, dict):
        return roundtrip
    from dataclasses import asdict, is_dataclass
    if is_dataclass(roundtrip):
        return asdict(roundtrip)
    # last resort: pull attributes
    return {k: getattr(roundtrip, k) for k in dir(roundtrip)
            if not k.startswith("_")}


# ------------------------------------------------------------- features_for_all

def features_for_all(
    roundtrips,
    *,
    bars_by_symbol: dict[str, dict],
    display_symbol_by_trip=None,
    earnings_by_symbol: dict[str, list[str]] | None = None,
    account_value: float | None = None,
) -> list[dict]:
    """Entry features for every round-trip, with per-trip no-leakage slicing.

    ``bars_by_symbol`` maps an UNDERLYING to its bars bundle
    {"daily": [...], "weekly": [...], "monthly": [...]} (the shape of a
    bars/<UND>.json). For each trip we SLICE that symbol's daily+weekly to
    <= the trip's open_date (``slice_bars_at``) so features never leak
    post-entry data, then call ``entry_features``.

    ``display_symbol_by_trip``: optional callable ``(rt_dict) -> display_symbol
    | None`` used to resolve an option's display symbol (strike/expiry/right)
    for a trip; None for equities. When omitted, option DTE/moneyness are None.
    ``earnings_by_symbol``: optional {underlying: [ISO earnings dates]}.

    Returns a list of {symbol, kind, open_date, close_date, win, realized_pnl,
    features:{...}} — the round-trip reference plus its features, ready for
    condition_buckets. Deterministic; order matches ``roundtrips``."""
    earnings_by_symbol = earnings_by_symbol or {}
    out: list[dict] = []
    for rt in roundtrips:
        rt_d = _as_dict(rt)
        symbol = str(rt_d.get("symbol") or "").upper()
        open_date = rt_d.get("open_date")
        bundle = bars_by_symbol.get(symbol) or {}
        daily_full = bundle.get("daily") or []
        weekly_full = bundle.get("weekly") or []
        daily_slice = slice_bars_at(daily_full, open_date)
        weekly_slice = slice_bars_at(weekly_full, open_date)

        display_symbol = None
        if display_symbol_by_trip is not None:
            display_symbol = display_symbol_by_trip(rt_d)

        feats = entry_features(
            rt_d,
            bars_daily_at_entry=daily_slice,
            bars_weekly_at_entry=weekly_slice,
            display_symbol=display_symbol,
            earnings_dates=earnings_by_symbol.get(symbol),
            account_value=account_value,
        )
        out.append({
            "symbol": rt_d.get("symbol"),
            "kind": rt_d.get("kind"),
            "open_date": rt_d.get("open_date"),
            "close_date": rt_d.get("close_date"),
            "win": bool(rt_d.get("win")),
            "realized_pnl": rt_d.get("realized_pnl"),
            "features": feats,
        })
    return out
