"""Journal Analysis — the compounding, periodic self-assessment of the desk.

This is the aggregate layer above per-trade reviews (trade_analysis). One run
covers a DATE WINDOW, is TAGGED daily|weekly|monthly, and produces:

  • SCORES against a VERSIONED rubric (0-100 per dimension) — comparable over
    time because the rubric_version travels with the scores.
  • A PATTERN census — how often each recurring mistake was flagged, with the
    trades that evidence it (citations).
  • RECOMMENDATIONS, each carried forward and marked improving / flat / worse
    by comparing this window's scores to the PRIOR analysis's.
  • A NARRATIVE — the model's prose synthesis (SWOT + read), produced by Mira's
    journal_analyst from the deterministic bundle this module assembles.

KNOWLEDGE COMPOUNDS: each run reads the most recent PRIOR analysis (prior_id)
and feeds it back to the model, so today's read stands on yesterday's. The
deterministic scores/patterns here are computed in Python (auditable, exact);
only the prose judgment is the model's.

Pure computation over the store — no broker I/O, no orders (ADR-010).
"""
from __future__ import annotations

import datetime as _dt
import logging
import re

log = logging.getLogger(__name__)

# ── the scoring rubric ──────────────────────────────────────────────────────
# Versioned so scores stay comparable as the rubric evolves. Each dimension is
# scored 0-100. The `flags` are the pattern regexes (against the per-trade
# analysis text) that DOCK the dimension — more flags → lower score. `praises`
# lift it. This is deliberately simple and auditable; the model narrates, the
# rubric scores.
RUBRIC_VERSION = 1

RUBRIC = {
    "entry_discipline": {
        "label": "Entry discipline",
        "about": "Waited for the tag / entered at the level vs front-ran it.",
        "flags": r"front-run|approaching|below it|points (?:below|above)|extension|did.?n.?t (?:wait|tag)|above vwap",
        "weight": 1.4,      # the #1 leak — weighted heaviest
    },
    "exit_discipline": {
        "label": "Exit discipline",
        "about": "Sold at plan/level vs on emotion or a spike.",
        "flags": r"spike low|emotional|comfort zone|gave.*back|did not exit|bar-to-bar|noise",
        "praises": r"good exit|sold.*spike|clean exit|took.*profit|nailed",
        "weight": 1.0,
    },
    "risk_sizing": {
        "label": "Risk & sizing",
        "about": "No adding to losers; sane size; defined max loss on lottos.",
        "flags": r"averag(?:e|ing) down|add(?:ed|ing).*(?:loser|losing|against)|decaying|sized too|mechanical stop|too much|oversized",
        "weight": 1.2,
    },
    "plan_adherence": {
        "label": "Plan adherence",
        "about": "Traded tonight's forecast levels + correct side, not remembered/wrong-side ones.",
        "flags": r"wrong side|falling knife|below resistance|correct side|remembered level|prior session|claim(?:ed)? (?:a |an )?(?:level|entry)|did not trade",
        "weight": 1.2,
    },
    "emotional_control": {
        "label": "Emotional control",
        "about": "Discipline held under pressure — no revenge, no bad-day spiral.",
        "flags": r"revenge|chas(?:e|ing)|tilt|spiral|frustrat|forced",
        "weight": 1.0,
    },
}


def _score_dimension(spec: dict, texts: list[str], n_trades: int) -> int:
    """0-100 for one rubric dimension. Start at 100, dock per flag hit, credit
    per praise, scaled by how many trades there were (a flag in 1 of 12 trades
    hurts less than 1 of 2). Bounded [0, 100]."""
    if not texts:
        return 0
    joined = " ".join(texts)
    flags = len(re.findall(spec["flags"], joined, re.I))
    praises = len(re.findall(spec["praises"], joined, re.I)) if spec.get("praises") else 0
    # penalty per flag ~ proportion of trades that could have raised it, capped
    per = 100.0 / max(n_trades, 1)
    score = 100.0 - flags * per * 0.9 + praises * per * 0.5
    return int(max(0.0, min(100.0, round(score))))


