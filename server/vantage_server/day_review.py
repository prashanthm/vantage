"""Day-review bundle — the BOOK-level counterpart to per-trade analysis.

`Analyze today` used to loop the single-trade review N times: 19 isolated reads,
no synthesis. That misses what only exists across the whole book — direction,
time-of-day, and capital allocation. This module computes those patterns
deterministically from the day's session (exact, from fills), pulls the stored
per-trade reads as supporting texts, and builds a Mira prompt that asks for a
DAY THESIS + lessons — explicitly NOT a re-grade of each trade.

Read-only. The client streams Mira with `build_prompt(bundle)` and persists the
result via the existing journal-analysis store (period=daily, window=day..day).
"""
from __future__ import annotations

import json


def _direction(trade: dict) -> str:
    """Net directional intent: long calls = bullish, long puts = bearish.
    Spreads inherit the long leg's kind via the strategy name."""
    strat = str(trade.get("strategy") or "")
    if "put" in strat:
        return "bearish"
    if "call" in strat:
        return "bullish"
    kinds = [l.get("kind") for l in (trade.get("legs") or []) if l.get("side") == "buy"]
    if "C" in kinds and "P" not in kinds:
        return "bullish"
    if "P" in kinds and "C" not in kinds:
        return "bearish"
    return "other"


def _et_min(trade: dict) -> int:
    s = str(trade.get("opened_et") or "00:00")
    try:
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except Exception:  # noqa: BLE001
        return 0


def _is_intraday(trade: dict, day: str) -> bool:
    """True when the trade was OPENED on ``day`` — i.e. an intraday decision the
    0DTE time-of-day analysis applies to. A trade opened earlier and closed today
    is a SWING: its realized P&L belongs to today, but its entry time-of-day is a
    prior session, so it must NOT pollute the intraday time/direction buckets."""
    o = str(trade.get("opened_at") or "")[:10]
    return bool(o) and o == day


def _r(x) -> float:
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return 0.0


def _bucket(trades: list[dict]) -> dict:
    """Count/P&L for a group, plus its own win rate + profit factor — so the
    direction/time split carries the same deterministic metrics as the day."""
    pnl = sum(_r(t.get("realized")) for t in trades)
    wins = [t for t in trades if _r(t.get("realized")) > 0]
    losses = [t for t in trades if _r(t.get("realized")) < 0]
    decided = len(wins) + len(losses)   # scratches (realized == 0) excluded
    gross_win = sum(_r(t.get("realized")) for t in wins)
    gross_loss = sum(_r(t.get("realized")) for t in losses)   # negative
    return {"n": len(trades), "wins": len(wins), "losses": len(losses),
            "pnl": round(pnl, 2),
            "win_rate": round(len(wins) / decided, 3) if decided else None,
            "profit_factor": (round(gross_win / abs(gross_loss), 2)
                              if gross_loss else None)}


