"""JSON-file store — the only place portfolio data is read from disk.

Loads accounts / lots / recent_buys / auto_buys / partner_map (and, via
quotes.py, quotes) from a data directory: env VANTAGE_DATA_DIR, defaulting to
server/data (the fixture dataset that mirrors the SPA's src/data.js exactly).

Shapes are validated eagerly with explicit errors — a malformed file fails at
load time with the file and field named, never as a KeyError deep in the
engine.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Account, AutoBuy, Lot, RecentBuy

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
# Real (imported) data lives beside the fixtures, gitignored, and wins by
# default so demo fixtures and personal portfolios never share a directory —
# the fixture dataset is a test oracle (parity goldens) and must stay pristine.
LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "data-local"
ENV_DATA_DIR = "VANTAGE_DATA_DIR"


class StoreError(ValueError):
    """A data file is missing, unreadable, or shaped wrong."""


def resolve_data_dir(data_dir: str | os.PathLike[str] | None = None) -> Path:
    """Explicit arg > VANTAGE_DATA_DIR env > data-local (real data, when
    present) > packaged fixture directory."""
    if data_dir is not None:
        return Path(data_dir)
    env = os.environ.get(ENV_DATA_DIR)
    if env:
        return Path(env)
    if LOCAL_DATA_DIR.is_dir():
        return LOCAL_DATA_DIR
    return DEFAULT_DATA_DIR


@dataclass(frozen=True)
class Dataset:
    """Everything the engine needs except quotes (those come from a provider)."""
    accounts: tuple[Account, ...]
    lots: tuple[Lot, ...]
    recent_buys: tuple[RecentBuy, ...]
    auto_buys: tuple[AutoBuy, ...]
    partner_map: dict[str, str]


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise StoreError(f"{path}: file not found (set {ENV_DATA_DIR} or create it)")
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise StoreError(f"{path}: invalid JSON ({e})") from e


def _require(record: dict, key: str, kind: type | tuple[type, ...], where: str) -> Any:
    if key not in record:
        raise StoreError(f"{where}: missing required key '{key}' in {record!r}")
    value = record[key]
    if not isinstance(value, kind):
        raise StoreError(f"{where}: key '{key}' must be {kind}, got {type(value).__name__} in {record!r}")
    return value


def _require_list(data: Any, where: str) -> list:
    if not isinstance(data, list):
        raise StoreError(f"{where}: top level must be a JSON array, got {type(data).__name__}")
    return data


_NUM = (int, float)


class Store:
    """Reads and validates the portfolio dataset from a data directory."""

    def __init__(self, data_dir: str | os.PathLike[str] | None = None):
        self.data_dir = resolve_data_dir(data_dir)

    # -- individual files ---------------------------------------------------

    def load_accounts(self) -> tuple[Account, ...]:
        path = self.data_dir / "accounts.json"
        rows = _require_list(_read_json(path), str(path))
        return tuple(
            Account(
                id=_require(r, "id", str, str(path)),
                name=_require(r, "name", str, str(path)),
                short=_require(r, "short", str, str(path)),
                type=_require(r, "type", str, str(path)),
                taxable=_require(r, "taxable", bool, str(path)),
                last_sync=_require(r, "last_sync", str, str(path)),
            )
            for r in rows
        )

    def load_lots(self) -> tuple[Lot, ...]:
        path = self.data_dir / "lots.json"
        rows = _require_list(_read_json(path), str(path))
        lots = tuple(
            Lot(
                account=_require(r, "account", str, str(path)),
                symbol=_require(r, "symbol", str, str(path)),
                date=_require(r, "date", str, str(path)),
                shares=float(_require(r, "shares", _NUM, str(path))),
                cost_per_share=float(_require(r, "cost_per_share", _NUM, str(path))),
            )
            for r in rows
        )
        for lot in lots:
            if lot.shares <= 0:
                raise StoreError(f"{path}: lot {lot.symbol} {lot.date} has non-positive shares")
            if lot.cost_per_share < 0:
                raise StoreError(f"{path}: lot {lot.symbol} {lot.date} has negative cost_per_share")
        return lots

    def load_recent_buys(self) -> tuple[RecentBuy, ...]:
        path = self.data_dir / "recent_buys.json"
        rows = _require_list(_read_json(path), str(path))
        return tuple(
            RecentBuy(
                account=_require(r, "account", str, str(path)),
                symbol=_require(r, "symbol", str, str(path)),
                date=_require(r, "date", str, str(path)),
                note=_require(r, "note", str, str(path)),
            )
            for r in rows
        )

    def load_auto_buys(self) -> tuple[AutoBuy, ...]:
        path = self.data_dir / "auto_buys.json"
        rows = _require_list(_read_json(path), str(path))
        out = []
        for r in rows:
            day = r.get("day_of_month")
            if day is not None and not isinstance(day, int):
                raise StoreError(f"{path}: day_of_month must be an integer in {r!r}")
            amount = r.get("amount")
            if amount is not None and not isinstance(amount, _NUM):
                raise StoreError(f"{path}: amount must be a number in {r!r}")
            out.append(
                AutoBuy(
                    account=_require(r, "account", str, str(path)),
                    symbol=_require(r, "symbol", str, str(path)),
                    day_of_month=day,
                    amount=float(amount) if amount is not None else None,
                    cadence=r.get("cadence"),
                )
            )
        return tuple(out)

    def load_partner_map(self) -> dict[str, str]:
        path = self.data_dir / "partner_map.json"
        data = _read_json(path)
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in data.items()
        ):
            raise StoreError(f"{path}: must be a JSON object of symbol -> replacement symbol")
        return data

    def load_history(self) -> list[dict]:
        """Imported transaction history (<data_dir>/history.json — optional
        file written by the importer's --with-history). TOLERANT of a missing
        file: returns an empty list so the API/MCP surface an empty state
        instead of erroring (fixture datasets have no history). Rows are the
        importer's history contract dicts, returned newest first."""
        path = self.data_dir / "history.json"
        if not path.is_file():
            return []
        rows = _require_list(_read_json(path), str(path))
        out = [r for r in rows if isinstance(r, dict)]
        out.sort(key=lambda r: str(r.get("date") or ""), reverse=True)
        return out

    def load_strategies(self) -> dict:
        """Options strategy roll-up (<data_dir>/strategies.json — optional file
        written by the importer's --with-strategies). TOLERANT of a missing
        file: returns {"open": [], "closed": [], "by_ticker": [], "as_of": None}
        so the API/MCP surface an empty state instead of erroring (fixture
        datasets have none).

        The file is {open: [...], closed: [...], by_ticker: [...], as_of};
        malformed sections degrade to empty lists rather than raising — the
        roll-up is derived, advisory data, not a load-time invariant like lots.
        ``by_ticker`` is the per-underlying position book (all legs of a ticker
        combined regardless of expiry — netting a diagonal's short into one
        row); it defaults to [] for files written before it existed."""
        path = self.data_dir / "strategies.json"
        if not path.is_file():
            return {"open": [], "closed": [], "by_ticker": [], "as_of": None}
        data = _read_json(path)
        if not isinstance(data, dict):
            raise StoreError(f"{path}: top level must be a JSON object with "
                             "'open' and 'closed' keys")
        open_rows = data.get("open")
        closed_rows = data.get("closed")
        by_ticker_rows = data.get("by_ticker")
        return {
            "open": [r for r in open_rows if isinstance(r, dict)]
            if isinstance(open_rows, list) else [],
            "closed": [r for r in closed_rows if isinstance(r, dict)]
            if isinstance(closed_rows, list) else [],
            "by_ticker": [r for r in by_ticker_rows if isinstance(r, dict)]
            if isinstance(by_ticker_rows, list) else [],
            "as_of": data.get("as_of"),
        }

    def load_signals(self):
        """Authored trade signals (<data_dir>/signals.json — optional file).
        Returns tuple[Signal, ...]; statuses are computed, never stored."""
        from .signals import load_signals  # local import: signals.py imports store helpers

        return load_signals(self.data_dir)

    def load_roundtrips(self) -> dict:
        """Labeled closed round-trips (<data_dir>/ml/roundtrips.json — optional
        file written by vantage_server.ml.build_roundtrips). TOLERANT of a
        missing file: returns {"as_of": None, "roundtrips": [], "summary": {}}
        so the API/MCP surface an empty state instead of erroring (fixture
        datasets have none).

        File shape: {as_of, account, roundtrips: [...], summary: {...}}; a
        malformed file degrades to the empty state rather than raising — the
        round-trips are derived, advisory data, not a load-time invariant."""
        path = self.data_dir / "ml" / "roundtrips.json"
        if not path.is_file():
            return {"as_of": None, "roundtrips": [], "summary": {}}
        try:
            data = _read_json(path)
        except StoreError:
            return {"as_of": None, "roundtrips": [], "summary": {}}
        if not isinstance(data, dict):
            return {"as_of": None, "roundtrips": [], "summary": {}}
        rows = data.get("roundtrips")
        summary = data.get("summary")
        return {
            "as_of": data.get("as_of"),
            "roundtrips": [r for r in rows if isinstance(r, dict)]
            if isinstance(rows, list) else [],
            "summary": summary if isinstance(summary, dict) else {},
        }

    def load_trade_stats(self) -> dict:
        """Entry-condition features + Bayesian condition buckets (<data_dir>/ml/
        trade_stats.json — optional file written by
        vantage_server.ml.build_features). TOLERANT of a missing/malformed file:
        returns an empty state so the API/MCP surface it instead of erroring
        (fixture datasets have none).

        File shape: {as_of, account, baseline_win_rate, featured, buckets,
        notable, by_account: {<acct>: {baseline_win_rate, featured, buckets,
        notable}}}. Empty state:
        {as_of: None, baseline_win_rate: None, featured/buckets/notable: [],
        by_account: {}}."""
        empty = {
            "as_of": None,
            "baseline_win_rate": None,
            "featured": [],
            "buckets": [],
            "notable": [],
            "by_account": {},
        }
        path = self.data_dir / "ml" / "trade_stats.json"
        if not path.is_file():
            return empty
        try:
            data = _read_json(path)
        except StoreError:
            return empty
        if not isinstance(data, dict):
            return empty
        by_account = data.get("by_account")
        return {
            "as_of": data.get("as_of"),
            "baseline_win_rate": data.get("baseline_win_rate"),
            "featured": [r for r in (data.get("featured") or [])
                         if isinstance(r, dict)],
            "buckets": [r for r in (data.get("buckets") or [])
                        if isinstance(r, dict)],
            "notable": [r for r in (data.get("notable") or [])
                        if isinstance(r, dict)],
            "by_account": by_account if isinstance(by_account, dict) else {},
        }

    # -- the whole dataset --------------------------------------------------

    def load_dataset(self) -> Dataset:
        accounts = self.load_accounts()
        lots = self.load_lots()
        recent_buys = self.load_recent_buys()
        auto_buys = self.load_auto_buys()
        account_ids = {a.id for a in accounts}
        for lot in lots:
            if lot.account not in account_ids:
                raise StoreError(f"lots.json: lot references unknown account '{lot.account}'")
        for buy in recent_buys:
            if buy.account not in account_ids:
                raise StoreError(f"recent_buys.json: buy references unknown account '{buy.account}'")
        for ab in auto_buys:
            if ab.account not in account_ids:
                raise StoreError(f"auto_buys.json: auto-buy references unknown account '{ab.account}'")
        return Dataset(
            accounts=accounts,
            lots=lots,
            recent_buys=recent_buys,
            auto_buys=auto_buys,
            partner_map=self.load_partner_map(),
        )
