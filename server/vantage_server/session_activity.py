"""What did I ACTUALLY do today — as TRADES, not fills.

A trade is a DECISION, not a contract: one order may carry several legs (a
long_call_spread is one trade with two legs), and a decision has a thought
behind it, a time, and a price of the underlying at that moment. This module
reconstructs those decisions from the broker's own record, then scores each
against the levels the playbook forecast — so the journal can answer the real
question: *did I read the tape correctly, and did price respect the levels I
was trading against?*

THREE things the naive fill-pairing got wrong, all found live 2026-07-14:

1. **Multi-leg trades.** Robinhood's ``description`` names the strategy and
   whether it opens or closes ("long_call_spread open (debit)"), and legs of
   one order share a timestamp. So legs are grouped into ONE trade — a
   7555C/7560C spread is one decision, not two contracts.

2. **Expiry is invisible.** A 0DTE you let expire has NO closing fill and NO
   settlement row — Robinhood simply stops listing it. The naive model called
   those "still open at close". They are not: they RESOLVED, against the SPX
   settlement print. On 2026-07-14 four trades expired worthless (−$2,260 of
   premium that no fill records), and the flat-vs-held distinction matters
   just as much: a contract fully bought AND sold is CLOSED and must never be
   re-settled — mis-tracking that invented ~$2,500 of P&L that never happened.
   Expired positions are settled here from the SIGNED net still held:
   intrinsic = max(0, settle − strike) for a call, max(0, strike − settle)
   for a put, × $100 × contracts.

3. **No context.** A trade's P&L says what happened; the SPX price AT THE
   MOMENT of entry, and the forecast level nearest to it, say whether the
   THINKING was right. Every trade is stamped with the underlying's price at
   entry and exit (from 5m bars) and aligned to the session's forecast levels.

Pure computation over the store + bars — no broker I/O, no orders (ADR-010).
"""
from __future__ import annotations

import datetime as _dt
import logging
import re
from collections import defaultdict

log = logging.getLogger(__name__)

#: SPX/SPXW index options settle for cash at $100 per index point.
INDEX_MULTIPLIER = 100.0

#: A level counts as "traded against" when the entry print is within this % of
#: it — the trade was keyed off that level rather than floating in open space.
#: 0.15% was uselessly loose (±11pt at SPX 7500 marked EVERY trade "at level",
#: so the discipline metric always read 100%). 0.05% ≈ ±3.75pt: close enough
#: that the level plausibly drove the entry, tight enough to discriminate.
LEVEL_TOL_PCT = 0.05

_CONTRACT = re.compile(r"^(?P<und>\S+)\s+(?P<exp>\d{4}-\d{2}-\d{2})\s+"
                       r"(?P<strike>[\d.]+)(?P<kind>[CP])$")


def parse_contract(symbol: str) -> dict | None:
    """"SPXW 2026-07-14 7525C" -> {underlying, expiration, strike, kind}."""
    m = _CONTRACT.match(str(symbol or "").strip())
    if not m:
        return None
    return {"underlying": m.group("und"), "expiration": m.group("exp"),
            "strike": float(m.group("strike")), "kind": m.group("kind")}


def strategy_of(description: str) -> tuple[str, str]:
    """RH descriptions read "long_call_spread open (debit)" -> (strategy,
    effect). Effect is "open" | "close" | "" when unstated."""
    d = str(description or "").lower()
    strat = d.split(" ")[0] if d else ""
    effect = "open" if " open" in d else ("close" if " close" in d else "")
    return strat, effect


def intrinsic(kind: str, strike: float, settle: float) -> float:
    """Per-index-point value of one contract at expiry. Cash settlement: an
    OTM option is worth exactly zero — the whole premium is lost."""
    return max(0.0, settle - strike) if kind == "C" else max(0.0, strike - settle)


# ─────────────────────────────────────────────────────── grouping fills → trades

def _order_key(fill: dict) -> tuple:
    """Legs of ONE order share a timestamp and a strategy description — that
    is the decision unit. (RH gives us no order id in the history row.)"""
    strat, effect = strategy_of(fill.get("description"))
    return (str(fill.get("date") or "")[:16], strat, effect)


