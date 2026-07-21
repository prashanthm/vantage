"""cockpit_frames — the 15-minute playbook ledger (the cockpit's spine).

The cockpit is not a summary: it is the session as a sequence of 15-minute
FRAMES, each one answering, in order:

  CALL     — the analyst forecast standing at the frame's start (bias, target,
             invalidation, born_invalid) and how old it was.
  MARKET   — what price actually did inside the frame (tone, move, close).
  RESOLVED — the deterministic score of the call once the tape answered
             (hit target / direction correct|wrong / invalidated), read from
             the stored score the auto-loop applies.
  YOU      — the fills that landed in the frame, each with/against the session
             tone, and the frame's realized P&L.

Everything is derived from persisted inputs (spx_forecast rows + scores, 1m
bars, broker fills), so ANY past day replays identically — the history IS the
store. Read-only; deterministic; ADR-008.
"""
from __future__ import annotations

import datetime as _dt
import json as _json

from .tone import SESSION_END, SESSION_START, _et_minute, build as tone_build


def _frame_of(minute: int) -> int | None:
    if minute is None or minute < SESSION_START or minute >= SESSION_END:
        return None
    return (minute - SESSION_START) // 15


def build(store, day: str, symbol: str = "SPX") -> dict:
    tone = tone_build(store, day, symbol)
    buckets = {(_b["start_min"] - SESSION_START) // 15: _b
               for _b in tone.get("buckets") or []}
    trades_by_frame: dict[int, list] = {}
    for t in tone.get("trades") or []:
        f = _frame_of(t.get("start_min"))
        if f is not None:
            trades_by_frame.setdefault(f, []).append(t)

    # forecasts for the day, oldest→newest, each mapped to the frame containing
    # its as_of; a frame with no own forecast inherits the latest standing one.
    fx = list(reversed(store.list_spx_forecasts(symbol.upper(), day, 100)
                       if getattr(store, "uses_sqlite", False) else []))
    calls_by_frame: dict[int, dict] = {}
    for r in fx:
        m = _et_minute(r.get("as_of"))
        f = _frame_of(m)
        if f is None:
            continue
        fc = r.get("forecast") or {}
        if isinstance(fc, str):
            try:
                fc = _json.loads(fc)
            except (ValueError, TypeError):
                fc = {}
        plot = (fc.get("plot") if isinstance(fc, dict) else None) or {}
        sc = r.get("score")
        if isinstance(sc, str):
            try:
                sc = _json.loads(sc)
            except (ValueError, TypeError):
                sc = None
        calls_by_frame[f] = {
            "id": r.get("id"), "as_of": r.get("as_of"),
            "minute": f"{m // 60:02d}:{m % 60:02d}",
            "price_at": r.get("price_at"),
            "bias": plot.get("bias"), "target": plot.get("target"),
            "invalidation": plot.get("invalidation"),
            "born_invalid": bool(plot.get("born_invalid")),
            "path": [s for s in (plot.get("path") or [])
                     if isinstance(s, dict) and s.get("price") is not None][:3],
            "score": ({"verdict": sc.get("verdict"), "moved_pt": sc.get("moved_pt")}
                      if isinstance(sc, dict) else None),
        }

    n_frames = (SESSION_END - SESSION_START) // 15
    frames = []
    standing = None
    for f in range(n_frames):
        start = SESSION_START + f * 15
        if f in calls_by_frame:
            standing = {**calls_by_frame[f], "fresh": True}
        elif standing:
            standing = {**standing, "fresh": False}
        b = buckets.get(f)
        ts = trades_by_frame.get(f, [])
        pnl = sum(t["realized"] for t in ts if t.get("realized") is not None)
        if b is None and not ts and (standing is None or not standing.get("fresh")):
            continue                       # empty future frame — nothing to say
        frames.append({
            "t": f"{start // 60:02d}:{start % 60:02d}",
            "start_min": start,
            "call": standing,
            "market": (None if b is None else {
                "tone": b["tone"], "ret_pct": b["ret_pct"], "close": b["close"],
                "session_tone": b["session_tone"],
                "session_ret_pct": b["session_ret_pct"]}),
            "trades": ts,
            "frame_pnl": round(pnl, 2) if ts else None,
        })
    frames.reverse()                       # newest first — the ledger reads down
    return {"day": day, "symbol": symbol.upper(), "frames": frames,
            "gap_pct": tone.get("gap_pct"), "alignment": tone.get("alignment"),
            "verdict": tone.get("verdict"), "commentary": tone.get("commentary"),
            "day_pnl": tone.get("day_pnl"), "streak": tone.get("streak"),
            "buckets": tone.get("buckets"), "trades": tone.get("trades")}


def _demo() -> None:
    assert _frame_of(570) == 0 and _frame_of(584) == 0 and _frame_of(585) == 1
    assert _frame_of(959) == 25 and _frame_of(960) is None and _frame_of(500) is None
    print("cockpit_frames._demo OK")


if __name__ == "__main__":
    _demo()