def gather(store, day: str, underlying: str = "SPX") -> dict:
    """Assemble the deterministic day-book bundle: the by-direction / by-time /
    allocation rollups, the held-to-expiry tail, the shared session DNA, and the
    stored per-trade reads. No model here — this is what Mira narrates."""
    from . import session_activity as _sa

    und = (underlying or "SPX").upper()
    # the FULL (all-ticker) session — the day's whole book, same list the UI shows
    sess = _sa.session(store, day, None)
    trades = sess.get("trades") or []
    completed = [t for t in trades if t.get("status") != "open"]
    # split intraday (opened today — the 0DTE decisions) from swings (opened
    # earlier, closed today). The time-of-day / direction / allocation analysis
    # is a 0DTE-intraday story, so it runs on `intraday` ONLY; swings would put a
    # prior-session entry time into today's power-hour bucket. Headline P&L and
    # win-rate/PF stay ALL-IN (every realized close is real money today).
    intraday = [t for t in completed if _is_intraday(t, day)]
    swings = [t for t in completed if not _is_intraday(t, day)]

    # direction split (the headline pattern — invisible per-trade) — intraday only
    by_dir = {d: _bucket([t for t in intraday if _direction(t) == d])
              for d in ("bearish", "bullish", "other")}

    # time-of-day split (AM open, midday trap, power hour) — intraday only
    am = [t for t in intraday if _et_min(t) < 11 * 60]
    mid = [t for t in intraday if 11 * 60 <= _et_min(t) < 14 * 60]
    pm = [t for t in intraday if _et_min(t) >= 14 * 60]
    by_time = {"open_0930_1100": _bucket(am), "midday_1100_1400": _bucket(mid),
               "power_1400_1600": _bucket(pm)}

    # swings closed today: real P&L, but not part of the intraday story — a
    # separate line so Mira counts the money without misreading the time pattern.
    swing_block = {**_bucket(swings),
                   "trades": [{"opened": str(t.get("opened_at") or "")[:10],
                               "label": t.get("label"), "ticker": t.get("ticker"),
                               "realized": _r(t.get("realized"))} for t in swings]}

    # the held-to-expiry tail (late lottos that decay to zero) — intraday only
    expired = [t for t in intraday if "expired" in str(t.get("status") or "")]
    tail = {**_bucket(expired),
            "trades": [{"time": t.get("opened_et"), "label": t.get("label"),
                        "realized": _r(t.get("realized"))} for t in expired]}

    # capital allocation: where the size went (peak contracts × side) — intraday
    def _size(t):
        return abs(_r(t.get("peak_contracts")))
    alloc = {"bearish_contracts": round(sum(_size(t) for t in intraday
                                            if _direction(t) == "bearish"), 1),
             "bullish_contracts": round(sum(_size(t) for t in intraday
                                            if _direction(t) == "bullish"), 1),
             "biggest": None}
    if intraday:
        big = max(intraday, key=_size)
        alloc["biggest"] = {"label": big.get("label"), "dir": _direction(big),
                            "contracts": _size(big), "realized": _r(big.get("realized"))}

    # a compact per-trade line (time, dir, level role at entry, P&L) — intraday spine
    rollup = []
    for t in intraday:
        corr = (t.get("correlation") or {}).get("nearest") or {}
        rollup.append({"time": t.get("opened_et"), "label": t.get("label"),
                       "ticker": t.get("ticker"), "dir": _direction(t),
                       "entry_level": corr.get("source"),
                       "entry_role": corr.get("role"),
                       "at_level": bool((t.get("correlation") or {}).get("at_level")),
                       "realized": _r(t.get("realized"))})

    # the stored per-trade reads (supporting texts — the microscope's findings)
    reads = []
    if getattr(store, "uses_sqlite", False):
        rows = store.load_trade_analysis(day) or []
        for r in rows:
            reads.append({"label": r.get("label"),
                          "read": (r.get("analysis") or "")[:400]})

    s = sess.get("summary") or {}
    return {
        "day": day, "underlying": und,
        "primary": sess.get("primary"),
        "net_pnl": _r(s.get("realized")),
        "counts": {"trades": len(trades), "completed": len(completed),
                   "open": len(trades) - len(completed),
                   "intraday": len(intraday), "swings": len(swings),
                   "winners": s.get("winners"), "losers": s.get("losers")},
        # deterministic performance metrics (from summarize) — the LLM cites
        # these, never estimates them.
        "metrics": {"win_rate": s.get("win_rate"),
                    "profit_factor": s.get("profit_factor"),
                    "gross_win": s.get("gross_win"), "gross_loss": s.get("gross_loss"),
                    "avg_win": s.get("avg_win"), "avg_loss": s.get("avg_loss"),
                    "payoff_ratio": s.get("payoff_ratio")},
        "discipline": {"entered_at_level": s.get("level_discipline"),
                       "exited_at_level": s.get("exit_discipline")},
        "by_direction": by_dir,
        "by_time": by_time,
        "expiry_tail": tail,
        "allocation": alloc,
        "swings": swing_block,   # multi-day trades closed today — P&L only, not intraday
        "trades": rollup,
        "session_dna": {
            "forecast_levels": sess.get("forecast_levels") or [],
            "gex_anchors": sess.get("gex_anchors") or [],
            "gamma_regimes": sess.get("gamma_regimes"),
            "durable_levels": sess.get("durable_levels") or [],
            "settle_price": sess.get("settle_price"),
        },
        "trade_reads": reads,
        "analyzed": len(reads),
    }


