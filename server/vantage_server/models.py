"""Frozen dataclasses — the vocabulary shared by store, engine, and both surfaces.

These mirror the shapes of src/data.js (Account, Lot, RecentBuy, AutoBuy,
market quote) plus the derived shapes src/util.jsx computes (Position,
WashStatus, TlhCandidate, Allocation). Everything is immutable; the engine
only ever derives new values from them.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from typing import Any


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    short: str
    type: str
    taxable: bool
    last_sync: str


@dataclass(frozen=True)
class Lot:
    account: str
    symbol: str
    date: str  # ISO yyyy-mm-dd purchase date
    shares: float
    cost_per_share: float


@dataclass(frozen=True)
class Quote:
    symbol: str
    name: str
    price: float
    day_pct: float
    asset_class: str  # usEquity | intlEquity | bonds | cash


@dataclass(frozen=True)
class RecentBuy:
    account: str
    symbol: str
    date: str  # ISO yyyy-mm-dd
    note: str


@dataclass(frozen=True)
class AutoBuy:
    account: str
    symbol: str
    day_of_month: int | None = None
    amount: float | None = None
    cadence: str | None = None


@dataclass(frozen=True)
class QuoteSnapshot:
    """Quotes plus provenance: where they came from and how fresh they are."""
    quotes: dict[str, Quote]
    as_of: str            # ISO datetime the prices are 'as of'
    source: str           # "fixture" | "yfinance"
    stale: bool = False   # True when a live provider degraded to fixture data


@dataclass(frozen=True)
class Overlap:
    label: str
    symbols: tuple[str, ...]  # group members actually held somewhere


@dataclass(frozen=True)
class Position:
    symbol: str
    shares: float
    value: float
    cost: float
    unrealized: float
    day_pl: float
    weight: float                 # % of the selected scope's total value
    accounts: tuple[str, ...]     # account ids contributing lots
    lots: tuple[Lot, ...]
    overlap: Overlap | None


@dataclass(frozen=True)
class WashStatus:
    symbol: str
    blocked: bool
    reason: str | None = None
    clears_on: str | None = None       # display form, e.g. "Aug 1" (util.jsx parity)
    clears_on_date: str | None = None  # ISO yyyy-mm-dd, machine-friendly
    future_risk: AutoBuy | None = None


@dataclass(frozen=True)
class TlhCandidate:
    lot: Lot
    account: Account
    unrealized: float
    loss_pct: float
    status: str  # "na" (non-taxable) | "below" (under threshold) | "blocked" | "clear"
    wash: WashStatus | None = None
    replacement: str | None = None


@dataclass(frozen=True)
class Allocation:
    by_class: dict[str, float]  # asset class -> market value
    total: float


def to_jsonable(obj: Any) -> Any:
    """Recursively convert models (and containers of them) to JSON-safe values."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return to_jsonable(asdict(obj))
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj
