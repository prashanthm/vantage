"""tone.py — MARKET TONE vs TRADE TONE, side by side (pure arithmetic).

The 2026-07-21 disaster (0/11, −$9,035, nine puts into a rising tape) wasn't a
data problem — every screen knew the market was climbing. It was a comparison
problem: nothing put "what the market is doing" and "what you keep doing" next
to each other. This module does exactly that:

  market tone — the session in 15-minute buckets, each toned bull/bear/flat
                from its own open→close move (dead zone ±0.03%), plus the
                session's cumulative direction so far at each bucket.
  trade tone  — every decision entered today, placed in its bucket, its
                direction compared to the tone AT THAT TIME → with / against.

No model, no narration: the whole point is that the mismatch is visible as two
colored strips. Decision-support (ADR-008); reads only our own store.
"""
from __future__ import annotations

import datetime as _dt

DEAD_ZONE = 0.0003          # ±0.03% bucket move = flat
SESSION_START = 9 * 60 + 30
SESSION_END = 16 * 60


def _et_minute(iso: str) -> int | None:
    try:
        t = _dt.datetime.fromisoformat(str(iso))
        if t.tzinfo is None:                      # history rows are UTC-naive
            t = t.replace(tzinfo=_dt.timezone.utc)
        et = t.astimezone(_dt.timezone(_dt.timedelta(hours=-4)))
        return et.hour * 60 + et.minute
    except (TypeError, ValueError):
        return None


def market_buckets(ohlc: dict, anchor: float | None = None) -> list[dict]:
    """15-minute tone buckets from a day's 1m bars ({ts,open,close,...}).
    ``anchor`` (the PRIOR session's close) anchors the session tone — on a gap
    day the tape's true direction is vs yesterday, not vs today's open (the
    2026-07-21 trap: session-open tone read "bear" early while the market had
    gapped +42 and never looked back)."""
    ts, closes = ohlc.get("ts") or [], ohlc.get("close") or []
    per_min: dict[int, float] = {}
    for i, t in enumerate(ts):
        m = _et_minute(t)
        if m is not None and i < len(closes):
            per_min[m] = closes[i]
    out = []
    session_open = None
    for start in range(SESSION_START, SESSION_END, 15):
        mins = [m for m in per_min if start <= m < start + 15]
        if not mins:
            continue
        first, last = per_min[min(mins)], per_min[max(mins)]
        if session_open is None:
            session_open = anchor if anchor else first
        ret = (last - first) / first if first else 0.0
        tone = "bull" if ret > DEAD_ZONE else "bear" if ret < -DEAD_ZONE else "flat"
        cum = (last - session_open) / session_open if session_open else 0.0
        out.append({
            "t": f"{start // 60:02d}:{start % 60:02d}",
            "start_min": start,
            "tone": tone,
            "ret_pct": round(ret * 100, 3),
            "close": round(last, 2),
            # the session's direction SO FAR at this bucket's end — the trend a
            # trade opened here was actually with or against
            "session_tone": ("bull" if cum > DEAD_ZONE else
                             "bear" if cum < -DEAD_ZONE else "flat"),
            "session_ret_pct": round(cum * 100, 3),
        })
    return out


def _direction(trade: dict) -> str:
    strat = str(trade.get("strategy") or "")
    if "put" in strat:
        return "bearish"
    if "call" in strat:
        return "bullish"
    kinds = [l.get("kind") for l in (trade.get("legs") or [])
             if l.get("side") == "buy"]
    if "C" in kinds and "P" not in kinds:
        return "bullish"
    if "P" in kinds and "C" not in kinds:
        return "bearish"
    return "other"


def build(store, day: str, symbol: str = "SPX") -> dict:
    """The side-by-side payload: market buckets + today's trades toned against
    the session direction at their entry minute + the alignment ledger."""
    from . import session_activity as _sa
    from .replay_forecast import bar_sym_for

    bar_sym = bar_sym_for(symbol)
    ohlc = store.load_intraday_bars(bar_sym, day, "1m")
    # anchor = prior session's last close (walk back over weekends/holidays)
    prior_close = None
    try:
        d0 = _dt.date.fromisoformat(day)
        for back in range(1, 6):
            prev = (d0 - _dt.timedelta(days=back)).isoformat()
            po = store.load_intraday_bars(bar_sym, prev, "1m")
            if po and po.get("close"):
                prior_close = float(po["close"][-1])
                break
    except (TypeError, ValueError):
        pass
    buckets = market_buckets(ohlc, anchor=prior_close) if ohlc else []
    by_start = {b["start_min"]: b for b in buckets}

    # today's decisions, fills-only (no bar enrichment — this must be FAST)
    rows = _sa.fills_for(store, day, None)
    from collections import defaultdict
    per_acct = defaultdict(list)
    for r in rows:
        per_acct[_sa._acct_of(r)].append(r)
    trades = []
    for arows in per_acct.values():
        trades.extend(_sa.build_trades(_sa.group_orders(arows)))
    trades = [t for t in trades
              if str(t.get("opened_at") or "").startswith(day)
              or (t.get("closed_at") or "").startswith(day)]

    placed, w, a = [], {"n": 0, "pnl": 0.0}, {"n": 0, "pnl": 0.0}
    for t in trades:
        d = _direction(t)
        if d == "other":
            continue
        m = _et_minute(t.get("opened_at"))
        if m is None:
            continue
        bucket = by_start.get((m - SESSION_START) // 15 * 15 + SESSION_START
                              if m >= SESSION_START else None)
        stone = bucket.get("session_tone") if bucket else None
        with_trend = (None if not stone or stone == "flat"
                      else (d == "bullish") == (stone == "bull"))
        realized = t.get("cost", 0) + t.get("proceeds", 0) \
            if t.get("status") != "open" else None
        placed.append({
            "time": f"{m // 60:02d}:{m % 60:02d}", "start_min": m,
            "opened_at": t.get("opened_at"),   # trade_key = "{opened_at}|{label}"
            "label": t.get("label") or "{} ×{:g}".format(
                t.get("strategy") or "?", abs(t.get("open_contracts") or
                                              t.get("peak_contracts") or 0) or 0), "dir": d,
            "with_trend": with_trend,
            "realized": round(realized, 2) if realized is not None else None,
            "status": t.get("status"),
        })
        if realized is not None and with_trend is not None:
            side = w if with_trend else a
            side["n"] += 1
            side["pnl"] = round(side["pnl"] + realized, 2)

    # the blunt line the cockpit shows when the pattern is live
    verdict = None
    cur = buckets[-1]["session_tone"] if buckets else None
    if a["n"] >= 3 and a["pnl"] < 0 and a["n"] > w["n"]:
        verdict = (f"{a['n']} of your {a['n'] + w['n']} directional entries today "
                   f"fought the session tone (net {a['pnl']:+,.0f}). The tape is "
                   f"{(cur or '?').upper()} right now — stop trading against it or stand down.")

    # descriptive commentary — every line is arithmetic, newest concern first
    commentary: list[dict] = []
    day_pnl = round(w["pnl"] + a["pnl"], 2)
    closed = [p_ for p_ in placed if p_["realized"] is not None]
    streak = 0
    for p_ in reversed(closed):
        if p_["realized"] < 0:
            streak += 1
        else:
            break
    if day_pnl <= -2000:
        commentary.append({"tone": "bad", "text":
            f"Daily stop breached: {day_pnl:+,.0f} realized (rule: stop at −2,000). "
            "Today is over — anything else is revenge trading."})
    elif streak >= 3:
        commentary.append({"tone": "bad", "text":
            f"{streak} consecutive losses. Your own futures analysis says walk "
            "after 3 straight — step away from the next entry."})
    if cur and closed:
        last = closed[-1]
        fought = last["with_trend"] is False
        commentary.append({"tone": "bad" if fought else "good", "text":
            f"Last entry {last['time']} {last['label']} was "
            f"{'AGAINST' if fought else 'with'} the {cur.upper()} tape "
            f"({last['realized']:+,.0f})."})
    if cur:
        mins_left = SESSION_END - (buckets[-1]["start_min"] + 15)
        commentary.append({"tone": "plain", "text":
            f"Session is {cur.upper()} ({buckets[-1]['session_ret_pct']:+.2f}% vs "
            f"prior close) · ~{max(0, mins_left)} min left."})
    if a["n"] + w["n"] > 0:
        commentary.append({"tone": "good" if w["pnl"] >= a["pnl"] else "bad", "text":
            f"Alignment today: with-trend {w['n']} for {w['pnl']:+,.0f} · "
            f"against-trend {a['n']} for {a['pnl']:+,.0f}."})
    gap_pct = None
    if prior_close and ohlc and ohlc.get("close"):
        try:
            first_close = float(ohlc["close"][0])
            gap_pct = round((first_close - prior_close) / prior_close * 100, 2)
        except (TypeError, ValueError, IndexError):
            pass
    return {"day": day, "symbol": symbol.upper(), "buckets": buckets,
            "prior_close": prior_close, "gap_pct": gap_pct,
            "trades": sorted(placed, key=lambda x: x["start_min"]),
            "alignment": {"with": w, "against": a}, "verdict": verdict,
            "commentary": commentary, "day_pnl": day_pnl, "streak": streak}


def _demo() -> None:
    ohlc = {"ts": [f"2026-07-21T{13 + h}:{m:02d}:00+00:00"      # 09:30+ ET
                   for h in range(2) for m in range(0, 60)],
            "close": [100 + i * 0.01 for i in range(120)]}      # steady climb
    b = market_buckets(ohlc)
    assert b and all(x["tone"] == "bull" for x in b), b[:2]
    assert b[-1]["session_tone"] == "bull"
    assert _direction({"strategy": "long_put"}) == "bearish"
    assert _direction({"strategy": "long_call_spread"}) == "bullish"
    print("tone._demo OK")


if __name__ == "__main__":
    _demo()