# ── pattern census ──────────────────────────────────────────────────────────
_PATTERNS = [
    ("Entered before / away from the level",
     r"front-run|approaching|below it|points (?:below|above)|extension|did.?n.?t (?:wait|tag)|above vwap"),
    ("Wrong side of the level",
     r"wrong side|falling knife|below resistance|correct side|above.*wall"),
    ("Exited on emotion / a spike, not at plan",
     r"spike low|emotional|comfort zone|gave.*back|bar-to-bar|noise"),
    ("Added to a loser / averaged down",
     r"averag(?:e|ing) down|add(?:ed|ing).*(?:loser|losing|against)|decaying|mechanical stop"),
    ("Claimed a level not actually traded",
     r"claim(?:ed)? (?:a |an )?(?:level|entry)|did not trade"),
]


def _census(rows: list[dict]) -> list[dict]:
    """Per-pattern: total flag count across all reads + the trades (labels) that
    hit it — the citations. Sorted most-flagged first."""
    out = []
    for name, rx in _PATTERNS:
        count = 0
        cites: list[str] = []
        for r in rows:
            hits = len(re.findall(rx, (r.get("analysis") or "").lower()))
            if hits:
                count += hits
                cites.append(r.get("label") or "?")
        if count:
            out.append({"pattern": name, "count": count, "cites": cites})
    out.sort(key=lambda p: -p["count"])
    return out


# ── recommendation tracking ─────────────────────────────────────────────────
# Each dimension carries a standing recommendation; its STATUS comes from the
# score delta vs the prior analysis. This is how "is the advice working?" shows.
_RECS = {
    "entry_discipline": "Wait for the tag — set the alert at your level and let price come to you.",
    "exit_discipline":  "Exit at your plan level, not your emotional comfort zone.",
    "risk_sizing":      "One fill is the thesis — don't add to a loser; define max loss up front.",
    "plan_adherence":   "Trade tonight's forecast levels on the correct side, not remembered ones.",
    "emotional_control":"Name the bad-day trigger; stop trading when discipline slips.",
}


def _recommendations(scores: dict, prior_scores: dict | None) -> list[dict]:
    """One rec per dimension, statused by the score move vs the prior run:
    improving / flat / worse / new. Ordered worst-score first (what to fix)."""
    recs = []
    for dim, text in _RECS.items():
        now = scores.get(dim)
        if now is None:
            continue
        prev = (prior_scores or {}).get(dim)
        if prev is None:
            status, delta = "new", None
        else:
            delta = now - prev
            status = "improving" if delta >= 4 else "worse" if delta <= -4 else "flat"
        recs.append({"dimension": dim, "label": RUBRIC[dim]["label"],
                     "text": text, "status": status, "delta": delta,
                     "score": now, "prior_score": prev})
    recs.sort(key=lambda r: r["score"])
    return recs


# ── the window build ────────────────────────────────────────────────────────

def _days_in(window_from: str, window_to: str) -> list[str]:
    a = _dt.date.fromisoformat(window_from)
    b = _dt.date.fromisoformat(window_to)
    return [(a + _dt.timedelta(d)).isoformat() for d in range((b - a).days + 1)]


def gather(store, window_from: str, window_to: str, underlying: str = "SPX") -> dict:
    """Assemble the deterministic bundle for one window: the per-trade analyses,
    the scores, the pattern census, the P&L, and the PRIOR analysis (for
    compounding + recommendation status). No model here — this is the input the
    Mira journal_analyst narrates."""
    from . import session_activity as _sa

    und = (underlying or "SPX").upper()
    days = set(_days_in(window_from, window_to))

    # per-trade analyses recorded in the window (the raw judgment material)
    rows = [r for r in store.load_trade_analyses()
            if str(r.get("day")) in days and str(r.get("underlying", und)).upper() == und]

    # realized P&L + trade count over the window (exact, from fills)
    net = 0.0
    n_trades = 0
    per_day = []
    for d in sorted(days):
        try:
            sess = _sa.session(store, d, und)
        except Exception:  # noqa: BLE001
            continue
        closed = [t for t in sess.get("trades", []) if t.get("realized") is not None]
        if not closed and not sess.get("trades"):
            continue
        day_net = round(sum(t["realized"] for t in closed), 2)
        s = sess.get("summary", {})
        net += day_net
        n_trades += len(sess.get("trades", []))
        per_day.append({
            "day": d, "net": day_net, "trades": len(sess.get("trades", [])),
            "entered_at_level": s.get("level_discipline"),
            "exited_at_level": s.get("exit_discipline"),
            "winners": s.get("winners"), "losers": s.get("losers"),
        })

    texts = [r.get("analysis") or "" for r in rows]
    scores = {dim: _score_dimension(spec, texts, len(rows))
              for dim, spec in RUBRIC.items()}

    prior = store.load_latest_journal_analysis(window_from, und)
    prior_scores = (prior or {}).get("scores")

    return {
        "window_from": window_from, "window_to": window_to, "underlying": und,
        "rubric_version": RUBRIC_VERSION,
        "trades": n_trades, "analyzed": len(rows), "net_pnl": round(net, 2),
        "scores": scores,
        "rubric": {dim: {"label": s["label"], "about": s["about"]} for dim, s in RUBRIC.items()},
        "patterns": _census(rows),
        "recommendations": _recommendations(scores, prior_scores),
        "per_day": per_day,
        "trade_reads": [{"day": r["day"], "label": r.get("label"),
                         "analysis": (r.get("analysis") or "")[:1200]} for r in rows],
        "prior": ({"window_to": prior.get("window_to"), "scores": prior_scores,
                   "narrative": (prior.get("narrative") or "")[:800]} if prior else None),
    }