def group_orders(fills: list[dict]) -> list[dict]:
    """Fills -> ORDERS (one decision each), legs grouped. Each order:
    {at, strategy, effect, legs[], debit (signed cash), contracts}."""
    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for f in fills:
        by_key[_order_key(f)].append(f)

    orders = []
    for (at, strat, effect), legs in by_key.items():
        cash = sum(float(l.get("amount") or 0) for l in legs)
        orders.append({
            "at": at,
            "strategy": strat or "single",
            "effect": effect,
            "legs": [{
                "symbol": l.get("symbol"),
                "side": l.get("side"),
                "qty": abs(float(l.get("quantity") or 0)),
                "price": float(l.get("price") or 0),
                "amount": float(l.get("amount") or 0),
                **(parse_contract(l.get("symbol")) or {}),
            } for l in legs],
            "cash": round(cash, 2),          # −debit paid / +credit received
            "contracts": sum(abs(float(l.get("quantity") or 0)) for l in legs),
        })
    orders.sort(key=lambda o: o["at"])
    return orders


def build_trades(orders: list[dict]) -> list[dict]:
    """Orders -> TRADES: an opening order starts a trade; later closing orders
    on the same position reduce it. A trade is keyed by its leg set (the
    structure), so a spread's re-entry is a NEW trade, not a mutation.

    Returns trades with {opened_at, closed_at, strategy, legs, cost (debit
    paid), proceeds (credits), realized, open_qty, status}."""
    live: dict[str, dict] = {}       # CONTRACT symbol -> the open trade holding it
    trades: list[dict] = []          # every trade ever created, in order

    # A position is held per CONTRACT, but a decision spans the contracts an
    # order opened together. One close order can settle legs of TWO different
    # trades (live 2026-07-14: an 18:42 order sold 7550P and 7555P — legs of
    # two separate singles), so closes are applied LEG BY LEG to whichever
    # trade holds that contract. Structure-level matching cannot express that,
    # which is what invented $2,500 of P&L that never happened.
    def _new_trade(o, legs):
        t = {
            "opened_at": o["at"] if o["effect"] != "close" else None,
            "closed_at": None, "strategy": o["strategy"],
            "legs": [], "cost": 0.0, "proceeds": 0.0,
            "net": {}, "open_contracts": 0.0, "peak_contracts": 0.0, "status": "open",
            "entry_unknown": o["effect"] == "close",
            "opens": [], "closes": [],
        }
        trades.append(t)
        return t

    def _apply(t, o, legs):
        cash = round(sum(float(l["amount"]) for l in legs), 2)
        if o["effect"] == "close":
            t["proceeds"] = round(t["proceeds"] + cash, 2)
            t["closed_at"] = o["at"]
            t["closes"].append({**o, "legs": legs})
        else:
            t["cost"] = round(t["cost"] + cash, 2)     # negative = debit paid
            t["opens"].append({**o, "legs": legs})
        known = {x["symbol"] for x in t["legs"]}
        for l in legs:
            sym = l["symbol"]
            sign = 1.0 if l["side"] == "buy" else -1.0
            t["net"][sym] = round(t["net"].get(sym, 0.0) + sign * l["qty"], 4)
            if abs(t["net"][sym]) > 1e-9:
                live[sym] = t                          # still holding this leg
            elif live.get(sym) is t:
                live.pop(sym, None)                    # flat in this contract
            if sym not in known:
                t["legs"].append(l)
                known.add(sym)
        t["open_contracts"] = round(sum(abs(q) for q in t["net"].values()), 2)
        # peak size the position ever held — the true "×N" of the decision,
        # tracked across scale-ins (a 3-lot ladder peaks at 3 even though it
        # ends flat). Drives the label and the scale read.
        t["peak_contracts"] = max(t.get("peak_contracts", 0.0), t["open_contracts"])
        if t["open_contracts"] <= 1e-9:
            t["status"] = "closed"                     # the decision is finished

    for o in orders:
        if o["effect"] == "close":
            # group this order's legs by the trade that actually holds them
            groups: dict[int, list[dict]] = defaultdict(list)
            for l in o["legs"]:
                groups[id(live.get(l["symbol"]))].append(l)
            for _, legs in groups.items():
                t = live.get(legs[0]["symbol"]) or _new_trade(o, legs)
                _apply(t, o, legs)
        else:
            # an opening order is ONE decision; scaling into a contract you
            # already hold continues that same trade
            held = [live[l["symbol"]] for l in o["legs"] if l["symbol"] in live]
            t = held[0] if held else _new_trade(o, o["legs"])
            _apply(t, o, o["legs"])

    trades.sort(key=lambda t: t["opened_at"] or t["closed_at"] or "")
    return trades


