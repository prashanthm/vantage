"""Fixtures for the vantage-mcp tool-surface tests: synthetic test inputs.

Not a product dataset — the engine project's test fixtures, reused here as the
single source of synthetic inputs for the MCP tool surface.
"""

from __future__ import annotations

from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parents[2] / "server" / "tests" / "fixtures"


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA_DIR
