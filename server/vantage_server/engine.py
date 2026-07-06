"""THE deterministic portfolio engine — pure functions over models. No I/O.

This is a faithful port of the SPA's src/util.jsx portfolio math (positions,
allocation, overlapFor, washStatus, tlhCandidates, accountValue), which is the
product's current spec. Where util.jsx and sentinel's tlh_monitor.py disagree,
util.jsx wins. The differences we found and resolved:

1. Threshold combinator — util.jsx flags a lot when
       loss_usd >= threshold_usd  OR  loss_pct >= threshold_pct
   (util.jsx line: `-unrl >= settings.thresholdUsd || lossPct >= settings.thresholdPct`)
   while tlh_monitor.build_report requires BOTH (gain_pct <= -threshold AND
   loss >= min_loss_dollars). We implement util.jsx's OR.
2. Wash look-back scope — util.jsx checks RECENT_BUYS across ALL accounts and
   expands the symbol through WASH_FAMILIES (substantially-identical funds,
   Rev. Rul. 2008-5 incl. IRAs); tlh_monitor only inspects the same symbol's
   own lots in its single account. We implement util.jsx's cross-account,
   family-aware check.
3. Auto-buy look-ahead — both treat a scheduled monthly auto-buy as a future
   wash risk; util.jsx blocks outright on any family auto-buy with a
   day_of_month (a monthly buy always lands within 30 days of a sale), which
   is what we implement. tlh_monitor instead computes the concrete next
   occurrence and warns; we surface the next occurrence date in the reason
   string but keep util.jsx's blocking behavior.
4. Day counting — util.jsx's daysAgo floors (TODAY - <date>T12:00 local)/24h,
   so with the frozen 09:30 TODAY a buy N calendar days ago counts as N-1;
   tlh_monitor uses plain calendar-date subtraction. We port util.jsx's
   noon-anchored floor exactly (days_ago below) so window-edge behavior
   matches the SPA.
5. util.jsx hard-codes "next: Aug {day}" in the future-risk reason (mock-ism
   valid only for the frozen July TODAY); we compute the actual next
   occurrence from `today` — identical output for the fixture dataset.

Default thresholds mirror util.jsx DEFAULT_SETTINGS (thresholdUsd=200,
thresholdPct=3). WASH_FAMILIES / OVERLAP_GROUPS / WASH_WINDOW_DAYS mirror
src/data.js and are parameters with those defaults, keeping the engine pure.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Iterable, Sequence

from .models import (
    Account,
    Allocation,
    AutoBuy,
    Lot,
    Overlap,
    Position,
    Quote,
    RecentBuy,
    TlhCandidate,
    WashStatus,
)

WASH_WINDOW_DAYS = 30
DEFAULT_THRESHOLD_USD = 200.0
DEFAULT_THRESHOLD_PCT = 3.0

# Substantially-identical families (src/data.js WASH_FAMILIES): a buy of any
# member restarts the wash clock for every other member, in ANY account.
WASH_FAMILIES: tuple[tuple[str, ...], ...] = (
    ("VOO", "SPY", "IVV"),   # same index: S&P 500
    ("QQQ", "QQQM"),         # same index: Nasdaq-100
)

# Near-identical exposure held in 2+ places (src/data.js OVERLAP_GROUPS).
OVERLAP_GROUPS: tuple[Overlap, ...] = (
    Overlap(label="US large blend", symbols=("VOO", "SPY", "VTI", "IVV")),
    Overlap(label="US large growth", symbols=("QQQ", "QQQM", "SCHG")),
    Overlap(label="US small cap", symbols=("IWM", "IJR", "VB")),
)

_DAY_SECONDS = 86_400


# ---------------------------------------------------------------- date math

def parse_as_of(as_of: str) -> datetime:
    """Parse a snapshot's as_of ISO datetime into the engine's 'today'."""
    return datetime.fromisoformat(as_of)


def days_ago(today: datetime, iso_date: str) -> int:
    """util.jsx daysAgo parity: floor((TODAY - <date>T12:00)/24h).

    The noon anchor is placed in `today`'s timezone, matching the SPA where
    `new Date("yyyy-mm-ddT12:00:00")` parses in the browser's local zone.
    """
    anchor = datetime.fromisoformat(iso_date).replace(hour=12, tzinfo=today.tzinfo)
    return math.floor((today - anchor).total_seconds() / _DAY_SECONDS)


def fmt_date(iso_date: str) -> str:
    """util.jsx fmtDate parity: 'Jul 1' style."""
    d = date.fromisoformat(iso_date)
    return f"{d.strftime('%b')} {d.day}"


def add_days_iso(iso_date: str, n: int) -> str:
    return (date.fromisoformat(iso_date) + timedelta(days=n)).isoformat()


def next_day_of_month(today: datetime, day_of_month: int) -> date:
    """First occurrence of `day_of_month` strictly after today's date."""
    dom = min(day_of_month, 28)
    candidate = today.date().replace(day=dom)
    if candidate <= today.date():
        candidate = (candidate.replace(day=1) + timedelta(days=32)).replace(day=dom)
    return candidate


