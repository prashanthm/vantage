"""The trade-analysis (ML) layer.

Turns raw broker orders + realized-P/L history into LABELED closed round-trips
with win/loss and excursion (MFE/MAE) metrics — the foundation the later
feature/bucket/lessons layers build on. ``roundtrips`` is the pure engine
(no I/O); ``build_roundtrips`` is the operator-run fetch/persist CLI outside
the read-only service surface (ADR-010).
"""
from __future__ import annotations

from .roundtrips import RoundTrip, reconstruct, summarize

__all__ = ["RoundTrip", "reconstruct", "summarize"]
