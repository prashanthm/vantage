"""The SENTIMENT GATE — prove a scorer before you trust it.

Sentiment is an ESTIMATED feature; an inaccurate scorer is worse than none. This
module scores a set of hand-labeled headline->sentiment pairs (the golden set)
with a candidate scorer and reports its class accuracy. The build only folds
sentiment into the trusted bucket layer when the scorer clears a minimum
accuracy bar here — encoding "gate must pass before trust" as executable design.

The LexiconScorer's pass is asserted in CI (deterministic). The OllamaScorer
must clear the SAME bar, but CI is not gated on a live Ollama — the operator
runs it live (see the report) so a flaky local model never breaks the build.
"""
from __future__ import annotations

import json
from pathlib import Path

from .sentiment import score_to_band

#: Minimum class accuracy a scorer must reach on the golden set to be trusted.
GATE_MIN_ACCURACY = 0.6

_CLASSES = ("negative", "neutral", "positive")


def load_golden(path: str | Path) -> list[dict]:
    """Load the golden set from a JSONL file of {headline, label} rows.

    Rows missing a headline or a valid label (negative|neutral|positive) are
    skipped. Returns a list of {headline, label}."""
    out: list[dict] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        headline = str(row.get("headline") or "").strip()
        label = str(row.get("label") or "").strip().lower()
        if headline and label in _CLASSES:
            out.append({"headline": headline, "label": label})
    return out


def evaluate_scorer(scorer, golden: list[dict]) -> dict:
    """Score every golden headline and report accuracy vs the hand labels.

    Each headline is scored, banded (score_to_band -> negative|neutral|positive),
    and compared to its label. Returns::

        {accuracy, n, correct, method, passed, min_accuracy,
         by_class: {cls: {n, correct, accuracy}},
         confusion: {actual: {predicted: count}}}

    ``passed`` is accuracy >= GATE_MIN_ACCURACY. With an empty golden set,
    accuracy is 0.0 and passed is False (nothing proven -> not trusted)."""
    n = len(golden)
    confusion = {a: {p: 0 for p in _CLASSES} for a in _CLASSES}
    by_class = {c: {"n": 0, "correct": 0} for c in _CLASSES}
    correct = 0

    for row in golden:
        actual = row["label"]
        predicted = score_to_band(scorer.score(row["headline"]))
        confusion[actual][predicted] += 1
        by_class[actual]["n"] += 1
        if predicted == actual:
            correct += 1
            by_class[actual]["correct"] += 1

    accuracy = round(correct / n, 6) if n else 0.0
    for c in _CLASSES:
        bc = by_class[c]
        bc["accuracy"] = round(bc["correct"] / bc["n"], 6) if bc["n"] else None

    return {
        "accuracy": accuracy,
        "n": n,
        "correct": correct,
        "method": getattr(scorer, "method", "unknown"),
        "min_accuracy": GATE_MIN_ACCURACY,
        "passed": bool(n) and accuracy >= GATE_MIN_ACCURACY,
        "by_class": by_class,
        "confusion": confusion,
    }