# ------------------------------------------------------------ lot valuation

def quote_for(symbol: str, quotes: dict[str, Quote], *, cost_per_share: float = 0.0) -> Quote:
    """Quote for ``symbol``, degrading to a cost-valued placeholder.

    Imported real portfolios hold symbols the quote table may not cover (the
    fixture table certainly doesn't). Rather than crashing the API, an unknown
    symbol is valued at its cost basis with day_pct 0 and classed usEquity —
    honest staleness the SPA can render, never a 500. Live quote providers
    (VANTAGE_QUOTES=stooq) resolve real symbols and shrink this fallback path.
    """
    quote = quotes.get(symbol)
    if quote is not None:
        return quote
    return Quote(symbol=symbol, name=f"{symbol} (unquoted)", price=cost_per_share,
                 day_pct=0.0, asset_class="usEquity")


def lot_value(lot: Lot, quotes: dict[str, Quote]) -> float:
    return lot.shares * quote_for(lot.symbol, quotes, cost_per_share=lot.cost_per_share).price


def lot_cost(lot: Lot) -> float:
    return lot.shares * lot.cost_per_share


def lot_unrealized(lot: Lot, quotes: dict[str, Quote]) -> float:
    return lot_value(lot, quotes) - lot_cost(lot)


def select_lots(lots: Sequence[Lot], account_id: str | None) -> list[Lot]:
    """util.jsx selectedLots: None or 'all' means every account."""
    if account_id is None or account_id == "all":
        return list(lots)
    return [l for l in lots if l.account == account_id]


def account_value(lots: Sequence[Lot], quotes: dict[str, Quote], account_id: str) -> float:
    return sum(lot_value(l, quotes) for l in lots if l.account == account_id)


# ------------------------------------------------------------------- wash

def wash_family(
    symbol: str, families: Iterable[tuple[str, ...]] = WASH_FAMILIES
) -> tuple[str, ...]:
    for fam in families:
        if symbol in fam:
            return tuple(fam)
    return (symbol,)


def wash_status(
    symbol: str,
    *,
    accounts: Sequence[Account],
    recent_buys: Sequence[RecentBuy],
    auto_buys: Sequence[AutoBuy],
    today: datetime,
    window_days: int = WASH_WINDOW_DAYS,
    families: Iterable[tuple[str, ...]] = WASH_FAMILIES,
) -> WashStatus:
    """Wash-sale status across ALL accounts (util.jsx washStatus parity):
    look-back over actual buys of any family member in any account (incl.
    IRAs), plus look-forward on scheduled auto-buys — a future repurchase
    also washes the loss.
    """
    fam = wash_family(symbol, families)
    short = {a.id: a.short for a in accounts}

    past = next(
        (b for b in recent_buys if b.symbol in fam and days_ago(today, b.date) <= window_days),
        None,
    )
    if past is not None:
        return WashStatus(
            symbol=symbol,
            blocked=True,
            reason=f"{short.get(past.account, past.account)} bought {past.symbol} "
                   f"on {fmt_date(past.date)} ({past.note})",
            clears_on=fmt_date(add_days_iso(past.date, window_days + 1)),
            clears_on_date=add_days_iso(past.date, window_days + 1),
            future_risk=next((ab for ab in auto_buys if ab.symbol in fam), None),
        )

    future = next(
        (ab for ab in auto_buys if ab.symbol in fam and ab.day_of_month is not None),
        None,
    )
    if future is not None:
        nxt = next_day_of_month(today, future.day_of_month)  # type: ignore[arg-type]
        return WashStatus(
            symbol=symbol,
            blocked=True,
            reason=f"{short.get(future.account, future.account)} auto-buys {future.symbol} "
                   f"monthly (next: {nxt.strftime('%b')} {future.day_of_month}) — "
                   f"a buy within {window_days} days after the sale washes it",
            clears_on="auto-buy paused",
            clears_on_date=None,
            future_risk=future,
        )

    return WashStatus(symbol=symbol, blocked=False)


# --------------------------------------------------------------- positions

def overlap_for(
    symbol: str,
    all_lots: Sequence[Lot],
    groups: Iterable[Overlap] = OVERLAP_GROUPS,
) -> Overlap | None:
    """Overlap is inherently cross-account: computed over the FULL lot table,
    never the selected account (util.jsx overlapFor parity)."""
    for g in groups:
        if symbol not in g.symbols:
            continue
        held = tuple(s for s in g.symbols if any(l.symbol == s for l in all_lots))
        if len(held) >= 2:
            return Overlap(label=g.label, symbols=held)
    return None


