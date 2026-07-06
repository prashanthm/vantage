"""Headline sentiment — the OPTIONAL, eval-gated event feature.

Sentiment is NEVER trusted by default. Everything this module emits is flagged
``estimated=true`` with a ``method`` ("lexicon" | "ollama"), and the build only
folds it into buckets when the scorer has cleared its accuracy gate
(sentiment_eval.evaluate_scorer). It has NO hard dependency: the LexiconScorer is
pure stdlib and always available; the OllamaScorer is used only when a local
Ollama is up; headline sources degrade to a canned FIXTURE offline.

Design contract (the "gate before trust" doctrine):
  1. A ``Scorer`` maps a headline string -> a float in [-1, 1].
  2. ``score_headlines`` aggregates per-headline scores to one banded score.
  3. Before a scorer's output is trusted, sentiment_eval.evaluate_scorer must
     clear a minimum accuracy bar on the golden set. build_features enforces
     this — an ungated scorer's features never reach the bucket layer.
"""
from __future__ import annotations

import json
import re
import urllib.request
from typing import Protocol, runtime_checkable


# ============================================================ headline sources

@runtime_checkable
class HeadlineSource(Protocol):
    """Supplies recent headlines for a symbol as-of a date.

    ``headlines(symbol, as_of) -> [str]`` — plain title strings, most-recent
    first. Implementations must never raise for an unknown symbol; they return
    [] (no headlines != an error)."""

    def headlines(self, symbol: str, as_of: str) -> list[str]:
        ...


class FixtureHeadlineSource:
    """A deterministic, offline headline source backed by a canned dict.

    Constructed with ``{SYMBOL: [headlines]}`` (case-insensitive symbol keys).
    Used by tests and as the always-available fallback when no real source is
    reachable. ``as_of`` is accepted for protocol conformance but ignored — the
    fixtures are date-agnostic."""

    def __init__(self, by_symbol: dict[str, list[str]] | None = None):
        self._by_symbol = {
            str(k).upper(): list(v) for k, v in (by_symbol or {}).items()
        }

    def headlines(self, symbol: str, as_of: str = "") -> list[str]:
        return list(self._by_symbol.get(str(symbol).upper(), []))


