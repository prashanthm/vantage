"""Fixtures for the vantage-mcp tool-surface tests: the shared fixture dataset."""

from __future__ import annotations

from pathlib import Path

import pytest

# The deterministic dataset lives with the engine project (single source of truth).
DATA_DIR = Path(__file__).resolve().parents[2] / "server" / "data"


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA_DIR