# ───────────────────────────────────────────────── expiry: the invisible closes

def settle_expired(trade: dict, day: str, settle_price: float | None) -> dict:
    """Resolve a trade left open past its expiry. THE thing fills cannot tell
    you: an expired 0DTE has no closing fill and no settlement row — Robinhood
    just stops listing it. Worthless = the full debit is lost; ITM = cash paid
    at intrinsic. Untouched when the contracts have not expired yet.

    ``trade["net"]`` is the SIGNED contract count still held per symbol,
    computed from the fills themselves (buys − sells) rather than from a
    running counter — live 2026-07-14, a counter mis-tracked scale-ins and
    "settled" positions the operator had actually closed, inventing +$2,500
    of P&L that never happened."""
    if trade["status"] != "open" or not trade["legs"]:
        return trade
    held = {sym: q for sym, q in (trade.get("net") or {}).items() if abs(q) > 1e-9}
    if not held:
        trade["status"] = "closed"          # flat: the fills already closed it
        trade["open_contracts"] = 0.0
        return trade

    exps = {l.get("expiration") for l in trade["legs"]
            if l.get("expiration") and l["symbol"] in held}
    if not exps or min(exps) > day:
        return trade                                    # still live
    if settle_price is None:
        trade["status"] = "expired_unpriced"            # honest: cannot settle
        return trade

    payout = 0.0
    for sym, qty in held.items():
        c = parse_contract(sym)
        if not c:
            continue
        # signed: a long leg RECEIVES intrinsic, a short leg PAYS it
        payout += (intrinsic(c["kind"], c["strike"], settle_price)
                   * INDEX_MULTIPLIER * qty)
    trade["settlement"] = round(payout, 2)
    trade["settle_price"] = settle_price
    trade["closed_at"] = f"{day}T16:00"
    trade["status"] = "expired_worthless" if abs(payout) < 1e-9 else "expired_settled"
    trade["open_contracts"] = 0.0
    return trade


# ─────────────────────────────────────────────── context: price + level alignment

def to_et(when: str):
    """Broker history stamps are UTC ("2026-07-14T13:36:47Z" = 09:36 ET).
    Reading them as ET put every trade ~4h late and priced it off a stale
    bar — so the conversion is not cosmetic, it is the whole point of
    "what was SPX doing when I pulled the trigger"."""
    from zoneinfo import ZoneInfo
    if not when:
        return None
    txt = str(when).replace("Z", "+00:00")
    try:
        ts = _dt.datetime.fromisoformat(txt)
    except ValueError:
        return None
    if ts.tzinfo is None:                       # naive -> assume UTC (broker's)
        ts = ts.replace(tzinfo=_dt.timezone.utc)
    return ts.astimezone(ZoneInfo("America/New_York"))


def _bar_price_at(bars, when: str) -> float | None:
    """The underlying's price at the MINUTE of a trade. 0DTE moves points in
    minutes: a 15m bar's close can be 9 minutes and 15 points away from the
    fill (live 2026-07-14, a 09:36 trade priced 7539.79 off the 15m close was
    really 7525.94 on the minute — right on the 7525 forecast level the 15m
    miss hid). The bar covering the timestamp is used; None when bars are
    missing — never guessed."""
    if bars is None or getattr(bars, "empty", True) or not when:
        return None
    ts = to_et(when)
    if ts is None:
        return None
    prior = bars[bars.index <= ts]
    if prior.empty:
        # trade before the first bar we have (pre-open print) — take the first
        return round(float(bars["Close"].iloc[0]), 2)
    return round(float(prior["Close"].iloc[-1]), 2)


