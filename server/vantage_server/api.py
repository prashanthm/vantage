"""REST surface for the SPA — read-only by construction (ADR-010/ADR-014).

Every route is GET; there are no mutating routes whatsoever, so no
misconfiguration can create one (FastAPI answers 405 for any other method on
these paths). CORS allows http://localhost on any port — the SPA serves from
:8642; this API listens on :8641.

Every payload carries {"as_of": ..., "source": "fixture"|"stooq"} so the
client can always tell what data it is looking at.

Run: uvicorn vantage_server.api:app --port 8641   (or `make run-api`)
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import engine
from .models import QuoteSnapshot, to_jsonable
from .quotes import get_provider
from .signals import grade_signals
from .store import Dataset, Store

LOCALHOST_ORIGINS = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


@dataclass
class AppState:
    store: Store
    dataset: Dataset

    def snapshot(self) -> QuoteSnapshot:
        # Provider resolved per call so VANTAGE_QUOTES flips without restart
        # and Stooq staleness is re-evaluated per request.
        return get_provider(self.store.data_dir).snapshot()


def create_app(data_dir: str | os.PathLike[str] | None = None) -> FastAPI:
    store = Store(data_dir)
    state = AppState(store=store, dataset=store.load_dataset())
    ds = state.dataset

    app = FastAPI(
        title="Vantage backend",
        version="0.1.0",
        description="Deterministic cross-account portfolio engine — read-only (ADR-010).",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=LOCALHOST_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    def envelope(snap: QuoteSnapshot, **data):
        return {"as_of": snap.as_of, "source": snap.source, "stale": snap.stale, **data}

    def check_account(account: str) -> str:
        if account != "all" and account not in {a.id for a in ds.accounts}:
            raise HTTPException(status_code=404, detail=f"unknown account '{account}'")
        return account

    @app.get("/api/health")
    def health():
        snap = state.snapshot()
        return envelope(snap, status="ok", data_dir=str(store.data_dir),
                        accounts=len(ds.accounts), lots=len(ds.lots))

    @app.get("/api/accounts")
    def accounts():
        snap = state.snapshot()
        rows = [
            {**to_jsonable(a), "value": engine.account_value(ds.lots, snap.quotes, a.id)}
            for a in ds.accounts
        ]
        return envelope(snap, accounts=rows)

    @app.get("/api/positions")
    def positions(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        rows = engine.positions(ds.lots, snap.quotes, account)
        return envelope(snap, account=account, positions=to_jsonable(rows))

    @app.get("/api/allocation")
    def allocation(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        alloc = engine.allocation(ds.lots, snap.quotes, account)
        by_class = {
            cls: {"value": v, "pct": (v / alloc.total * 100) if alloc.total else 0.0}
            for cls, v in alloc.by_class.items()
        }
        return envelope(snap, account=account, total=alloc.total, by_class=by_class)

    @app.get("/api/lots")
    def lots(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        return envelope(snap, account=account,
                        lots=to_jsonable(engine.select_lots(ds.lots, account)))

    @app.get("/api/tax/wash")
    def tax_wash():
        snap = state.snapshot()
        today = engine.parse_as_of(snap.as_of)
        held = sorted({l.symbol for l in ds.lots if l.symbol != "CASH"})
        statuses = {
            sym: to_jsonable(
                engine.wash_status(
                    sym,
                    accounts=ds.accounts,
                    recent_buys=ds.recent_buys,
                    auto_buys=ds.auto_buys,
                    today=today,
                )
            )
            for sym in held
        }
        return envelope(snap, window_days=engine.WASH_WINDOW_DAYS, wash=statuses)

    @app.get("/api/tax/tlh")
    def tax_tlh(
        threshold_usd: float = Query(engine.DEFAULT_THRESHOLD_USD, alias="thresholdUsd", ge=0),
        threshold_pct: float = Query(engine.DEFAULT_THRESHOLD_PCT, alias="thresholdPct", ge=0),
    ):
        snap = state.snapshot()
        today = engine.parse_as_of(snap.as_of)
        cands = engine.tlh_candidates(
            ds.lots,
            snap.quotes,
            accounts=ds.accounts,
            recent_buys=ds.recent_buys,
            auto_buys=ds.auto_buys,
            partner_map=ds.partner_map,
            today=today,
            threshold_usd=threshold_usd,
            threshold_pct=threshold_pct,
        )
        return envelope(snap, threshold_usd=threshold_usd, threshold_pct=threshold_pct,
                        candidates=to_jsonable(cands))

    @app.get("/api/quotes")
    def quotes():
        snap = state.snapshot()
        return envelope(snap, quotes=to_jsonable(snap.quotes))

    signal_seed = store.load_signals()

    @app.get("/api/signals")
    def signals():
        """Graded signals — status/pnl/grade are COMPUTED from the current
        quote snapshot on every read, never authored (see signals.py)."""
        snap = state.snapshot()
        graded = grade_signals(signal_seed, snap.quotes)
        return envelope(snap, signals=to_jsonable(graded))

    return app


app = create_app()