class YahooRSSHeadlineSource:
    """A ZERO-CREDENTIAL real headline source over Yahoo Finance's public RSS.

    Fetches https://feeds.finance.yahoo.com/rss/2.0/headline?s=<SYM> with stdlib
    urllib and extracts <title> tags — no API key, no third-party package. It is
    NEVER a hard dependency: any network/parse failure degrades to [] so the
    build never blocks on it. ``as_of`` is accepted but the feed only exposes
    current headlines (documented limitation: this source is point-in-time, so
    it's for a live/manual pull, not historical backfill)."""

    _URL = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US"
    _TITLE_RE = re.compile(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", re.DOTALL)

    def __init__(self, *, timeout: float = 6.0, max_headlines: int = 20):
        self._timeout = timeout
        self._max = max_headlines

    def headlines(self, symbol: str, as_of: str = "") -> list[str]:
        url = self._URL.format(sym=str(symbol).upper())
        req = urllib.request.Request(url, headers={"User-Agent": "vantage/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
        except Exception:  # network/DNS/timeout — degrade to no headlines
            return []
        titles = [t.strip() for t in self._TITLE_RE.findall(body)]
        # the first <title> is the channel title ("Yahoo Finance - AAPL ..."),
        # not a news item — drop it.
        items = titles[1:] if titles else []
        return [t for t in items if t][: self._max]


# ============================================================ scorers

@runtime_checkable
class Scorer(Protocol):
    """Maps ONE headline to a sentiment score in [-1, 1] (deterministic).

    ``method`` names the mechanism ("lexicon" | "ollama") and is propagated onto
    every scored output so consumers know how the estimate was produced."""

    method: str

    def score(self, headline: str) -> float:
        ...


#: Tiny finance-flavored lexicons. Deliberately small + deterministic — this is
#: the always-available offline fallback and the gate's reference scorer, not a
#: production NLP model.
_POSITIVE = {
    "beat", "beats", "surge", "surges", "surged", "soar", "soars", "rally",
    "rallies", "jump", "jumps", "gain", "gains", "record", "profit", "profits",
    "upgrade", "upgraded", "outperform", "strong", "growth", "raises", "raised",
    "tops", "top", "bullish", "boost", "boosts", "rebound", "wins", "win",
    "approval", "approved", "breakthrough", "exceeds", "exceed", "higher",
    "climb", "climbs", "rises", "rise", "expansion", "milestone", "dividend",
    "buyback", "optimistic", "upbeat",
}
_NEGATIVE = {
    "miss", "misses", "missed", "plunge", "plunges", "plunged", "slump",
    "slumps", "crash", "crashes", "fall", "falls", "fell", "drop", "drops",
    "loss", "losses", "downgrade", "downgraded", "underperform", "weak",
    "cut", "cuts", "slashes", "slash", "warns", "warning", "bearish", "lawsuit",
    "probe", "investigation", "recall", "layoffs", "bankruptcy", "default",
    "decline", "declines", "sinks", "sink", "tumble", "tumbles", "slides",
    "slide", "fraud", "halts", "halt", "lower", "shortfall", "disappoints",
    "disappointing", "concerns", "fears", "sell-off", "selloff",
}

_WORD_RE = re.compile(r"[a-z][a-z'\-]*")


class LexiconScorer:
    """Deterministic finance word-list scorer — no LLM, always available.

    score = (pos - neg) / (pos + neg) over the lexicon-word hits in the
    lower-cased headline, clamped to [-1, 1]; a headline with no lexicon hits
    scores 0.0 (neutral). Pure, offline, and used both as the runtime fallback
    (when Ollama is down) and as the gate's reference scorer in CI."""

    method = "lexicon"

    def score(self, headline: str) -> float:
        words = _WORD_RE.findall(str(headline or "").lower())
        pos = sum(1 for w in words if w in _POSITIVE)
        neg = sum(1 for w in words if w in _NEGATIVE)
        if pos == 0 and neg == 0:
            return 0.0
        return max(-1.0, min(1.0, (pos - neg) / (pos + neg)))


class OllamaScorer:
    """Local-LLM scorer over Ollama's OpenAI-compatible chat API (no cloud).

    Prompts a local model (default qwen2.5) at temp=0 for a single sentiment
    number in [-1, 1]. Never a hard dependency: constructed lazily and only used
    when Ollama is reachable; any failure raises OllamaUnavailable so the caller
    falls back to the lexicon. ``method`` is "ollama".

    In tests this is STUBBED — no live call. The build runs it live only after it
    clears the same accuracy gate the lexicon does."""

    method = "ollama"

    _PROMPT = (
        "You are a financial-news sentiment classifier. Read the single news "
        "headline and reply with ONLY a JSON object {\"score\": x} where x is a "
        "number from -1 (very negative for the stock) to 1 (very positive), 0 "
        "for neutral. No prose.\n\nHeadline: {headline}"
    )

    def __init__(
        self, *, base_url: str = "http://localhost:11434", model: str = "qwen2.5",
        timeout: float = 30.0, _post=None,
    ):
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout
        # _post is injectable for tests: (url, payload) -> response dict
        self._post = _post or self._http_post

    def _http_post(self, url: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            raise OllamaUnavailable(str(e)) from e

    def score(self, headline: str) -> float:
        url = f"{self._base_url}/v1/chat/completions"
        payload = {
            "model": self._model,
            "temperature": 0,
            "messages": [
                {"role": "user",
                 "content": self._PROMPT.replace("{headline}", str(headline or ""))},
            ],
        }
        resp = self._post(url, payload)
        content = (
            resp.get("choices", [{}])[0].get("message", {}).get("content", "")
            if isinstance(resp, dict) else ""
        )
        return _extract_score(content)


class OllamaUnavailable(RuntimeError):
    """Ollama could not be reached / returned an unusable response."""


def _extract_score(text: str) -> float:
    """Parse a score in [-1, 1] out of a model reply, tolerantly.

    Prefers a JSON {"score": x}; falls back to the first signed decimal in the
    text. Clamps to [-1, 1]; returns 0.0 when nothing numeric is found (a
    non-answer is treated as neutral, never fabricated)."""
    text = str(text or "").strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "score" in obj:
            return max(-1.0, min(1.0, float(obj["score"])))
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if m:
        try:
            return max(-1.0, min(1.0, float(m.group())))
        except ValueError:
            return 0.0
    return 0.0


# ============================================================ aggregation

def score_to_band(score: float) -> str:
    """A signed score -> a categorical band: negative | neutral | positive.

    Neutral is |score| < 0.15 (a dead zone around 0 so noise near zero doesn't
    flap between pos/neg). Deterministic."""
    if score >= 0.15:
        return "positive"
    if score <= -0.15:
        return "negative"
    return "neutral"


def score_headlines(headlines, *, scorer) -> dict:
    """Aggregate a scorer over a list of headlines to one banded sentiment.

    Returns::

        {score, band, n_headlines, method, estimated, per_headline: [...]}

    ``score`` is the mean per-headline score (0.0 when there are no headlines),
    ``band`` its score_to_band, ``method`` the scorer's method, ``estimated`` is
    ALWAYS True (sentiment is never ground truth), and ``per_headline`` lists
    {headline, score} in input order. Deterministic given a deterministic
    scorer."""
    items = [str(h) for h in (headlines or []) if str(h).strip()]
    per = [{"headline": h, "score": round(scorer.score(h), 6)} for h in items]
    n = len(per)
    mean = round(sum(p["score"] for p in per) / n, 6) if n else 0.0
    return {
        "score": mean,
        "band": score_to_band(mean),
        "n_headlines": n,
        "method": getattr(scorer, "method", "unknown"),
        "estimated": True,
        "per_headline": per,
    }
