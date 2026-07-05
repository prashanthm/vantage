"""Shared fixtures: the deterministic fixture dataset (mirrors src/data.js)."""
from __future__ import annotations

from pathlib import Path

import pytest

from vantage_server import engine
from vantage_server.quotes import FixtureQuoteProvider
from vantage_server.store import Store

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA_DIR


@pytest.fixture(scope="session")
def dataset():
    return Store(DATA_DIR).load_dataset()


@pytest.fixture(scope="session")
def snapshot():
    return FixtureQuoteProvider(DATA_DIR).snapshot()


@pytest.fixture(scope="session")
def quotes(snapshot):
    return snapshot.quotes


@pytest.fixture(scope="session")
def today(snapshot):
    # The fixture marker: frozen 2026-07-05T09:30:00-04:00, same as data.js TODAY.
    return engine.parse_as_of(snapshot.as_of)
