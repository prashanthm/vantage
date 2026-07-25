"""Claude-powered forecast analyst — the Mira replacement for "what will price do?".

Mira answered the forecast prompt by resolving a bare ``SPX_SNAPSHOT_REF`` via
the vantage MCP tools and narrating with a local Ollama model. This module
replaces that hop for forecasts: the backend builds ONE enriched prompt with the
deterministic snapshot inlined (no tool round-trips needed) and streams a Claude
response from the Anthropic API.

Contract with the rest of the system (unchanged from the Mira path):
  * the reply must contain one JSON object in the {headline, sections[]} shape
    mira-render.jsx parses, PLUS a top-level "plot" object
    {bias, target, invalidation, confidence, path[{seq, price, note}]} — the
    prose-free source the chart overlays and score_forecast() grades;
  * the SSE frames match Mira's /turn wire shape (event: token/done/error with
    a JSON data payload), so the SPA's existing stream consumer works as-is.

The ``anthropic`` SDK is an optional dependency (``pip install
'vantage-server[claude]'``); ANTHROPIC_API_KEY must be set in the server's
environment — the key never reaches the browser. VANTAGE_CLAUDE_MODEL overrides
the model (default: claude-opus-5).
"""
from __future__ import annotations

import json
import os

#: default model for the forecast analyst; override with VANTAGE_CLAUDE_MODEL.
DEFAULT_MODEL = "claude-opus-5"

#: cap on the 5m candle tail inlined into the prompt — the full multi-day series
#: is chart fodder, not analyst fodder, and would bloat every request.
_BARS_TAIL = 48


def model_name() -> str:
    return os.environ.get("VANTAGE_CLAUDE_MODEL") or DEFAULT_MODEL


def available() -> tuple[bool, str]:
    """(usable, note). Checks the SDK import and the API key — both server-side
    concerns, so the SPA can fall back to Mira when either is missing."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False, "ANTHROPIC_API_KEY is not set on the server"
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False, "anthropic SDK not installed (pip install 'vantage-server[claude]')"
    return True, ""


def _slim_snapshot(snapshot: dict) -> dict:
    """The snapshot minus prompt bloat: keep the deterministic facts the
    DISCIPLINE rules cite, trim the 5m candle series to a recent tail."""
    slim = {k: v for k, v in (snapshot or {}).items() if k != "bars_5m"}
    bars = (snapshot or {}).get("bars_5m")
    if isinstance(bars, list) and bars:
        slim["bars_5m_tail"] = bars[-_BARS_TAIL:]
        slim["bars_5m_note"] = (
            f"last {min(len(bars), _BARS_TAIL)} of {len(bars)} 5-minute candles "
            "(older history omitted)")
    return slim


def build_prompt(symbol: str, snapshot: dict) -> str:
    """The ENRICHED forecast prompt: the SPA's hardened DISCIPLINE rules
    (2026-07-21 post-mortem) + an explicit machine-readable output contract +
    the full snapshot inlined as JSON. Unlike Mira, Claude has no MCP access
    here, so the snapshot travels in the prompt — which also guarantees the
    forecast is generated from exactly the snapshot that gets persisted."""
    sym = (symbol or "SPX").upper()
    snap = _slim_snapshot(snapshot)
    return (
        f"You are the forecast analyst for an intraday {sym} trading desk. "
        f"What will {sym} price do from here? Reason over the snapshot below and "
        "give a structured, scoreable forecast (bias, expected path, level "
        "targets, invalidation, confidence).\n"
        "DISCIPLINE (hard rules):\n"
        "1. CITE the snapshot's regime + technicals VERBATIM (vs_vwap_pt, rsi, "
        "draw.dir). Never restate a relationship the numbers contradict.\n"
        "2. If ict_htf.present is false, there IS NO hourly setup — you must "
        "not claim one or use its levels; say it was suppressed and why.\n"
        "3. SANITY CHECK before answering: a down bias requires invalidation "
        "ABOVE current price; an up bias requires it BELOW. If your setup is "
        "already beyond its invalidation at current price, output bias "
        "\"neutral\" and say \"stand down — no valid setup\". Standing down is "
        "a first-class forecast.\n"
        "4. Negative gamma amplifies BOTH directions — below-the-flip on a "
        "risk-on tape means faster moves UP toward the flip, not a short "
        "signal.\n"
        "OUTPUT CONTRACT (machine-parsed — follow exactly):\n"
        "Reply with ONE JSON object and nothing else (no prose before or "
        "after, no markdown fences), in this shape:\n"
        "{\n"
        '  "headline": "one-line takeaway",\n'
        '  "plot": {\n'
        '    "bias": "up" | "down" | "neutral",\n'
        '    "target": <number — the price objective (null when neutral)>,\n'
        '    "invalidation": <number — where the call is wrong (null when neutral)>,\n'
        '    "confidence": <integer 0-100>,\n'
        '    "path": [{"seq": 1, "price": <number>, "note": "short step note"}, ...]\n'
        "  },\n"
        '  "sections": [\n'
        '    {"kind": "prose", "title": "The read", "text": "the reasoning, citing snapshot numbers"},\n'
        '    {"kind": "keyvals", "title": "The call", "rows": [{"k": "bias", "v": "..."},\n'
        '      {"k": "target", "v": "..."}, {"k": "invalidation", "v": "..."},\n'
        '      {"k": "confidence", "v": "..."}]},\n'
        '    {"kind": "callout", "title": "Wrong if", "text": "the invalidation condition", "tone": "warn"}\n'
        "  ]\n"
        "}\n"
        "plot.path is the expected price sequence from now (2-5 steps, "
        "chronological). Numbers in plot must be bare numbers, not strings.\n\n"
        f"SNAPSHOT (deterministic facts — these outrank any narrative prior):\n"
        f"{json.dumps(snap, sort_keys=True, default=str)}"
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def stream_forecast_sse(symbol: str, snapshot: dict):
    """Generator of SSE frames (Mira /turn wire shape): token frames carrying
    text deltas, then exactly one terminal done/error frame. Streams the
    Anthropic Messages API so long generations never hit request timeouts."""
    ok, note = available()
    if not ok:
        yield _sse("error", {"code": "unavailable", "message": note})
        return
    prompt = build_prompt(symbol, snapshot)
    try:
        import anthropic
        client = anthropic.Anthropic()
        with client.messages.stream(
            model=model_name(),
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                if text:
                    yield _sse("token", {"text": text})
        yield _sse("done", {"model": model_name()})
    except Exception as e:  # noqa: BLE001 — surface as a terminal SSE frame
        yield _sse("error", {"code": "claude_error", "message": str(e)})
