"""The trade-analysis (ML) layer.

Turns raw broker orders + realized-P/L history into LABELED closed round-trips
with win/loss and excursion (MFE/MAE) metrics — the foundation the later
feature/bucket/lessons layers build on. ``roundtrips`` is the pure engine
(no I/O); ``build_roundtrips`` is the operator-run fetch/persist CLI outside
the read-only service surface (ADR-010).
"""
from __future__ import annotations

from .buckets import beta_binomial, condition_buckets, notable_buckets
from .events import earnings_within
from .features import entry_features, features_for_all
from .roundtrips import RoundTrip, reconstruct, summarize
from .sentiment import (
    LexiconScorer, OllamaScorer, FixtureHeadlineSource, score_headlines,
)
from .sentiment_eval import evaluate_scorer, load_golden

__all__ = [
    "RoundTrip", "reconstruct", "summarize",
    "entry_features", "features_for_all",
    "beta_binomial", "condition_buckets", "notable_buckets",
    "earnings_within",
    "LexiconScorer", "OllamaScorer", "FixtureHeadlineSource", "score_headlines",
    "evaluate_scorer", "load_golden",
]