def correlate_levels(price: float | None, levels: list[dict],
                     anchors: list[dict]) -> dict | None:
    """ALL the forecast levels this trade was near — not just the nearest.

    A 0DTE decision keys off structure: a strike sitting at a call wall, an
    entry taken as price tests the gamma flip. So for the trade's SPX print we
    return every confluence level AND GEX anchor within threshold, nearest
    first, each with its signed distance in points and %. The UI turns this
    into a dropdown to TAG which level the operator actually traded — "SPX was
    7525.94, forecast had 7525 resistance (call wall + fib 78.6%), tag it".

    ``at_level`` is true when the closest is within LEVEL_TOL_PCT; ``nearby``
    is everything within 3× that (the candidate tags)."""
    if price is None:
        return None
    cands: list[dict] = []
    for z in (levels or []):
        lp = _f(z.get("price"))
        if lp is None:
            continue
        dist = lp - price
        cands.append({
            "level": round(lp, 2), "source": "confluence",
            "role": z.get("role"), "kinds": z.get("kinds") or [],
            "distance": round(dist, 2),
            "distance_pct": round(abs(dist) / price * 100, 3) if price else None,
        })
    for a in (anchors or []):
        lp = _f(a.get("price"))
        if lp is None:
            continue
        dist = lp - price
        cands.append({
            "level": round(lp, 2), "source": "gex",
            "role": a.get("label"), "kinds": [a.get("label")],
            "distance": round(dist, 2),
            "distance_pct": round(abs(dist) / price * 100, 3) if price else None,
        })
    if not cands:
        return None
    cands.sort(key=lambda c: abs(c["distance"]))
    nearest = cands[0]
    tol = price * LEVEL_TOL_PCT / 100.0
    nearby = [c for c in cands if abs(c["distance"]) <= tol * 3]
    return {
        "nearest": nearest,
        "at_level": abs(nearest["distance"]) <= tol,
        "nearby": nearby,          # candidate tags for the dropdown
        "all": cands,              # the full ladder, for the "other…" option
    }


