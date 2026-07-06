"""Headline-sentiment tests — the eval-gated, always-flagged-estimated feature.

Fully offline and deterministic: the LexiconScorer needs no LLM, and the
OllamaScorer is STUBBED (its HTTP post is injected — no live call in CI). Covers
lexicon determinism, the golden-set accuracy GATE (the "prove before trust"
doctrine), score_headlines aggregation, and the estimated/method flags."""
from __future__ import annotations

from pathlib import Path

import pytest

from vantage_server.ml import sentiment as st
from vantage_server.ml import sentiment_eval as se


def _golden_path() -> Path:
    return Path(__file__).parent / "fixtures" / "sentiment_golden.jsonl"


# ------------------------------------------------------------- lexicon

def test_lexicon_scorer_is_deterministic_and_signed():
    lex = st.LexiconScorer()
    pos = lex.score("Apple beats estimates, shares surge to record high")
    neg = lex.score("Boeing plunges on probe, shares slump and fall")
    neu = lex.score("Company announces annual shareholder meeting date")
    assert pos > 0 and neg < 0 and neu == 0.0
    # deterministic: same input -> same output
    assert lex.score("stock rallies and gains") == lex.score("stock rallies and gains")
    assert -1.0 <= pos <= 1.0 and -1.0 <= neg <= 1.0


def test_lexicon_method_flag():
    assert st.LexiconScorer().method == "lexicon"


# ------------------------------------------------------------- THE GATE

def test_golden_set_loads_and_has_all_three_classes():
    golden = se.load_golden(_golden_path())
    assert len(golden) >= 20
    labels = {g["label"] for g in golden}
    assert labels == {"negative", "neutral", "positive"}


def test_lexicon_clears_the_accuracy_gate():
    """The load-bearing gate: the deterministic scorer MUST clear the min bar,
    otherwise its features are never trusted by the build."""
    golden = se.load_golden(_golden_path())
    ev = se.evaluate_scorer(st.LexiconScorer(), golden)
    assert ev["accuracy"] >= se.GATE_MIN_ACCURACY
    assert ev["passed"] is True
    assert ev["n"] == len(golden)
    # by_class + confusion are populated for inspection
    assert set(ev["by_class"]) == {"negative", "neutral", "positive"}
    assert set(ev["confusion"]) == {"negative", "neutral", "positive"}


def test_gate_fails_for_a_bad_scorer():
    """A scorer that always says neutral cannot clear the gate (design: an
    inaccurate scorer is NOT trusted)."""
    class AlwaysNeutral:
        method = "always_neutral"
        def score(self, headline):  # noqa: ARG002
            return 0.0
    golden = se.load_golden(_golden_path())
    ev = se.evaluate_scorer(AlwaysNeutral(), golden)
    assert ev["passed"] is False  # only ~1/3 correct


def test_empty_golden_never_passes():
    ev = se.evaluate_scorer(st.LexiconScorer(), [])
    assert ev["passed"] is False and ev["accuracy"] == 0.0


# ------------------------------------------------------------- aggregation

def test_score_headlines_aggregates_and_bands():
    lex = st.LexiconScorer()
    out = st.score_headlines(
        ["shares surge and beat estimates", "stock rallies to record"],
        scorer=lex)
    assert out["n_headlines"] == 2
    assert out["band"] == "positive"
    assert out["score"] > 0
    assert len(out["per_headline"]) == 2
    assert out["per_headline"][0]["headline"] == "shares surge and beat estimates"


def test_score_headlines_empty_is_neutral_zero():
    out = st.score_headlines([], scorer=st.LexiconScorer())
    assert out["n_headlines"] == 0
    assert out["score"] == 0.0
    assert out["band"] == "neutral"


def test_score_headlines_always_flags_estimated_and_method():
    out = st.score_headlines(["stock plunges on loss"], scorer=st.LexiconScorer())
    assert out["estimated"] is True
    assert out["method"] == "lexicon"


def test_score_to_band_dead_zone():
    assert st.score_to_band(0.05) == "neutral"
    assert st.score_to_band(-0.05) == "neutral"
    assert st.score_to_band(0.5) == "positive"
    assert st.score_to_band(-0.5) == "negative"


# ------------------------------------------------------------- Ollama (STUBBED)

def test_ollama_scorer_is_stubbed_no_live_call():
    """OllamaScorer with an injected _post — NO network. Verifies it parses the
    OpenAI-compatible chat response and honors method="ollama"."""
    calls = []

    def fake_post(url, payload):
        calls.append((url, payload))
        return {"choices": [{"message": {"content": '{"score": 0.8}'}}]}

    scorer = st.OllamaScorer(_post=fake_post)
    assert scorer.method == "ollama"
    assert scorer.score("Nvidia beats and soars") == pytest.approx(0.8)
    assert calls and calls[0][0].endswith("/v1/chat/completions")
    assert calls[0][1]["temperature"] == 0  # deterministic


def test_ollama_scorer_tolerates_plain_number_reply():
    scorer = st.OllamaScorer(
        _post=lambda url, payload: {
            "choices": [{"message": {"content": "-0.6"}}]})
    assert scorer.score("shares slump on probe") == pytest.approx(-0.6)


def test_ollama_scorer_clamps_and_defaults_neutral():
    scorer = st.OllamaScorer(
        _post=lambda url, payload: {
            "choices": [{"message": {"content": "no number here"}}]})
    assert scorer.score("routine filing") == 0.0


def test_ollama_unavailable_raises_for_fallback():
    def boom(url, payload):
        raise st.OllamaUnavailable("connection refused")
    scorer = st.OllamaScorer(_post=boom)
    with pytest.raises(st.OllamaUnavailable):
        scorer.score("anything")


# ------------------------------------------------------------- fixture source

def test_fixture_headline_source_is_offline_and_case_insensitive():
    src = st.FixtureHeadlineSource({"AAPL": ["Apple beats estimates"]})
    assert src.headlines("aapl", "2026-07-05") == ["Apple beats estimates"]
    assert src.headlines("UNKNOWN", "2026-07-05") == []  # never raises
