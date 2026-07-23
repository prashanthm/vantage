"""Paper-trading tracker for the 0DTE playbook — a NO-MONEY track record.

The playbook reads SPX; retail trades the SPY proxy. This module translates the
playbook's SPX levels into SPY (via the live SPX/SPY ratio), builds trade TICKETS
(here's the entry, target, stop, and share size for each signal), and — when you
log one — opens a simulated SPY-shares trade. Open trades AUTO-CLOSE by scanning
SPY intraday bars for the first touch of the target or the stop, so the track
record reflects real price action even between checks.

Why this exists: the futures analysis showed the mean-revert playbook can
underperform on a trend day (R:R ~1.1). Before risking real money on this
narrative, a paper record tells you honestly whether trading the levels works.

This is a SIMULATION. It places NO real orders and touches no broker or funds
(ADR-010). P&L is tracked on SPY shares (the simplest honest proxy); the nearest
0DTE strike is shown for reference only. Not financial advice.

CLI: ``python -m vantage_server.paper [--tickets | --settle] [--data-dir D]``.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from zoneinfo import ZoneInfo

from .store import Store, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2
ET = ZoneInfo("America/New_York")

import logging

from . import reclaim_strategy as _spec
from .reclaim_strategy import (  # single source of truth for the reclaim trade
    DEFAULT_SHARES,
    PENDING_EXPIRE_HOURS as _SPEC_EXPIRE_HOURS,
    RECLAIM_CLOSES as _SPEC_RECLAIM_CLOSES,
    STOP_PAD_PCT,
    stop_for,
    target_for,
)

log = logging.getLogger(__name__)


def _retarget(trade: dict, entry: float) -> float | None:
    """Re-pick the target from the ACTUAL fill, using the opposing-level book
    carried on the ticket (``spy_opposing``). Falls back to the stored target
    for legacy rows that predate the book — those are then screened by
    :func:`reclaim_strategy.is_worth_taking`, so a bad one is voided rather
    than traded."""
    book = trade.get("spy_opposing")
    if not book:
        return trade.get("spy_target")
    if trade["side"] == "long":
        return next((float(p) for p in sorted(book) if float(p) > entry), None)
    return next((float(p) for p in sorted(book, reverse=True) if float(p) < entry), None)

#: a zone counts as "broken" once price closes beyond it by this fraction of
#: price. Kept in sync with journal._BREAK_PCT so the paper break-setups and the
#: journal's held/broke scoring agree on what "broke" means.
BREAK_PCT = 0.0015    # ~0.15% ≈ 11pt at SPX 7500
#: keep counter-trend tickets visible (flagged), rather than dropping them. Flip
#: to True to suppress tickets that fight the higher-timeframe trend.
SUPPRESS_COUNTER_TREND = False
#: with-trend only in a CLEAR trend (uptrend→longs, downtrend→shorts; range and
#: transition allow both). Backtest-validated (coach-edge goal): WR 0.58 → 0.64,
#: PF 2.42 → 3.10 vs no gate. Set False to reproduce the pre-2026-07-16 pipeline.
DIRECTION_GATE = True


# ── underlying → proxy translation ───────────────────────────────────────────

def _fetch_spy_15m():
    from . import spx_playbook as sp
    return sp._fetch_15m("SPY")


def _fetch_proxy_15m(proxy_symbol: str):
    from . import spx_playbook as sp
    return sp._fetch_15m(proxy_symbol)


def spy_price_and_ratio(spx_spot: float | None):
    """Live SPY price (latest 15m close) and the SPX/SPY ratio. Returns
    ``(spy_price, ratio, bars)`` — bars kept for settlement. ratio ~10.
    (Back-compat SPX helper; ``proxy_price_and_ratio`` generalizes it.)"""
    df = _fetch_spy_15m()
    if df is None or getattr(df, "empty", True):
        return None, None, df
    spy = float(df["Close"].iloc[-1])
    ratio = (spx_spot / spy) if (spx_spot and spy) else 10.0
    return spy, ratio, df


def proxy_price_and_ratio(underlying: str, spot: float | None):
    """Live proxy price + (underlying / proxy) ratio for any underlying. For SPX
    the proxy is SPY (ratio ~10); for QQQ/IWM the proxy IS the underlying, so the
    ratio is 1 and the proxy price is the ETF's own last. Returns
    ``(proxy_price, ratio, bars)`` — bars kept for settlement."""
    from . import underlyings as _u
    cfg = _u.get(underlying)
    df = _fetch_proxy_15m(cfg["proxy_symbol"])
    if df is None or getattr(df, "empty", True):
        return None, None, df
    proxy = float(df["Close"].iloc[-1])
    if cfg["self_proxy"]:
        return proxy, 1.0, df
    ratio = (spot / proxy) if (spot and proxy) else 10.0
    return proxy, ratio, df


def to_spy(spx_level: float, ratio: float) -> float:
    """Convert an underlying level to proxy price via the ratio (1.0 for ETFs)."""
    return round(spx_level / ratio, 2)


def nearest_strike(spy_price: float, step: float = 1.0) -> float:
    """Nearest listed SPY 0DTE strike (SPY strikes are $1 wide near ATM)."""
    return round(round(spy_price / step) * step, 2)


# ── demand/supply enrichments (trend filter, breaks, freshness, OTM) ─────────

def _session_range(symbol: str = "^GSPC"):
    """(low, high, last) over TODAY's RTH session, or None. The same price inputs
    the journal scores levels against — used here to tell whether price has traded
    THROUGH a zone (a break setup) vs. is merely resting near it."""
    from . import spx_playbook as sp
    df = sp._fetch_15m(symbol)
    if df is None or getattr(df, "empty", True):
        return None
    today = _dt.datetime.now(ET).date().isoformat()
    lows, highs, closes = [], [], []
    for ts, row in df.iterrows():
        if ts.to_pydatetime().date().isoformat() != today:
            continue
        lows.append(float(row["Low"])); highs.append(float(row["High"]))
        closes.append(float(row["Close"]))
    if not closes:
        return None
    return min(lows), max(highs), closes[-1]


def _is_counter_trend(side: str, state: str | None, gamma: str | None) -> bool:
    """Does this ticket FIGHT the higher-timeframe trend? A long (buy dip) fights a
    downtrend; a short (fade rally) fights an uptrend. A positive-gamma (mean-revert)
    regime or a non-trending/unclear structure is NOT counter-trend — reversion
    setups belong there. NOTE: `state` is the 10-session swing read (playbook
    timeframe), not the 1-3-5min entry timeframe; this gates 'don't fade the daily
    trend', not the doc's intrabar trigger."""
    if gamma == "positive":
        return False
    if side == "long" and state == "downtrend":
        return True
    if side == "short" and state == "uptrend":
        return True
    return False


def _durable_bands(scaffold: dict) -> list[dict]:
    return [b for b in (scaffold.get("durable") or []) if b.get("lo") is not None]


def _freshness_for_zone(zone: dict, bands: list[dict]) -> tuple[str, str]:
    """Tag a zone fresh/strong/tested/weak from durable-level memory. `respected`
    is a rejection count and `sessions` the appearance count on the matching durable
    band; freshness ≈ respected/sessions. A fresh (never-recorded) base is treated
    as strong — that's the demand/supply premise (untested bases react best).
    Returns (freshness, note)."""
    price = zone.get("price")
    band = None
    for b in bands:
        # band overlap (same pattern as spx_playbook _durable_at)
        if b["lo"] - 0.5 <= price <= b["hi"] + 0.5:
            band = b
            break
    if band is None:
        # NOTE: the 60-day backtest loops DISPROVED "untested zones react best"
        # — fresh zones dragged every config there. The 3-year hourly
        # validation (claudedocs/goals/long-window) then found the durable-vs-
        # fresh edge does NOT hold robustly across regimes: treat freshness as
        # a weak hint, not a signal. Tag stays for display; fresh ≠ strong.
        return "fresh", "fresh — no prior record (unproven zone)"
    sessions = int(band.get("sessions") or 0)
    respected = int(band.get("respected") or 0)
    if sessions <= 1:
        return "fresh", "fresh — barely tested yet"
    ratio = respected / sessions if sessions else 0.0
    note = f"respected {respected}/{sessions} sessions"
    if ratio >= 0.6:
        return "strong", note + " — strong"
    if ratio >= 0.3:
        return "tested", note + " — tested, still reacting"
    return "weak", note + " — tested often, weakening"


#: the doc's time-of-day OTM rule, as a FRACTION of price so it scales to any
#: underlying (25pt at SPX 7500 ≈ 0.33%). CST cutoffs → ET (ET = CST + 1h). Wider
#: OTM early (more time for a far strike to pay), tighter into the afternoon as
#: 0DTE gamma accelerates.
def _otm_pct(now_et: _dt.datetime) -> tuple[float, str]:
    """(OTM fraction of price, label) for the current ET time, per the doc's rule
    (~0.33% before noon CST, ~0.16% after 1-2pm CST — 25pt / 12pt at SPX 7500)."""
    mins = now_et.hour * 60 + now_et.minute
    if mins < 13 * 60:            # before 12:00 CST / 13:00 ET
        return 0.0033, "morning (wider OTM)"
    if mins < 14 * 60:            # 13:00-14:00 ET (noon-1pm CST)
        return 0.0024, "early-afternoon OTM"
    return 0.0016, "afternoon (tighter OTM)"


def _otm_strike(entry_proxy: float, side: str, now_et: _dt.datetime,
                strike_step: float = 1.0) -> tuple[float, str]:
    """A time-of-day OTM strike suggestion (in the proxy's own price) alongside the
    ATM ref_strike. OTM = above entry for a call (long), below for a put (short).
    Expressed as a % of price so it's right for SPY/QQQ/IWM alike. Suggestion only
    — not IV/delta aware."""
    frac, label = _otm_pct(now_et)
    offset = entry_proxy * frac
    raw = entry_proxy + offset if side == "long" else entry_proxy - offset
    pts = round(offset)
    return nearest_strike(raw, strike_step), f"≈{pts}pt OTM · {label}"


# ── ticket generation from the playbook scaffold ─────────────────────────────

def build_tickets(scaffold: dict, spy_price: float, ratio: float,
                  session_range: tuple | None = None,
                  now_et: _dt.datetime | None = None,
                  underlying: str = "SPX") -> list[dict]:
    """Turn the playbook's confluence zones into SPY trade tickets — the four
    demand/supply setups from the methodology:

      TEST (A/B): a SUPPORT zone below spot → 'buy dip' (long); a RESISTANCE zone
        above → 'fade rally' (short). Reversion at the untested/holding level.
      BREAK (C/D): a zone price has CLOSED THROUGH today flips polarity — a broken
        resistance becomes support to buy the reclaim; a broken support becomes
        resistance to fade the breakdown retest. Flagged experts_only.

    Each ticket carries: target = next opposing level; stop = just beyond the
    signal level; a TREND flag (does it fight the higher-timeframe trend?); a
    FRESHNESS tag (from durable-level memory); and a time-of-day OTM strike
    suggestion alongside the ATM ref_strike.

    ``session_range`` = today's (low, high, last); ``now_et`` = current ET time —
    both injectable for testing (default: fetched / now)."""
    from . import underlyings as _u
    cfg = _u.get(underlying)
    key = (underlying or "SPX").upper()
    spx_spot = (scaffold.get("regime") or {}).get("spot")
    conf = scaffold.get("confluence") or []
    if not conf or spx_spot is None:
        return []
    if now_et is None:
        now_et = _dt.datetime.now(ET)
    if session_range is None:
        session_range = _session_range(cfg["bar_symbol"])
    # higher-timeframe trend read (playbook timeframe, not 1-3-5min) for the filter
    trend_state = ((scaffold.get("chart") or {}).get("structure") or {}).get("state")
    gamma = (scaffold.get("regime") or {}).get("gamma")
    bands = _durable_bands(scaffold)
    # SPX levels sorted for target-picking
    supports = sorted([z for z in conf if z["role"] == "support"], key=lambda z: -z["price"])
    resistances = sorted([z for z in conf if z["role"] == "resistance"], key=lambda z: z["price"])
    tickets: list[dict] = []

    def _mk(zone, side, setup="test"):
        lvl = zone["price"]
        # ENTRY is the signal LEVEL (you buy the dip AT support / fade the rally AT
        # resistance) — a resting order, not a market order at spot. Target = the
        # next opposing level; stop = just past the signal level.
        # target = next opposing level, stop = level ± pad — from the shared spec.
        tgt = target_for(lvl, side,
                         [s["price"] for s in supports],
                         [r["price"] for r in resistances])
        stop = stop_for(lvl, side)
        entry_spy = to_spy(lvl, ratio)   # enter AT the level (resting limit order)
        tgt_spy = to_spy(tgt, ratio) if tgt is not None else None
        stop_spy = to_spy(stop, ratio)
        # risk:reward in SPY terms (for display)
        risk = abs(entry_spy - stop_spy)
        reward = abs(tgt_spy - entry_spy) if tgt_spy is not None else None
        rr = round(reward / risk, 2) if (reward and risk) else None
        counter = _is_counter_trend(side, trend_state, gamma)
        freshness, freshness_note = _freshness_for_zone(zone, bands)
        otm, otm_note = _otm_strike(entry_spy, side, now_et)
        if setup == "break":
            sig = (("breakout retest above " if side == "long" else "breakdown retest below ")
                   + f"{to_spy(lvl, ratio):.2f}")
        else:
            sig = (("buy the dip near " if side == "long" else "fade the rally near ")
                   + f"{to_spy(lvl, ratio):.2f}")
        trend_note = ("⚠ fades the " + (trend_state or "") + " — lower-probability"
                      if counter else "aligns with trend / regime")
        # RECLAIM TRIGGER — the backtest loops' core finding (claudedocs/goals/
        # strategy-winrate + reclaim-interval): entering on the TOUCH of a level
        # lost in every regime (10% win rate). The interval sweep then found the
        # best confirmation is THREE CONSECUTIVE 5m closes back through the
        # level (~15 rolling minutes: the depth of a 15m close, the entry price
        # of a 5m close) — WR 0.60 / PF 1.39 vs 0.50 / 1.29 for a single 15m
        # close, replicated across both halves of the window. Guidance, not a
        # gate — the ticket still shows; the discipline is on the entry.
        entry_note = ("enter after 3 consecutive 5m closes back "
                      + ("above" if side == "long" else "below")
                      + f" {to_spy(lvl, ratio):.2f} — never on the touch")
        return {
            "entry_trigger": "reclaim-3x5m",
            "entry_note": entry_note,
            "signal": sig,
            "side": side,
            "setup": setup,                    # "test" | "break"
            "experts_only": setup == "break",
            "symbol": cfg["proxy_symbol"],     # SPY for SPX; the ETF itself else
            "underlying": key,
            "spx_level": round(lvl, 1),
            "spy_level": to_spy(lvl, ratio),
            "spy_entry": round(entry_spy, 2),
            "spy_now": round(spy_price, 2),   # current price, for "distance to entry"
            "spy_target": tgt_spy,
            "spy_stop": round(stop_spy, 2),
            # The opposing-level book in SPY terms, carried on the ticket so the
            # target can be RE-PICKED at fill time: a reclaim fills past the
            # level, and a target chosen from the level can end up behind the
            # fill (paper #14/#15 → guaranteed losses). See settle_open.
            "spy_opposing": sorted(
                to_spy(r["price"], ratio) for r in resistances) if side == "long"
                else sorted((to_spy(s["price"], ratio) for s in supports),
                            reverse=True),
            "shares": DEFAULT_SHARES,
            "ref_strike": nearest_strike(entry_spy),
            "otm_strike": otm,                 # time-of-day OTM suggestion
            "otm_note": otm_note,
            "reward_risk": rr,
            "trend_state": trend_state,
            "counter_trend": counter,
            "trend_note": trend_note,
            "freshness": freshness,            # fresh | strong | tested | weak
            "freshness_note": freshness_note,
            "kinds": zone.get("kinds", []),
        }

    # TEST setups (A/B): nearest support below + nearest resistance above spot
    below = [z for z in supports if z["price"] < spx_spot][:2]
    above = [z for z in resistances if z["price"] > spx_spot][:2]
    for z in below:
        tickets.append(_mk(z, "long"))
    for z in above:
        tickets.append(_mk(z, "short"))

    # BREAK setups (C/D): a zone price has CLOSED THROUGH today flips polarity.
    # Reuses the journal's break test (close beyond by BREAK_PCT, on the right
    # side of the level). Needs today's session range; skipped without it.
    if session_range:
        lo, hi, last = session_range
        for z in conf:
            p = z["price"]; brk = p * BREAK_PCT
            if z["role"] == "resistance" and hi > p + brk and last > p:
                # broken resistance now acts as support → buy the reclaim (long)
                tickets.append(_mk(z, "long", setup="break"))
            elif z["role"] == "support" and lo < p - brk and last < p:
                # broken support now acts as resistance → fade the breakdown (short)
                tickets.append(_mk(z, "short", setup="break"))

    if SUPPRESS_COUNTER_TREND:
        tickets = [t for t in tickets if not t["counter_trend"]]

    # DIRECTION GATE (coach-edge goal, 2026-07-16): in a clear trend, take only
    # with-trend setups — uptrend → longs, downtrend → shorts. Range/transition
    # allows both. Mirrors the backtest's direction_gate="structure", which
    # lifted WR 0.58 → 0.64 / PF 2.42 → 3.10 by dropping counter-trend shorts
    # (the weak side). Toggle off with DIRECTION_GATE = False to reproduce old.
    if DIRECTION_GATE:
        tickets = [
            t for t in tickets
            if not (trend_state == "uptrend" and t["side"] != "long")
            and not (trend_state == "downtrend" and t["side"] != "short")
        ]
    return tickets


# ── open + settle ────────────────────────────────────────────────────────────

#: Aliases of the shared reclaim spec (reclaim_strategy.py) — the entry
#: discipline (N consecutive 5m closes) and pending-expiry window live there so
#: paper and the Pine generators can never disagree.
RECLAIM_CLOSES = _SPEC_RECLAIM_CLOSES
PENDING_EXPIRE_HOURS = _SPEC_EXPIRE_HOURS


def open_paper_trade(store: Store, ticket: dict, *, session: str | None = None,
                     source: str = "manual", now: _dt.datetime | None = None) -> int:
    """Log a paper trade from a ticket.

    A ticket carrying the reclaim trigger opens PENDING: the simulator holds
    the entry until the reclaim confirms (see :func:`settle_open`), so the
    track record measures the validated discipline, not the touch-entry the
    backtests disproved. Tickets without a trigger fill immediately (legacy
    behavior)."""
    now = now or _dt.datetime.now(ET)
    proxy = ticket.get("symbol") or "SPY"
    pending = ticket.get("entry_trigger") == "reclaim-3x5m"
    return store.record_paper_trade({
        "opened_at": now.isoformat(),
        "session": session,
        "signal": ticket["signal"],
        "side": ticket["side"],
        "symbol": proxy,
        "spx_level": ticket.get("spx_level"),
        "spy_entry": ticket["spy_entry"],
        "spy_target": ticket.get("spy_target"),
        "spy_stop": ticket.get("spy_stop"),
        "shares": ticket.get("shares", DEFAULT_SHARES),
        "ref_strike": ticket.get("ref_strike"),
        "source": source,
        "status": "open",
        "opened_price_src": ("pending reclaim-3x5m" if pending
                             else f"{proxy} 15m close"),
        "entry_trigger": ticket.get("entry_trigger"),
        "entry_note": ticket.get("entry_note"),
        "spy_level": ticket.get("spy_level"),
        "fill_status": "pending" if pending else "filled",
        "filled_at": None if pending else now.isoformat(),
    })


def _try_fill(trade: dict, bars) -> dict | None:
    """Scan 5m bars after the open for the reclaim fill: RECLAIM_CLOSES
    consecutive closes back through the level on the trade's side. Returns
    ``{spy_entry, filled_at}`` at the confirming close, or None (still
    pending). A close back on the wrong side resets the count — the whole
    point of the discipline."""
    opened = trade.get("opened_at") or ""
    level = trade.get("spy_level")
    if level is None:
        return None
    level = float(level)
    long_side = trade.get("side") == "long"
    streak = 0
    for ts, row in bars.iterrows():
        bar_iso = ts.to_pydatetime().isoformat()
        if bar_iso <= opened:
            continue
        close = float(row["Close"])
        reclaimed = close > level if long_side else close < level
        streak = streak + 1 if reclaimed else 0
        if streak >= RECLAIM_CLOSES:
            return {"spy_entry": round(close, 2), "filled_at": bar_iso}
    return None


def _settle_one(trade: dict, bars) -> dict | None:
    """Scan SPY 15m bars AFTER the trade opened for the first touch of target or
    stop. Returns ``{spy_exit, exit_reason, pnl, pnl_pct, closed_at}`` or None if
    neither was hit yet (trade stays open). Target-or-stop, whichever bar first.

    DAY-TRADE DISCIPLINE (open-ended-edge goal, 2026-07-22): a trade that hits
    neither target nor stop by the session close exits at the fill day's last
    bar (``exit_reason="eod"``). Every validated number — champion WR 0.72 /
    PF 3.27 AND the open-ended class's PF 1.59 — was measured on the harness's
    day-scoped exits; live rides held overnight instead (#28/#29/#84) and
    roughly doubled the losses (−$1,958 actual vs −$937 under EOD close)."""
    opened = trade.get("filled_at") or trade.get("opened_at") or ""
    side = trade["side"]
    entry = float(trade["spy_entry"])
    tgt = trade.get("spy_target")
    stop = trade.get("spy_stop")
    shares = float(trade.get("shares") or DEFAULT_SHARES)
    # only bars strictly after the open timestamp
    try:
        import pandas as pd  # noqa: F401
    except Exception:  # noqa: BLE001
        return None

    def _close(exit_px, reason, closed_at):
        direction = 1 if side == "long" else -1
        pnl = round((exit_px - entry) * direction * shares, 2)
        pnl_pct = round((exit_px - entry) / entry * 100 * direction, 3)
        return {"spy_exit": round(exit_px, 2), "exit_reason": reason,
                "pnl": pnl, "pnl_pct": pnl_pct, "closed_at": closed_at}

    # naive timestamps (tests, legacy rows) are taken at face value; aware ones
    # normalize to ET so session-day comparisons are exact.
    def _et_date(dt):
        return (dt.astimezone(ET) if dt.tzinfo else dt).date()
    try:
        fill_date = _et_date(_dt.datetime.fromisoformat(opened))
    except ValueError:
        fill_date = None
    prev_close = prev_iso = None
    for ts, row in bars.iterrows():
        bar_dt = ts.to_pydatetime()
        bar_iso = bar_dt.isoformat()
        if bar_iso <= opened:
            continue
        # first bar of a LATER session → the trade ended at yesterday's last
        # bar. (prev_close can only be None if the fill was the day's final
        # bar — then the entry price is the honest mark.)
        if fill_date is not None and _et_date(bar_dt) > fill_date:
            return _close(prev_close if prev_close is not None else entry,
                          "eod", prev_iso or opened)
        hi, lo = float(row["High"]), float(row["Low"])
        hit_reason = None; exit_px = None
        if side == "long":
            # long: stop below entry, target above
            if stop is not None and lo <= stop:
                hit_reason, exit_px = "stop", stop
            elif tgt is not None and hi >= tgt:
                hit_reason, exit_px = "target", tgt
        else:  # short
            if stop is not None and hi >= stop:
                hit_reason, exit_px = "stop", stop
            elif tgt is not None and lo <= tgt:
                hit_reason, exit_px = "target", tgt
        if hit_reason:
            return _close(exit_px, hit_reason, bar_iso)
        prev_close, prev_iso = float(row["Close"]), bar_iso
    # no later-session bar yet: if the fill day's tape is complete (a bar at/
    # after 15:55 ET), close at that final bar instead of waiting overnight.
    if (fill_date is not None and prev_iso is not None and prev_close is not None):
        last = _dt.datetime.fromisoformat(prev_iso)
        last = last.astimezone(ET) if last.tzinfo else last
        if last.date() == fill_date and (last.hour, last.minute) >= (15, 55):
            return _close(prev_close, "eod", prev_iso)
    return None


#: how many trading days a scanner spread stays open before it's closed at the
#: modeled intrinsic (a swing horizon, not 0DTE).
SPREAD_HORIZON_DAYS = 30


def _settle_spread(store, t: dict) -> dict | None:
    """Resolve one open scanner DEBIT SPREAD on its underlying's hourly bars after
    the open. Returns close fields or None (still open).

    Debit spread P&L (per the confirmed structure — long at entry, short at target):
      - price reaches the SHORT strike (target)      → win: (width − debit) × N × 100
      - price breaches the buffered invalidation      → loss: −debit × N × 100
        (invalidation sits BEYOND the FVG edge, past the long strike, so the spread
        is ~worthless there — a full-debit loss is the honest mark)
      - neither within the horizon                    → close at modeled intrinsic
        based on where price sits vs the two strikes.
    Target checked before invalidation within a bar is NOT assumed — invalidation
    (the loss) is checked first, conservatively."""
    from .scanner import load_hourly_series  # lazy — avoid an import cycle at load
    ser = load_hourly_series(store, t.get("underlying") or t.get("symbol"), days=90)
    if not ser or not ser.get("ts"):
        return None
    opened = t.get("filled_at") or t.get("opened_at") or ""
    long_k = float(t["long_strike"]); short_k = float(t["short_strike"])
    invalid = float(t["underlying_invalid"])
    debit = float(t.get("est_debit") or 0.0)
    n = int(t.get("contracts") or 4)
    width = abs(short_k - long_k)
    is_call = (t.get("structure") == "debit_call_spread")
    hi, lo, ts = ser["high"], ser["low"], ser["ts"]

    def _win():
        return round((width - debit) * n * 100, 2)

    def _loss():
        return round(-debit * n * 100, 2)

    last_i = None
    for i, tstamp in enumerate(ts):
        if tstamp <= opened:
            continue
        last_i = i
        h, l = float(hi[i]), float(lo[i])
        # invalidation first (conservative — book the loss if both touch in a bar)
        inval_hit = (l <= invalid) if is_call else (h >= invalid)
        if inval_hit:
            return {"spy_exit": round(invalid, 2), "exit_reason": "invalidation",
                    "pnl": _loss(), "pnl_pct": round(-100.0, 2), "closed_at": tstamp}
        tgt_hit = (h >= short_k) if is_call else (l <= short_k)
        if tgt_hit:
            pnl = _win()
            pct = round((width - debit) / debit * 100, 2) if debit else None
            return {"spy_exit": round(short_k, 2), "exit_reason": "target",
                    "pnl": pnl, "pnl_pct": pct, "closed_at": tstamp}
    # horizon: if the setup has aged past SPREAD_HORIZON_DAYS, close at intrinsic
    if last_i is not None:
        import datetime as __dt
        try:
            age_days = (__dt.datetime.fromisoformat(ts[last_i])
                        - __dt.datetime.fromisoformat(opened)).days
        except ValueError:
            age_days = 0
        if age_days >= SPREAD_HORIZON_DAYS:
            last_px = float(ser["close"][last_i])
            # modeled intrinsic of the debit spread at last price, capped to [0, width]
            if is_call:
                intrinsic = max(0.0, min(width, last_px - long_k))
            else:
                intrinsic = max(0.0, min(width, long_k - last_px))
            pnl = round((intrinsic - debit) * n * 100, 2)
            pct = round((intrinsic - debit) / debit * 100, 2) if debit else None
            return {"spy_exit": round(last_px, 2), "exit_reason": "horizon",
                    "pnl": pnl, "pnl_pct": pct, "closed_at": ts[last_i]}
    return None


def settle_open(store: Store) -> dict:
    """Advance every OPEN paper trade against fresh 5m bars of ITS OWN proxy.

    Three phases per trade, on the same 5m series the reclaim discipline is
    defined on: (1) PENDING trades try to fill (3 consecutive 5m closes back
    through the level) or expire unfilled after PENDING_EXPIRE_HOURS; (2)
    filled trades scan for the first target/stop touch after their fill.
    Returns ``{checked, filled, expired, closed}``."""
    open_trades = store.load_paper_trades("open")
    if not open_trades:
        return {"checked": 0, "filled": 0, "expired": 0, "closed": 0}
    bars_by_proxy: dict[str, object] = {}
    filled = expired = closed = 0
    for t in open_trades:
        # Alpaca-PAPER scanner spreads are owned by the scanner_exec reconcile loop
        # (real fills + broker stop-loss) — the yfinance sim must NOT double-settle
        # them. The sim runs ONLY for the fallback rows that never reached the broker
        # (no creds / submit failed → broker=NULL).
        if t.get("book") == "scanner-spread" and t.get("broker") == "alpaca-paper":
            continue
        # scanner debit spreads settle on their OWN underlying's daily bars, with
        # spread P&L — a different basis from the SPY-proxy reclaim trades.
        if t.get("book") == "scanner-spread":
            res = _settle_spread(store, t)
            if res and store.close_paper_trade(
                    t["id"], spy_exit=res["spy_exit"], exit_reason=res["exit_reason"],
                    pnl=res["pnl"], pnl_pct=res["pnl_pct"], closed_at=res["closed_at"]):
                closed += 1
            continue
        proxy = t.get("symbol") or "SPY"
        if proxy not in bars_by_proxy:
            bars_by_proxy[proxy] = _fetch_proxy_5m(proxy)
        df = bars_by_proxy[proxy]
        if df is None or getattr(df, "empty", True):
            continue
        if (t.get("fill_status") or "filled") == "pending":
            fill = _try_fill(t, df)
            if fill:
                # THE FILL LANDS PAST THE LEVEL — re-pick the target from the
                # actual fill and check the trade is still worth taking. A
                # target chosen from the LEVEL can sit behind the FILL (paper
                # #14/#15: level 747.19, fill 751.12, "target" 750.06 → a
                # guaranteed loss booked as exit_reason=target).
                entry = fill["spy_entry"]
                tgt = _retarget(t, entry)
                ok, why = _spec.is_worth_taking(
                    entry, float(t["spy_stop"]), tgt, t["side"])
                if not ok:
                    # never book a dead trade: void it, don't "fill" it
                    if store.close_paper_trade(
                            t["id"], spy_exit=0.0, exit_reason="voided",
                            pnl=0.0, pnl_pct=0.0,
                            closed_at=fill["filled_at"]):
                        expired += 1
                    log.info("paper #%s voided at fill: %s", t["id"], why)
                    continue
                if store.fill_paper_trade(
                        t["id"], spy_entry=entry, filled_at=fill["filled_at"],
                        spy_target=tgt, set_target=True):
                    filled += 1
                    t = dict(t, spy_entry=entry, spy_target=tgt,
                             filled_at=fill["filled_at"], fill_status="filled")
            elif _pending_expired(t, df):
                if store.close_paper_trade(
                        t["id"], spy_exit=0.0, exit_reason="never_filled",
                        pnl=0.0, pnl_pct=0.0,
                        closed_at=str(df.index[-1].to_pydatetime().isoformat())):
                    expired += 1
                continue
            else:
                continue  # still waiting for the reclaim
        res = _settle_one(t, df)
        if res and store.close_paper_trade(
                t["id"], spy_exit=res["spy_exit"], exit_reason=res["exit_reason"],
                pnl=res["pnl"], pnl_pct=res["pnl_pct"], closed_at=res["closed_at"]):
            closed += 1
    return {"checked": len(open_trades), "filled": filled,
            "expired": expired, "closed": closed}


def _pending_expired(trade: dict, bars) -> bool:
    """True when the newest bar is past the pending window — the reclaim never
    confirmed, so the trade expires unfilled (no fill, no trade)."""
    opened = trade.get("opened_at") or ""
    try:
        opened_dt = _dt.datetime.fromisoformat(opened)
        last = bars.index[-1].to_pydatetime()
        if opened_dt.tzinfo is None:
            last = last.replace(tzinfo=None)
        return (last - opened_dt).total_seconds() > PENDING_EXPIRE_HOURS * 3600
    except Exception:  # noqa: BLE001 — malformed timestamps never expire a trade
        return False


def _fetch_proxy_5m(proxy_symbol: str):
    """SPY/QQQ/IWM 5m RTH bars — the interval the reclaim discipline (and now
    settlement) is defined on. Lazy yfinance; ~10 sessions of history."""
    import yfinance as yf  # noqa: PLC0415

    df = yf.Ticker(proxy_symbol).history(period="10d", interval="5m")
    if df.empty:
        return df
    idx = df.index.tz_convert("America/New_York")
    df = df.copy()
    df.index = idx
    mins = idx.hour * 60 + idx.minute
    return df[(mins >= 570) & (mins < 960)]  # 09:30-16:00 ET


def close_manually(store: Store, trade_id: int, spy_exit: float,
                   now: _dt.datetime | None = None) -> bool:
    """Close an open paper trade at a given SPY price (user pressed 'close')."""
    now = now or _dt.datetime.now(ET)
    t = next((x for x in store.load_paper_trades("open") if x["id"] == trade_id), None)
    if not t:
        return False
    direction = 1 if t["side"] == "long" else -1
    entry = float(t["spy_entry"]); shares = float(t.get("shares") or DEFAULT_SHARES)
    pnl = round((spy_exit - entry) * direction * shares, 2)
    pnl_pct = round((spy_exit - entry) / entry * 100 * direction, 3)
    return store.close_paper_trade(trade_id, spy_exit=round(spy_exit, 2),
                                   exit_reason="manual", pnl=pnl, pnl_pct=pnl_pct,
                                   closed_at=now.isoformat())


# ── stats over the closed record ─────────────────────────────────────────────

def paper_stats(closed: list[dict]) -> dict:
    n = len(closed)
    if not n:
        return {"n": 0}
    wins = [t for t in closed if (t.get("pnl") or 0) > 0]
    losses = [t for t in closed if (t.get("pnl") or 0) <= 0]
    total = sum(t.get("pnl") or 0 for t in closed)
    gw = sum(t.get("pnl") or 0 for t in wins)
    gl = sum(t.get("pnl") or 0 for t in losses)
    by_reason = {}
    for t in closed:
        by_reason[t.get("exit_reason")] = by_reason.get(t.get("exit_reason"), 0) + 1
    return {
        "n": n, "wins": len(wins), "losses": len(losses),
        "win_rate": round(len(wins) / n, 4),
        "total_pnl": round(total, 2),
        "avg_win": round(gw / len(wins), 2) if wins else None,
        "avg_loss": round(gl / len(losses), 2) if losses else None,
        "profit_factor": round(gw / abs(gl), 2) if gl else None,
        "by_exit": by_reason,
    }


def equity_curve(closed: list[dict]) -> list[dict]:
    ordered = sorted(closed, key=lambda t: (t.get("closed_at") or "",))
    out, cum, peak = [], 0.0, 0.0
    for i, t in enumerate(ordered):
        cum += (t.get("pnl") or 0.0)
        peak = max(peak, cum)
        out.append({"i": i, "closed_at": t.get("closed_at"),
                    "pnl": round(t.get("pnl") or 0, 2), "cum": round(cum, 2),
                    "peak": round(peak, 2)})
    return out


def build_spread_book(store: Store) -> dict:
    """The scanner debit-spread track record — its OWN book, never mixed with the
    SPX reclaim record (different P&L basis). Returns open + closed + stats +
    equity curve for the 'scanner-spread' book."""
    rows = store.load_paper_trades(book="scanner-spread")
    open_rows = [r for r in rows if r.get("status") == "open"]
    closed = [r for r in rows if r.get("status") == "closed"]
    return {
        "book": "scanner-spread",
        "open": open_rows,
        "closed": sorted(closed, key=lambda r: (r.get("closed_at") or ""), reverse=True),
        "stats": paper_stats(closed),
        "equity_curve": equity_curve(closed),
    }


def build_analysis(store: Store, scaffold: dict | None = None,
                   underlying: str = "SPX") -> dict:
    """The full paper-trading view for ``underlying``: today's tickets (if a
    scaffold is given), open positions, closed track record + stats. Read-path for
    the API + CLI. Open/closed trades are filtered to the underlying's proxy."""
    from . import underlyings as _u
    cfg = _u.get(underlying)
    proxy = cfg["proxy_symbol"]
    tickets = []
    if scaffold:
        spot = (scaffold.get("regime") or {}).get("spot")
        px, ratio, _ = proxy_price_and_ratio(underlying, spot)
        if px:
            tickets = build_tickets(scaffold, px, ratio, underlying=underlying)
    # filter the track record to this underlying's proxy (back-compat: legacy
    # rows have symbol 'SPY', which is SPX's proxy, so SPX still sees them).
    open_trades = [t for t in store.load_paper_trades("open")
                   if (t.get("symbol") or "SPY") == proxy]
    closed = [t for t in store.load_paper_trades("closed")
              if (t.get("symbol") or "SPY") == proxy]
    view = {
        "tickets": tickets,
        "underlying": cfg["label"],
        "open": open_trades,
        "closed": closed,
        "stats": paper_stats(closed),
        "equity_curve": equity_curve(closed),
        "note": (f"Paper trades on {proxy}"
                 + (" as an SPX proxy" if not cfg["self_proxy"] else "")
                 + " — no real money, no orders. P&L is on shares; the 0DTE strike "
                 "is reference only."),
    }
    # IWM honesty (long-window validation, claudedocs/goals/long-window): over
    # 3 backtested years IWM's confluence never produced a ticket with an
    # opposing-zone target — the strategy has no edge to offer here yet, and a
    # fallback target was tested and rejected at every scale. Say so rather
    # than showing a silently empty list.
    if cfg["label"] == "IWM" and not any(t.get("spy_target") for t in tickets):
        view["ticket_note"] = (
            "IWM rarely yields a tradeable ticket: its zones almost never have an "
            "opposing target level (validated over a 3-year backtest). Trade SPX "
            "or QQQ setups instead until IWM's level generation improves.")
    return view


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.paper",
        description="Paper-trade the 0DTE playbook on SPY (no money, no orders). "
                    "Build tickets, or settle open trades against SPY bars.")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--symbol", default="SPX", help="underlying: SPX | QQQ | IWM")
    p.add_argument("--tickets", action="store_true", help="print today's trade tickets")
    p.add_argument("--settle", action="store_true", help="auto-close open trades that hit target/stop")
    return p


def _run(args: argparse.Namespace) -> int:
    store = Store(resolve_data_dir(args.data_dir))
    if not getattr(store, "uses_sqlite", False):
        print("error: paper trading requires the SQLite backend", file=sys.stderr)
        return EXIT_USER_ERROR
    if args.settle:
        res = settle_open(store)   # settles ALL open trades, any underlying
        print(f"paper: checked {res['checked']} open, closed {res['closed']}")
    if args.tickets or not args.settle:
        key = args.symbol.upper()
        row = store.load_spx_playbook(symbol=key)
        scaffold = (row or {}).get("scaffold") if row else None
        view = build_analysis(store, scaffold, underlying=key)
        for t in view["tickets"]:
            print(f"  [{t['side']:>5}] {t['signal']} | entry {t['spy_entry']} "
                  f"target {t['spy_target']} stop {t['spy_stop']} "
                  f"(R:R {t['reward_risk']}, ~{t['ref_strike']} strike)")
        s = view["stats"]
        if s.get("n"):
            print(f"  record: {s['n']} closed, {round(100*s['win_rate'])}% win, "
                  f"net ${s['total_pnl']:,.0f} (PF {s['profit_factor']})")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    return _run(_build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