# NOTE: sections use "kind" (not "type") — that's the key the SPA's MiraRender
# switches on (mira-render.jsx isRenderableSection). keyvals→rows[{k,v}],
# list/donext→items[], callout→text. Match it exactly or the card renders blank.
OUTPUT_SCHEMA = {
    "headline": "one sentence — the thesis of the day's BOOK (not any single trade)",
    "sections": [
        {"kind": "keyvals", "title": "The day in numbers",
         "rows": [{"k": "label (include Win rate and Profit factor verbatim)",
                   "v": "value + one-line read"}]},
        {"kind": "list", "title": "What the pattern says",
         "items": [{"point": "a book-level pattern: direction, time, or allocation — cite the $ and counts"}]},
        {"kind": "callout", "title": "The one thing that made (or cost) the day",
         "text": "the single biggest driver of P&L, with the number", "tone": "good|bad|warn"},
        {"kind": "donext", "title": "Carry into tomorrow",
         "items": [{"title": "a rule", "detail": "why + the $ it would have saved/made"}]},
    ],
}


def build_prompt(bundle: dict) -> str:
    """The Mira prompt for a DAY SYNTHESIS. Deliberately frames the task as
    book-level — direction, time-of-day, allocation — and forbids re-grading
    individual trades (that's what the per-trade reads already did). Keyword
    'day synthesis'/'book' routes to the analyst voice; the deterministic
    numbers are given, so Mira narrates the thesis, not the arithmetic."""
    b = bundle
    dna = b.get("session_dna") or {}
    return (
        "You are a trading-desk coach writing a DAY SYNTHESIS of an SPX 0DTE "
        f"session ({b['day']}, {b['counts']['completed']} completed trades — "
        f"{b['counts'].get('intraday', 0)} intraday 0DTE + {b['counts'].get('swings', 0)} "
        f"multi-day swings closed today, net ${b['net_pnl']}). This is the BOOK-level "
        "read — NOT a re-grade of each trade (that's already done). Your job: name the "
        "direction / time-of-day / capital-allocation pattern that a per-trade review "
        "CANNOT see, and give the day's thesis + the lessons. Use ONLY the data below.\n"
        "\nIMPORTANT: the DIRECTION / TIME-OF-DAY / ALLOCATION blocks below cover the "
        "INTRADAY 0DTE trades ONLY — swings opened on an earlier day are listed "
        "separately (their entry time isn't part of today's intraday pattern). The "
        "headline PERFORMANCE METRICS and net P&L are ALL-IN (every close today).\n"
        f"\nNET & COUNTS: {json.dumps(b['counts'])}, net ${b['net_pnl']}, "
        f"discipline {json.dumps(b['discipline'])}.\n"
        f"\nPERFORMANCE METRICS (all-in, exact — cite verbatim, do NOT recompute): "
        f"{json.dumps(b.get('metrics'))}. profit_factor = gross wins / |gross "
        "losses| (>1 profitable, null = no losses); win_rate excludes scratches; "
        "payoff_ratio = avg_win / |avg_loss|. Read them, don't do the arithmetic.\n"
        f"\nBY DIRECTION (intraday 0DTE only — win/loss + $ per side): "
        f"{json.dumps(b['by_direction'])}.\n"
        f"\nBY TIME OF DAY (intraday 0DTE only): {json.dumps(b['by_time'])}.\n"
        f"\nSWINGS CLOSED TODAY (opened earlier — real P&L, NOT part of the intraday "
        f"time/direction story): {json.dumps(b.get('swings'))}.\n"
        f"\nHELD-TO-EXPIRY TAIL (intraday late lottos that decayed): {json.dumps(b['expiry_tail'])}.\n"
        f"\nCAPITAL ALLOCATION (intraday contracts per side + biggest ticket): "
        f"{json.dumps(b['allocation'])}.\n"
        f"\nSESSION DNA (the backdrop every trade shared) — forecast levels: "
        f"{json.dumps(dna.get('forecast_levels'))}; GEX: {json.dumps(dna.get('gex_anchors'))}; "
        f"durable: {json.dumps(dna.get('durable_levels'))}; "
        f"gamma regimes (SPX chain vs SPY proxy — if they disagree, say so and weigh "
        f"how the operator should have sized): {json.dumps(dna.get('gamma_regimes'))}.\n"
        f"\nPER-TRADE SPINE (time, dir, entry level role, $): {json.dumps(b['trades'])}.\n"
        f"\nSupporting per-trade reads (already written — draw on them, don't repeat them): "
        f"{json.dumps(b['trade_reads'])}\n"
        "\nRESPOND WITH ONLY A SINGLE JSON OBJECT — no markdown, no prose before or "
        "after — matching this shape EXACTLY (same keys):\n"
        f"{json.dumps(OUTPUT_SCHEMA, indent=1)}\n"
        "Rules: lead with the direction pattern if one side clearly carried the day. "
        "Cite real numbers ($ and counts) from the data — never invent a trade. "
        "'do_next' style items go under the donext section, most impactful first, "
        "each naming the $ it would have saved or made. Be specific and direct. "
        "Educational only — not financial advice. Output the JSON and nothing else."
    )