def positions(
    lots: Sequence[Lot],
    quotes: dict[str, Quote],
    account_id: str | None = None,
    groups: Iterable[Overlap] = OVERLAP_GROUPS,
) -> list[Position]:
    """Consolidated positions for one account or all, sorted by value desc.
    Weight is relative to the selected scope's total (util.jsx positions parity);
    overlap is always computed over the full lot table."""
    selected = select_lots(lots, account_id)
    by_sym: dict[str, list[Lot]] = {}
    for lot in selected:
        by_sym.setdefault(lot.symbol, []).append(lot)

    total = sum(lot_value(l, quotes) for l in selected)
    out: list[Position] = []
    for symbol, sym_lots in by_sym.items():
        value = sum(lot_value(l, quotes) for l in sym_lots)
        cost = sum(lot_cost(l) for l in sym_lots)
        out.append(
            Position(
                symbol=symbol,
                shares=sum(l.shares for l in sym_lots),
                value=value,
                cost=cost,
                unrealized=value - cost,
                day_pl=value * quote_for(symbol, quotes).day_pct / 100,
                weight=(value / total) * 100 if total else 0.0,
                accounts=tuple(sorted({l.account for l in sym_lots})),
                lots=tuple(sym_lots),
                overlap=overlap_for(symbol, lots, groups),
            )
        )
    out.sort(key=lambda p: p.value, reverse=True)
    return out


def allocation(
    lots: Sequence[Lot],
    quotes: dict[str, Quote],
    account_id: str | None = None,
) -> Allocation:
    # The four SPA classes are always present (zero when unheld); any OTHER
    # asset class a quote declares (imported real portfolios carry "options",
    # "crypto", "other" sleeves) is added as its own key instead of KeyError-ing.
    by_class = {"usEquity": 0.0, "intlEquity": 0.0, "bonds": 0.0, "cash": 0.0}
    total = 0.0
    for lot in select_lots(lots, account_id):
        v = lot_value(lot, quotes)
        cls = quote_for(lot.symbol, quotes).asset_class
        by_class[cls] = by_class.get(cls, 0.0) + v
        total += v
    return Allocation(by_class=by_class, total=total)


# --------------------------------------------------------------------- TLH

def tlh_candidates(
    lots: Sequence[Lot],
    quotes: dict[str, Quote],
    *,
    accounts: Sequence[Account],
    recent_buys: Sequence[RecentBuy],
    auto_buys: Sequence[AutoBuy],
    partner_map: dict[str, str],
    today: datetime,
    threshold_usd: float = DEFAULT_THRESHOLD_USD,
    threshold_pct: float = DEFAULT_THRESHOLD_PCT,
    window_days: int = WASH_WINDOW_DAYS,
    families: Iterable[tuple[str, ...]] = WASH_FAMILIES,
) -> list[TlhCandidate]:
    """util.jsx tlhCandidates parity: per-lot marking (sentinel semantics),
    every loss lot classified —
      na      loss in a non-taxable account (informational)
      below   taxable loss under BOTH thresholds (OR combinator, see module doc)
      blocked past threshold but wash-blocked somewhere in the household
      clear   past threshold and wash-safe; replacement from the partner map
    Gains and CASH are skipped. Sorted deepest loss first (unrealized asc).
    """
    acct_by_id = {a.id: a for a in accounts}
    out: list[TlhCandidate] = []
    for lot in lots:
        if lot.symbol == "CASH":
            continue
        acct = acct_by_id[lot.account]
        unrl = lot_unrealized(lot, quotes)
        if unrl >= 0:
            continue
        loss_pct = (-unrl / lot_cost(lot)) * 100
        past_threshold = (-unrl >= threshold_usd) or (loss_pct >= threshold_pct)
        if not acct.taxable:
            out.append(TlhCandidate(lot=lot, account=acct, unrealized=unrl,
                                    loss_pct=loss_pct, status="na"))
            continue
        if not past_threshold:
            out.append(TlhCandidate(lot=lot, account=acct, unrealized=unrl,
                                    loss_pct=loss_pct, status="below"))
            continue
        wash = wash_status(
            lot.symbol,
            accounts=accounts,
            recent_buys=recent_buys,
            auto_buys=auto_buys,
            today=today,
            window_days=window_days,
            families=families,
        )
        out.append(
            TlhCandidate(
                lot=lot,
                account=acct,
                unrealized=unrl,
                loss_pct=loss_pct,
                status="blocked" if wash.blocked else "clear",
                wash=wash,
                replacement=partner_map.get(lot.symbol),
            )
        )
    out.sort(key=lambda c: c.unrealized)
    return out