def _f(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def gex_anchors(scaffold: dict) -> list[dict]:
    """The GEX/regime price anchors as taggable levels: spot, gamma flip,
    call/put walls, max pain, vol trigger — whatever the scaffold carries."""
    reg = scaffold.get("regime") or {}
    gex = scaffold.get("gex") or {}
    out = []
    for key, label in (("flip", "gamma flip"), ("call_wall", "call wall"),
                       ("put_wall", "put wall"), ("max_pain", "max pain"),
                       ("vol_trigger", "vol trigger"), ("spot", "prior spot")):
        v = _f(reg.get(key)) or _f(gex.get(key))
        if v is not None:
            out.append({"price": v, "label": label})
    return out


# ──────────────────────────────────────────────────────────── the session build

def fills_for(store, day: str, underlying: str | None = None) -> list[dict]:
    """Every FILLED execution on ``day``, oldest first. ``underlying="SPX"``
    also matches SPXW contracts (the 0DTE weeklies)."""
    rows = [r for r in store.load_history()
            if str(r.get("date") or "").startswith(day)
            and str(r.get("state") or "").lower() == "filled"]
    if underlying:
        u = underlying.upper()
        rows = [r for r in rows
                if str(r.get("symbol") or "").upper().startswith((u, u + "W"))]
    rows.sort(key=lambda r: str(r.get("date") or ""))
    return rows


def _settle_price(day: str, symbol: str = "^GSPC") -> float | None:
    """The underlying's settlement print for ``day`` — what an expiring
    contract is cash-settled against. None when unavailable (never guessed:
    an unpriced expiry is reported as such, not assumed worthless)."""
    try:
        import yfinance as yf
        h = yf.Ticker(symbol).history(start=day, period="5d", interval="1d")
        if h.empty:
            return None
        for ts, row in h.iterrows():
            if str(ts)[:10] == day:
                return round(float(row["Close"]), 2)
    except Exception as e:
        log.warning("settlement price unavailable for %s: %s", day, e)
    return None


def session(store, day: str | None = None, underlying: str = "SPX") -> dict:
    """One session's trading as DECISIONS — multi-leg trades, expiry settled,
    each stamped with the underlying's price at entry and the forecast level
    it was taken against.

    Returns {day, underlying, settle_price, trades[], summary{...}}."""
    from . import spx_playbook as _pb
    day = day or _dt.date.today().isoformat()
    und = (underlying or "SPX").upper()

    fills = fills_for(store, day, und)
    trades = build_trades(group_orders(fills))

    settle = _settle_price(day) if und == "SPX" else _settle_price(day, und)
    for t in trades:
        settle_expired(t, day, settle)

    # MINUTE bars so "SPX when I pulled the trigger" is honest (a 15m close is
    # up to 9 min / ~15pt off the fill on a 0DTE). Fall back to 15m if the 1m
    # window is unavailable (yfinance caps 1m at ~30 days).
    bars = _intraday_bars("^GSPC" if und == "SPX" else und, day)

    # the playbook FOR this session is the one whose `session` == day (it is
    # generated the evening before, so it is stored under the PRIOR date).
    row = store.load_spx_playbook_before(day, symbol=und) or store.load_spx_playbook(day, symbol=und)
    scaffold = (row or {}).get("scaffold") or {}
    levels = scaffold.get("confluence") or []
    anchors = gex_anchors(scaffold)

    for t in trades:
        t["spot_at_entry"] = _bar_price_at(bars, t.get("opened_at"))
        # an EXPIRED trade "closes" at the settlement print (its closed_at is
        # 16:00), so the exit price IS the settlement — the fill bar would be
        # blank. A traded exit uses the 1m print at the close.
        if str(t["status"]).startswith("expired") and t.get("settle_price"):
            t["spot_at_exit"] = round(float(t["settle_price"]), 2)
        else:
            t["spot_at_exit"] = _bar_price_at(bars, t.get("closed_at"))
        t["correlation"] = correlate_levels(t["spot_at_entry"], levels, anchors)
        # the EXIT correlation — where was SPX when I got out, and was THAT a
        # level? Half the decision the entry-only view was missing.
        t["exit_correlation"] = correlate_levels(t["spot_at_exit"], levels, anchors)
        # legacy alias the table still reads (nearest + at_level)
        corr = t["correlation"]
        t["level_at_entry"] = ({
            "level": corr["nearest"]["level"], "role": corr["nearest"]["role"],
            "kinds": corr["nearest"]["kinds"],
            "distance_pct": corr["nearest"]["distance_pct"],
            "at_level": corr["at_level"],
        } if corr else None)
        # realized = credits received + settlement − debits paid (cost is signed)
        t["realized"] = round(t["cost"] + t["proceeds"] + t.get("settlement", 0.0), 2)
        # the fill ladder + its scale read — the scale-in/out geometry the one
        # grouped line item hides (blended, no invented per-lot P&L)
        t["fills"] = fills_ladder(t)
        t["scale"] = scale_read(t["fills"], t.get("peak_contracts") or 0.0)
        t["label"] = _label(t)

    summary = summarize(day, und, trades, settle)
    # drop internal scaffolding from the wire payload — opens/closes/net were
    # the machinery for grouping and settling; the client reads fills/scale.
    for t in trades:
        for k in ("opens", "closes", "net"):
            t.pop(k, None)

    return {
        "day": day,
        "underlying": und,
        "settle_price": settle,
        "forecast_levels": levels,       # the full ladder, for the "other…" tag
        "gex_anchors": anchors,
        "playbook_session": (row or {}).get("session"),
        "trades": trades,
        "summary": summary,
    }


def day_pnl_range(store, days: list[str], underlying: str = "SPX") -> dict:
    """Realized P&L per day for a set of dates — CHEAP: fills only, no bar
    fetches, no level correlation, no expiry settlement (the strip just needs a
    +/− tint, not the full DNA). Returns {day: {realized, trades, has_fills}}.

    NOTE realized here is fill cash-flow (credits − debits); it excludes expiry
    settlement, so a day whose only outcome was a 0DTE expiry reads flat. The
    full per-trade P&L on the day panel is authoritative; this is a glance."""
    out: dict[str, dict] = {}
    want = set(days)
    # one pass over history, bucketed by day
    by_day: dict[str, list[dict]] = {}
    for r in store.load_history():
        d = str(r.get("date") or "")[:10]
        if d not in want or str(r.get("state") or "").lower() != "filled":
            continue
        sym = str(r.get("symbol") or "").upper()
        u = underlying.upper()
        if not (sym.startswith(u) or sym.startswith(u + "W")):
            continue
        by_day.setdefault(d, []).append(r)
    for d in days:
        rows = by_day.get(d, [])
        trades = build_trades(group_orders(rows))
        realized = round(sum(t["cost"] + t["proceeds"] for t in trades), 2)
        out[d] = {"realized": realized, "trades": len(trades),
                  "has_fills": bool(rows)}
    return out


def _intraday_bars(symbol: str, day: str):
    """Minute bars for ``day`` (best), falling back to the stored 15m series.
    RTH only, ET-indexed — the reference for pinning a fill to a price."""
    from . import spx_playbook as _pb
    try:
        import yfinance as yf
        from zoneinfo import ZoneInfo
        nxt = (_dt.date.fromisoformat(day) + _dt.timedelta(1)).isoformat()
        h = yf.Ticker(symbol).history(start=day, end=nxt, interval="1m")
        if not h.empty:
            if h.index.tz is None:
                h.index = h.index.tz_localize("UTC")
            h.index = h.index.tz_convert(ZoneInfo("America/New_York"))
            mins = h.index.hour * 60 + h.index.minute
            h = h[(mins >= 9 * 60 + 30) & (mins < 16 * 60)]
            if not h.empty:
                return h
    except Exception as e:
        log.warning("1m bars unavailable for %s (%s) — falling back to 15m", day, e)
    try:
        return _pb._fetch_15m(symbol)
    except Exception as e:
        log.warning("intraday bars unavailable: %s", e)
        return None


def _label(t: dict) -> str:
    """A human name for the decision: "long_call_spread 7555/7560 ×3".

    The size is the PEAK contracts the position ever held, not one leg's qty.
    A ladder of three 1-lots is a ×3 decision — reading it "×1" (the old
    max-leg-qty) hid the scaling entirely (live 2026-07-14, a 7545P laddered
    3-in/3-out showed as ×1)."""
    strikes = sorted({int(l["strike"]) for l in t["legs"] if l.get("strike")})
    s = "/".join(str(x) for x in strikes) if strikes else "?"
    qty = t.get("peak_contracts") or max((l["qty"] for l in t["legs"]), default=0)
    return f"{t['strategy']} {s}" + (f" ×{qty:g}" if qty else "")


def fills_ladder(t: dict) -> list[dict]:
    """Every distinct execution of this trade in time order, with the running
    NET position after each — the scale-in / scale-out geometry the grouped
    line item hides. Built from the opens/closes already captured per order.

    Each row: {at, effect, side, qty, price, symbol, strike, kind, running}.
    ``running`` is signed net contracts held (per this trade) after the fill —
    so a ladder reads: +1, +2, +3, then −1, −2, 0.

    No per-fill P&L: Robinhood records no lot linkage, so pairing a sell to a
    specific buy would be a FIFO/LIFO ASSUMPTION, not a fact. Blended averages
    (avg entry/exit) are honest; invented per-lot P&L is the same class of
    error as the settlement bug the module warns about."""
    rows = []
    for grp in (t.get("opens") or []) + (t.get("closes") or []):
        for l in grp["legs"]:
            rows.append({
                "at": grp["at"], "effect": grp["effect"] or "",
                "side": l["side"], "qty": l["qty"], "price": l["price"],
                "symbol": l["symbol"], "strike": l.get("strike"),
                "kind": l.get("kind"), "amount": l["amount"],
            })
    rows.sort(key=lambda r: (r["at"], 0 if r["side"] == "buy" else 1))
    running: dict[str, float] = {}
    net = 0.0
    for r in rows:
        running[r["symbol"]] = running.get(r["symbol"], 0.0) + (
            r["qty"] if r["side"] == "buy" else -r["qty"])
        net = round(sum(abs(q) for q in running.values()), 2)
        r["running"] = net
    return rows


def scale_read(ladder: list[dict], peak: float) -> dict | None:
    """The blended read on a scaled position — avg entry, avg exit, peak size,
    and WHETHER the operator added on strength or averaged down, laddered out
    or one-shot. This is the discipline signal a single blended P&L can't show.

    Prices are contract prices (per share); averages are qty-weighted. Returns
    None for an un-scaled trade (single in, single out) — nothing to read."""
    buys = [r for r in ladder if r["side"] == "buy"]
    sells = [r for r in ladder if r["side"] == "sell"]
    if len(buys) + len(sells) <= 2:
        return None                         # not a ladder; the P&L says it all
    def _wavg(rs):
        q = sum(r["qty"] for r in rs)
        return round(sum(r["price"] * r["qty"] for r in rs) / q, 2) if q else None
    avg_in, avg_out = _wavg(buys), _wavg(sells)
    # did adds come at higher or lower prices than the first entry?
    add_dir = None
    if len(buys) > 1:
        first = buys[0]["price"]
        adds = [b["price"] for b in buys[1:]]
        higher = sum(1 for p in adds if p > first)
        lower = sum(1 for p in adds if p < first)
        add_dir = ("added on strength" if higher > lower
                   else "averaged down" if lower > higher else "added flat")
    # did the exit ladder out, or dump at once?
    exit_style = None
    if sells:
        exit_style = "laddered out" if len(sells) > 1 else "one-shot exit"
    return {
        "peak_contracts": peak,
        "entries": len(buys), "exits": len(sells),
        "avg_entry": avg_in, "avg_exit": avg_out,
        "add_behavior": add_dir,           # None when only one entry
        "exit_style": exit_style,
    }


def summarize(day: str, und: str, trades: list[dict], settle: float | None) -> dict:
    """The session's behavioral read — not just P&L, but whether the decisions
    respected the plan."""
    closed = [t for t in trades if t["status"] != "open"]
    realized = round(sum(t["realized"] for t in closed), 2)
    from_fills = round(sum(t["cost"] + t["proceeds"] for t in closed), 2)
    from_expiry = round(sum(t.get("settlement", 0.0) for t in closed), 2)
    expired = [t for t in closed if t["status"].startswith("expired")]
    worthless = [t for t in expired if t["status"] == "expired_worthless"]
    winners = [t for t in closed if t["realized"] > 0]
    entered_at = [t for t in trades
                  if (t.get("correlation") or {}).get("at_level")]
    exited_at = [t for t in trades
                 if (t.get("exit_correlation") or {}).get("at_level")]
    # the cleanest discipline: entered AND exited at a forecast level (a
    # level-to-level trade — the playbook's whole premise)
    both = [t for t in trades
            if (t.get("correlation") or {}).get("at_level")
            and (t.get("exit_correlation") or {}).get("at_level")]
    return {
        "trades": len(trades),
        "closed": len(closed),
        "realized": realized,
        "realized_from_fills": from_fills,
        "realized_from_expiry": from_expiry,   # the money no fill ever showed
        "expired": len(expired),
        "expired_worthless": len(worthless),
        "expired_loss": round(sum(t["realized"] for t in worthless), 2),
        "winners": len(winners),
        "losers": len(closed) - len(winners),
        "settle_price": settle,
        # THE behavioral metric: did I trade the levels I forecast, or improvise?
        "traded_at_level": len(entered_at),
        "level_discipline": (round(len(entered_at) / len(trades), 2)
                             if trades else None),
        "exited_at_level": len(exited_at),
        "exit_discipline": (round(len(exited_at) / len(closed), 2)
                            if closed else None),
        "level_to_level": len(both),           # entered AND exited at a level
    }