def _demo() -> None:
    """Self-check: direction classification, bucket rollups, and time bins."""
    trades = [
        {"strategy": "long_put", "status": "closed", "realized": 1475.0,
         "opened_et": "11:08", "peak_contracts": 25.0, "legs": [{"side": "buy", "kind": "P"}]},
        {"strategy": "long_call", "status": "closed", "realized": -515.0,
         "opened_et": "14:50", "peak_contracts": 4.0, "legs": [{"side": "buy", "kind": "C"}]},
        {"strategy": "long_call", "status": "expired_unpriced", "realized": -45.0,
         "opened_et": "15:54", "peak_contracts": 1.0, "legs": [{"side": "buy", "kind": "C"}]},
        {"strategy": "single", "status": "open", "realized": None,  # excluded
         "opened_et": "10:00", "peak_contracts": 2.0, "legs": [{"side": "buy", "kind": "C"}]},
    ]
    assert _direction(trades[0]) == "bearish"
    assert _direction(trades[1]) == "bullish"
    completed = [t for t in trades if t.get("status") != "open"]
    assert len(completed) == 3
    bear = _bucket([t for t in completed if _direction(t) == "bearish"])
    assert bear["n"] == 1 and bear["wins"] == 1 and bear["pnl"] == 1475.0
    assert bear["win_rate"] == 1.0 and bear["profit_factor"] is None   # no losses
    bull = _bucket([t for t in completed if _direction(t) == "bullish"])
    assert bull["n"] == 2 and bull["losses"] == 2 and bull["pnl"] == -560.0
    assert bull["win_rate"] == 0.0 and bull["profit_factor"] == 0.0     # 0 wins / losses
    assert _et_min(trades[0]) == 668 and _et_min(trades[1]) == 890

    # intraday vs swing: opened today = intraday; opened earlier = swing
    day = "2026-07-20"
    intraday_t = {"opened_at": "2026-07-20T11:08", "status": "closed", "realized": 500.0}
    swing_t = {"opened_at": "2026-07-17T14:00", "status": "closed", "realized": 59.0}
    assert _is_intraday(intraday_t, day) is True
    assert _is_intraday(swing_t, day) is False        # opened 3 days earlier
    assert _is_intraday({"opened_at": "", "status": "closed"}, day) is False
    print("day_review._demo OK")


if __name__ == "__main__":
    _demo()