# The JSON contract the journal_analyst must return. The UI renders this into
# the SWOT grid + do-next cards; the deterministic parts (scores, pattern
# counts, per-day P&L) are NOT asked of the model — Vantage already has them
# exact. The model fills only the JUDGMENT prose. A response that fails to
# match this shape degrades to a prose render (never a broken card), so the
# schema is a target, not a hard gate.
OUTPUT_SCHEMA = {
    "headline": "one punchy sentence — the thesis of the window",
    "swot": {
        "strengths": [{"point": "what's working", "cites": ["trade label + $"]}],
        "weaknesses": [{"point": "a chronic mistake", "cites": ["trade label + $"]}],
        "opportunities": [{"point": "a fixable edge"}],
        "threats": [{"point": "what blows up the account if unaddressed"}],
    },
    "pattern": "the single root habit behind the weaknesses, one sentence",
    "scores_read": "one sentence on the scores; if a prior exists, the direction + whether the advice is working",
    "do_next": [{"title": "a short imperative", "detail": "the concrete mechanical change"}],
}


def build_prompt(bundle: dict) -> str:
    """The DeepSeek prompt: turn the deterministic bundle into a STRUCTURED
    JSON analysis (OUTPUT_SCHEMA) the UI renders as a SWOT grid. Versioned with
    the scorer that feeds it; the Mira journal_analyst uses it verbatim."""
    import json
    b = bundle
    prior = b.get("prior")
    prior_line = (
        f"\nPRIOR ANALYSIS (through {prior['window_to']}): scores {json.dumps(prior['scores'])}. "
        f"BUILD ON IT — in `scores_read`, say what changed and whether the advice is working.\n"
        if prior else "\nNo prior analysis — this is the baseline.\n")

    return (
        "You are a demanding trading-desk coach producing a JOURNAL ANALYSIS — an aggregate self-assessment "
        f"of an SPX 0DTE operator over {b['window_from']} to {b['window_to']} ({b['trades']} trades, "
        f"{b['analyzed']} with recorded reviews, net ${b['net_pnl']}). Use ONLY the data below.\n"
        f"{prior_line}"
        f"\nRUBRIC SCORES (already computed — do NOT restate the numbers, read them): "
        f"{json.dumps(b['scores'])}. Dimensions: {json.dumps(b['rubric'])}.\n"
        f"\nPATTERN CENSUS (mistake -> flag count + the trades that evidence it): {json.dumps(b['patterns'])}.\n"
        f"\nPER-DAY DISCIPLINE: {json.dumps(b['per_day'])}.\n"
        f"\nPer-trade review excerpts: "
        f"{json.dumps([{'d': t['day'], 'trade': t['label'], 'read': t['analysis'][:400]} for t in b['trade_reads']])}\n"
        "\nRESPOND WITH ONLY A SINGLE JSON OBJECT — no markdown, no prose before or after — matching this shape "
        "EXACTLY (same keys):\n"
        f"{json.dumps(OUTPUT_SCHEMA, indent=1)}\n"
        "Rules: `swot` MUST have exactly the keys strengths/weaknesses/opportunities/threats, each an array of "
        "objects with a `point` string (strengths & weaknesses also take a `cites` array of trade labels + $ "
        "amounts drawn from the data above — never invent a trade). `do_next` is 3-4 items, most impactful "
        "first. Be specific and direct; cite the real numbers. Educational only — not financial advice. "
        "Output the JSON and nothing else."
    )
