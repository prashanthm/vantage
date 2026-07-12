"""REST surface for the SPA — reads are the norm; ONE deliberate write (refresh).

Every GET route is read-only (ADR-010/ADR-014): the engine/quotes/journal
surface only ever reads. The SINGLE mutating route is ``POST /api/refresh`` — a
deliberate operator write added under the productization policy shift (see its
handler comment). It writes to OUR OWN SQLite (positions/history/last_synced)
using ONLY read broker tools (fetch_positions/history/portfolio); it can never
place an order or move funds — the broker connectors enforce that at the
transport layer (robinhood.py's READ_TOOLS allowlist). No other route mutates.

CORS allows http://localhost on any port — the SPA serves from :8642; this API
listens on :8641. GET and POST are the only allowed methods (POST solely for
/api/refresh); every other method answers 405.

Every payload carries {"as_of": ..., "source": "fixture"|"yfinance"} so the
client can always tell what data it is looking at.

Run: uvicorn vantage_server.api:app --port 8641   (or `make run-api`)
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import analyze
from . import bars_view
from . import engine
from .ml.roundtrips import summarize_rows as ml_summarize
from .models import QuoteSnapshot, to_jsonable
from .quotes import get_provider
from .refresh import refresh_accounts
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
        # GET for every read route; POST solely for the deliberate /api/refresh
        # write (productization policy shift — see the handler comment).
        allow_methods=["GET", "POST"],
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
        # Reload from the store so a refresh's freshly-written lots/last_synced
        # are reflected without an API restart (the dataset captured at startup
        # is the fixture/offline baseline; the store is the live source).
        from .refresh import CONNECTIONS as _CONN, resolve_broker

        acct_rows = store.load_accounts()
        lots = store.load_lots()
        snap = state.snapshot()
        rows = []
        for a in acct_rows:
            broker = resolve_broker(store, a.id)
            rows.append({
                **to_jsonable(a),
                "value": engine.account_value(lots, snap.quotes, a.id),
                # last_synced from meta (SQLite only; None on JSON) so the UI can
                # show "synced 5m ago". Falls back to the account's last_sync.
                "last_synced": store.get_meta(f"last_synced:{a.id}") or a.last_sync,
                # Broker + whether refresh can pull it live (an API connection)
                # or only re-import CSV — the rail's ⟳ honesty depends on this.
                "broker": broker,
                "refreshable": broker in _CONN,
            })
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

    @app.get("/api/history")
    def history(account: str = Query("all"),
                limit: int = Query(200, ge=1, le=1000)):
        """Imported transaction history (importer --with-history), newest
        first. Read from history.json PER REQUEST (the file appears/changes
        when the operator imports; no restart needed); a missing file is an
        empty list — the SPA shows an empty state."""
        check_account(account)
        snap = state.snapshot()
        rows = store.load_history()
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        return envelope(snap, account=account, history=rows[:limit])

    @app.get("/api/strategies")
    def strategies(account: str = Query("all"),
                   status: str = Query("all"),
                   by: str = Query("strategy")):
        """Options strategy roll-up (importer --with-strategies), read PER
        REQUEST from strategies.json (appears/changes on import; no restart).
        A missing file is an empty roll-up.

        ``by`` selects the view: the default "strategy" returns the open/closed
        strategy roll-up (``status`` filters open|closed|all); "ticker" returns
        the per-underlying POSITION BOOK (``by_ticker`` — every option leg of a
        ticker combined into one row regardless of expiry/strike, netting a
        diagonal's short credit into the long's cost). ``account`` filters open
        and by_ticker rows by their account id (closed rows carry no vantage
        account — they are masked broker-order rows — so an account filter
        narrows those away)."""
        check_account(account)
        if by not in {"strategy", "ticker"}:
            raise HTTPException(status_code=422,
                                detail="by must be one of strategy|ticker")
        if status not in {"all", "open", "closed"}:
            raise HTTPException(status_code=422,
                                detail="status must be one of all|open|closed")
        snap = state.snapshot()
        rollup = store.load_strategies()
        if by == "ticker":
            by_ticker_rows = rollup["by_ticker"]
            if account != "all":
                by_ticker_rows = [r for r in by_ticker_rows
                                  if r.get("account") == account]
            return envelope(snap, account=account,
                            strategies_as_of=rollup["as_of"],
                            by_ticker=by_ticker_rows)
        open_rows = rollup["open"]
        closed_rows = rollup["closed"]
        if account != "all":
            open_rows = [r for r in open_rows if r.get("account") == account]
            closed_rows = []  # closed rows have no vantage account id
        if status == "open":
            closed_rows = []
        elif status == "closed":
            open_rows = []
        return envelope(snap, account=account, status=status,
                        strategies_as_of=rollup["as_of"],
                        open=open_rows, closed=closed_rows)

    @app.get("/api/analysis")
    def analysis(date: str | None = Query(None),
                 symbol: str | None = Query(None)):
        """The nightly decision journal (written by `python -m
        vantage_server.analyze`), read via store.load_analysis_day (SQLite-aware; JSON fallback)
        (or latest.json when no date). Optional ``date`` (YYYY-MM-DD) selects a
        day; ``symbol`` narrows to that underlying. A missing journal is an
        empty state (decisions: [])."""
        snap = state.snapshot()
        day = store.load_analysis_day(date)
        decisions = (day or {}).get("decisions", [])
        if symbol:
            want = symbol.upper()
            decisions = [d for d in decisions if str(d.get("symbol", "")).upper() == want]
        return envelope(snap, date=(day or {}).get("as_of", date),
                        generated_at=(day or {}).get("generated_at"),
                        symbol=symbol, decisions=decisions)

    @app.get("/api/analysis/history")
    def analysis_history(symbol: str = Query(...)):
        """The decision trail for one underlying across ALL journaled days,
        newest first — the record Mira reads to explain how a position's
        recommendation evolved. Empty when the symbol has never been journaled."""
        snap = state.snapshot()
        trail = store.load_analysis_symbol_history(symbol)
        return envelope(snap, symbol=symbol.upper(), history=trail)

    @app.get("/api/spx/playbook")
    def spx_playbook(date: str | None = Query(None),
                     symbol: str = Query("SPX")):
        """The daily 0DTE playbook for ``symbol`` (SPX|QQQ|IWM; written by `python
        -m vantage_server.spx_playbook --symbol`, fusing that underlying's GEX with
        its 15m chart dimensions). ``{scaffold, narrative, session, date}`` —
        latest when no date. Empty state (available:false) when nothing generated.
        Context, not a signal (ADR-008); places no orders."""
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet — run "
                                 f"`python -m vantage_server.spx_playbook --symbol {sym}`.")
        return envelope(snap, available=True, date=row["date"], session=row["session"],
                        symbol=sym, scaffold=row["scaffold"], narrative=row["narrative"])

    @app.get("/api/spx/playbook/pine")
    def spx_playbook_pine(date: str | None = Query(None),
                          symbol: str = Query("SPX")):
        """The 0DTE playbook for ``symbol`` as a copy-paste TradingView Pine v5
        indicator: every level marked, setup zones shaded, conditional buy/sell
        arrows keyed to the gamma-flip regime. Rendered from the stored scaffold
        (latest when no date). Context, not a signal (ADR-008)."""
        from . import playbook_pine
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet.")
        script = playbook_pine.build_playbook_pine(row["scaffold"] or {})
        return envelope(snap, available=bool(script), date=row["date"],
                        session=row["session"], script=script)

    @app.post("/api/spx/playbook/recompute")
    def spx_playbook_recompute(body: dict = Body(default={})):
        """Regenerate the playbook NOW for the requested ``symbol`` (SPX|QQQ|IWM)
        from the latest data, outside the nightly job. Writes only our own store
        (no broker / fund path — ADR-010 holds). Returns the new ``{scaffold,
        session, date}``. Body: ``{as_of?: 'YYYY-MM-DD', symbol?: 'SPX'}``."""
        import datetime as _dt
        from . import spx_playbook as _pb
        as_of = (body or {}).get("as_of")
        sym = ((body or {}).get("symbol") or "SPX").upper()
        today = _dt.date.fromisoformat(as_of) if as_of else _dt.date.today()
        scaffold = _pb.build_playbook(today, store=store, underlying=sym)
        store.upsert_spx_playbook(scaffold["generated_for"], scaffold, symbol=sym)
        _pb.write_pine_file(scaffold)  # refresh the vantage/pine copy-paste artifact
        snap = state.snapshot()
        return envelope(snap, available=True, date=scaffold["generated_for"],
                        symbol=sym, session=scaffold["session"], scaffold=scaffold)

    @app.get("/api/futures/analysis")
    def futures_analysis(contract: str | None = Query(None),
                         alignment: bool = Query(True)):
        """Win-rate analysis of imported AMP futures executions: round-trips
        paired from fills, win-rate-by-condition (exit type / hold time / entry
        hour ET / playbook alignment) via the Bayesian bucketing engine, order
        behavior (cancel rate), and a RECONCILIATION vs the broker's realized PnL
        that flags partial/windowed data. Empty state when nothing imported.
        Decision-support (ADR-008); reads the user's CSV import, no broker path."""
        from . import futures as _fut
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False) or not store.load_futures_fills(contract):
            return envelope(snap, available=False,
                            note="No AMP futures fills imported — run "
                                 "`python -m vantage_server.futures --import ampfutures` "
                                 "or POST /api/futures/import.")
        analysis = _fut.analysis_from_store(store, contract=contract,
                                            with_alignment=alignment)
        # forward projection: today's ETF 0DTE levels rescaled into this contract's
        # futures points (NQ<-QQQ, RTY<-IWM). Reference/context only (ADR-010).
        from . import futures_projection as _fp
        proj_contract = (contract or "NQ").upper()
        projection = _fp.project_for_store(store, proj_contract)
        return envelope(snap, available=True, contract=contract,
                        projection=projection, **analysis)

    @app.post("/api/futures/import")
    def futures_import(body: dict = Body(default={})):
        """(Re)import AMP futures CSVs from ``<data-dir>/<subdir>`` (default
        'ampfutures') into the store, then return the fresh analysis. Writes only
        our SQLite (no broker/order path — ADR-010). Optional
        ``{subdir, account, alignment}``."""
        from . import futures as _fut
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="Futures import requires the SQLite backend.")
        subdir = (body or {}).get("subdir", "ampfutures")
        account = (body or {}).get("account", "ampfutures")
        base = os.path.join(str(store.data_dir), subdir)
        if not os.path.isdir(base):
            return envelope(snap, available=False, note=f"Import dir not found: {base}")
        res = _fut.import_and_store(store, base, account=account)
        analysis = _fut.analysis_from_store(
            store, with_alignment=bool((body or {}).get("alignment", True)))
        return envelope(snap, available=True, imported=res, **analysis)

    @app.get("/api/paper")
    def paper_view(symbol: str = Query("SPX")):
        """Paper-trading tracker for the 0DTE playbook (no money, no orders — a
        simulation for learning + strategy validation), for ``symbol`` (SPX|QQQ|
        IWM). Returns today's tickets (from that underlying's latest playbook),
        open positions, the closed track record + stats. ADR-010: no orders."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="Paper trading requires the SQLite backend.")
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        scaffold = (row or {}).get("scaffold") if row else None
        view = _paper.build_analysis(store, scaffold, underlying=sym)
        return envelope(snap, available=True, session=(row or {}).get("session"),
                        **view)

    @app.post("/api/paper/open")
    def paper_open(body: dict = Body(default={})):
        """Log a paper trade from a ticket (no real order — ADR-010). Body is the
        ticket dict (side/spy_entry/spy_target/spy_stop/shares/underlying/...)."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        ticket = body or {}
        if not ticket.get("side") or ticket.get("spy_entry") is None:
            return envelope(snap, available=False, note="ticket needs side + spy_entry")
        sym = (ticket.get("underlying") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        tid = _paper.open_paper_trade(store, ticket,
                                      session=(row or {}).get("session"), source="manual")
        return envelope(snap, available=True, opened_id=tid,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.post("/api/paper/settle")
    def paper_settle(body: dict = Body(default={})):
        """Auto-close open paper trades that hit target/stop (checks each proxy's
        bars). Writes only our store; no broker path (ADR-010)."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        res = _paper.settle_open(store)
        sym = ((body or {}).get("symbol") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        return envelope(snap, available=True, settled=res,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.post("/api/paper/close")
    def paper_close(body: dict = Body(default={})):
        """Manually close an open paper trade at the current proxy price."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        tid = (body or {}).get("id")
        spy_exit = (body or {}).get("spy_exit")
        if tid is None or spy_exit is None:
            return envelope(snap, available=False, note="need id + spy_exit")
        ok = _paper.close_manually(store, int(tid), float(spy_exit))
        sym = ((body or {}).get("symbol") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        return envelope(snap, available=True, closed=ok,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.get("/api/journal")
    def journal_view(symbol: str | None = Query(None)):
        """The chart-snapshot journal for ``symbol`` (SPX|QQQ|IWM; all when
        omitted): each saved chart (metadata + the forecast live when captured +
        the forecast-vs-outcome scorecard) and the running accuracy. Image bytes
        served via /api/journal/image/{id}. Journal/analysis only (ADR-010)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sym = symbol.upper() if symbol else None
        return envelope(snap, available=True, **_j.build_journal(store, sym))

    @app.post("/api/journal/upload")
    async def journal_upload(image: UploadFile = File(default=None),
                             note: str = Form(""),
                             symbol: str = Form("SPX"),
                             forecast_kind: str = Form("prior"),
                             attach_to: str = Form("")):
        """Attach a reference chart to a journal entry. With ``attach_to`` set to a
        snapshot id, the image is attached to THAT existing entry (the normal path:
        drop today's chart onto today's auto-created row) — no new entry. Without
        it, a NEW entry is created, freezing a playbook forecast: ``forecast_kind``
        ``'prior'`` (default) pins LAST NIGHT'S forecast, ``'live'`` pins today's.
        The image is reference only — never analyzed. Store/disk-only (ADR-010)."""
        import datetime as _dt
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        now = _dt.datetime.now(_dt.timezone.utc).astimezone()
        today = now.date().isoformat()
        # write the reference image (optional)
        fname = mime = None
        if image is not None:
            data = await image.read()
            if data:
                jdir = _j.journal_dir(store.data_dir)
                ext = os.path.splitext(image.filename or "")[1].lower() or ".png"
                fname = f"{now.strftime('%Y%m%dT%H%M%S')}_{int(now.timestamp())}{ext}"
                (jdir / fname).write_bytes(data)
                mime = image.content_type or "image/png"

        # attach to an existing entry (today's row) rather than create a new one
        if attach_to:
            row = store.load_journal_snapshot(int(attach_to))
            if not row:
                return envelope(snap, available=False, note="entry not found")
            if fname:
                # drop the old image file if it's being replaced
                old = row.get("image_path")
                if old:
                    try:
                        (_j.journal_dir(store.data_dir) / old).unlink(missing_ok=True)
                    except OSError:
                        pass
                store.update_journal_image(int(attach_to), fname, mime)
            return envelope(snap, available=True, id=int(attach_to),
                            **_j.build_journal(store, (row.get("symbol") or "SPX")))

        # otherwise: a fresh entry freezing the chosen forecast (prior by default)
        sym = (symbol or "SPX").upper()
        scaffold, forecast, resolved = _j.pick_forecast(
            store, today, "live" if forecast_kind == "live" else "prior", sym)
        sid = store.record_journal_snapshot({
            "created_at": now.isoformat(),
            "session": forecast.get("session") or (scaffold.get("session")),
            "symbol": sym, "image_path": fname,
            "image_mime": mime, "note": note,
            "spot_at_snap": (scaffold.get("regime") or {}).get("spot"),
            "forecast": forecast, "forecast_kind": resolved,
        })
        return envelope(snap, available=True, id=sid, **_j.build_journal(store, sym))

    @app.post("/api/journal/ensure_today")
    def journal_ensure_today(body: dict = Body(default={})):
        """Ensure today's journal entry exists for the requested underlying, or for
        ALL of them (SPX/QQQ/IWM) when no ``symbol`` is given — auto-create freezing
        last night's forecast (idempotent, one per underlying per day) and re-score
        against live price. The Journal page calls this on open. ADR-010."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sym = ((body or {}).get("symbol") or "").upper() or None
        if sym:
            res = _j.ensure_today_entry(store, sym)
        else:
            res = _j.ensure_all_underlyings(store)
        return envelope(snap, available=True, ensured=res,
                        **_j.build_journal(store, sym))

    @app.post("/api/journal/entry")
    def journal_entry(body: dict = Body(default={})):
        """Save / update the structured trade-action log ('what I did') for a
        snapshot. Body: ``{id, entry: {action, entry, exit, result, lesson, notes}}``.
        Store-only write (ADR-010)."""
        import datetime as _dt
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sid = (body or {}).get("id")
        if sid is None:
            return envelope(snap, available=False, note="need id")
        entry = _j.normalize_entry((body or {}).get("entry"))
        now = _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat()
        store.update_journal_entry(int(sid), entry, now)
        return envelope(snap, available=True, saved=True, **_j.build_journal(store))

    @app.get("/api/journal/image/{snap_id}")
    def journal_image(snap_id: int):
        """Serve a snapshot's image bytes."""
        from . import journal as _j
        if not getattr(store, "uses_sqlite", False):
            raise HTTPException(status_code=404, detail="not found")
        row = store.load_journal_snapshot(snap_id)
        if not row or not row.get("image_path"):
            raise HTTPException(status_code=404, detail="snapshot not found")
        path = _j.journal_dir(store.data_dir) / row["image_path"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="image missing")
        return FileResponse(str(path), media_type=row.get("image_mime") or "image/png")

    @app.post("/api/journal/score")
    def journal_score(body: dict = Body(default={})):
        """(Re)score snapshots against price action since they were captured —
        which forecast levels held/broke, was the regime call right. Writes only
        our store (ADR-010)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        res = _j.score_all_open(store)
        return envelope(snap, available=True, scored=res, **_j.build_journal(store))

    @app.post("/api/journal/delete")
    def journal_delete(body: dict = Body(default={})):
        """Delete a snapshot (row + image file)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sid = (body or {}).get("id")
        if sid is None:
            return envelope(snap, available=False, note="need id")
        row = store.load_journal_snapshot(int(sid))
        if row and row.get("image_path"):
            p = _j.journal_dir(store.data_dir) / row["image_path"]
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        store.delete_journal_snapshot(int(sid))
        return envelope(snap, available=True, deleted=True, **_j.build_journal(store))

    @app.get("/api/bars")
    def bars(symbol: str = Query(...),
             timeframe: str = Query("daily")):
        """OHLCV bars + computed S/R levels for one ticker/timeframe — the
        chart's data. Read PER REQUEST from bars/<SYMBOL>.json (written by
        snapshot_bars). ``timeframe`` is daily|weekly|monthly. ``levels`` come
        from technicals.support_resistance over that timeframe at the last
        close, serialized to {price, strength, kind}. 404
        {"error":"no_bars_for_symbol"} when the ticker has no bars file (the
        SPA falls back to its fixture chart)."""
        snap = state.snapshot()
        try:
            payload = bars_view.bars_payload(store.data_dir, symbol, timeframe)
        except ValueError:
            raise HTTPException(status_code=422,
                                detail="timeframe must be one of daily|weekly|monthly")
        except bars_view.BarsNotFound:
            raise HTTPException(status_code=404, detail={"error": "no_bars_for_symbol"})
        return envelope(snap, **payload)

    @app.get("/api/bars/overlay")
    def bars_overlay(symbol: str = Query(...)):
        """The chart's full overlay bundle for one ticker — {symbol,
        current_price, levels (all timeframes), analysis (latest journal
        decision), cost_basis (lots avg cost)}. The single call the chart makes
        to draw everything. 404 {"error":"no_bars_for_symbol"} when no bars
        file exists."""
        snap = state.snapshot()
        q = snap.quotes.get(symbol.upper())
        live_price = q.price if q and q.price else None
        try:
            payload = bars_view.overlay_payload(store.data_dir, symbol, live_price=live_price)
        except bars_view.BarsNotFound:
            raise HTTPException(status_code=404, detail={"error": "no_bars_for_symbol"})
        return envelope(snap, **payload)

    @app.get("/api/quotes")
    def quotes():
        snap = state.snapshot()
        return envelope(snap, quotes=to_jsonable(snap.quotes))

    @app.get("/api/ml/roundtrips")
    def ml_roundtrips(account: str = Query("all"),
                      symbol: str | None = Query(None)):
        """Labeled closed round-trips (win/loss + MFE/MAE excursion), written
        by `python -m vantage_server.ml.build_roundtrips`, read PER REQUEST
        from ml/roundtrips.json (appears/changes on build; no restart). A
        missing file is an empty state ({roundtrips: [], summary: {}}).

        ``account`` filters to one Vantage account id (round-trips carry the
        account they were built for); ``symbol`` narrows to one underlying. The
        returned ``summary`` is RECOMPUTED over the filtered set (via the pure
        ml.roundtrips.summarize) so win-rate/profit-factor always describe what
        was actually returned, never the whole-file roll-up."""
        check_account(account)
        snap = state.snapshot()
        data = store.load_roundtrips()
        rows = data["roundtrips"]
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        if symbol:
            want = symbol.upper()
            rows = [r for r in rows if str(r.get("symbol", "")).upper() == want]
        summary = ml_summarize(rows)
        return envelope(snap, account=account, symbol=symbol,
                        roundtrips_as_of=data["as_of"], roundtrips=rows,
                        summary=summary)

    @app.get("/api/ml/trade_stats")
    def ml_trade_stats(account: str = Query("all"),
                       dimension: str | None = Query(None)):
        """Entry-condition Bayesian condition buckets + notable edges/leaks,
        written by `python -m vantage_server.ml.build_features`, read PER REQUEST
        from ml/trade_stats.json (appears/changes on build; no restart). A
        missing file is an empty state (baseline null, buckets/notable []).

        ``account`` selects one account's blocks (round-trip stats are built per
        account); 'all' returns the top-level (last-built) account's blocks.
        ``dimension`` narrows ``buckets`` to one feature dimension (daily_trend,
        vol_percentile_band, dte_band, moneyness, ...); the baseline row (kept
        under dimension '__baseline__') and ``notable`` are always returned in
        full so the client keeps its comparison point. Returns
        {baseline_win_rate, buckets, notable, trade_stats_as_of}."""
        check_account(account)
        snap = state.snapshot()
        data = store.load_trade_stats()
        block = data
        if account != "all":
            per = data.get("by_account", {}).get(account)
            block = per if isinstance(per, dict) else {
                "baseline_win_rate": None, "buckets": [], "notable": []}
        buckets = list(block.get("buckets") or [])
        if dimension:
            want = dimension.strip()
            buckets = [b for b in buckets
                       if b.get("dimension") in (want, "__baseline__")]
        return envelope(snap, account=account, dimension=dimension,
                        trade_stats_as_of=data["as_of"],
                        baseline_win_rate=block.get("baseline_win_rate"),
                        buckets=buckets,
                        notable=list(block.get("notable") or []))

    # ==================================================================
    # POST /api/refresh — THE deliberate mutating route (read tools only).
    #
    # This is the FIRST and ONLY route that WRITES. It is an operator action:
    # re-pull broker holdings + transactions and persist them to OUR OWN SQLite
    # (positions replaced for the account, history accumulated/deduped,
    # last_synced stamped). It calls ONLY read broker tools (fetch_positions /
    # fetch_option_positions / fetch_portfolio / fetch_history) — order
    # placement and fund movement are impossible (the broker connectors enforce
    # a read-only allowlist at the transport layer, ADR-010). Runs synchronously
    # (fine for a handful of accounts) and returns per-account results. Broker
    # resolution failure for one account is reported in that account's ``errors``
    # while the others proceed.
    # ==================================================================
    @app.post("/api/refresh")
    def refresh(body: dict = Body(default={})):
        account = (body or {}).get("account")
        if account is not None and str(account) != "all":
            account = str(account)
            check_account(account)  # 404 for an unknown account id
        else:
            account = None  # omitted or "all" -> refresh every API-broker account
        results = refresh_accounts(store, account)
        snap = state.snapshot()
        return envelope(snap, results=[r.to_dict() for r in results])

    signal_seed = store.load_signals()

    @app.get("/api/signals")
    def signals():
        """Graded signals — status/pnl/grade are COMPUTED from the current
        quote snapshot on every read, never authored (see signals.py)."""
        snap = state.snapshot()
        graded = grade_signals(signal_seed, snap.quotes)
        return envelope(snap, signals=to_jsonable(graded))

    # ==================================================================
    # Per-ticker NOTEBOOK — the second deliberate API write surface after
    # /api/refresh (ADR-014). Writes touch ONLY our own SQLite (plan + journal),
    # never a broker or any fund-moving path — fully inside ADR-010.
    # ==================================================================
    def _now_iso() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()

    @app.get("/api/ticker/{symbol}/notebook")
    def ticker_notebook(symbol: str):
        """Everything the notebook panel needs in one call: the structured plan
        (+ computed risk/reward geometry), the running journal (newest first),
        valuation fundamentals, growth/quality, market-implied expectations,
        relative strength, and recent news — the same analyst datasets the MCP
        surface serves, so the product isn't blind to what the advisor sees."""
        from . import expectations as exp_mod
        from . import fundamentals as fund
        from . import growth as growth_mod
        from . import news as news_mod
        from . import relative_strength as rs_mod
        from .risk_reward import risk_reward as rr
        snap = state.snapshot()
        sym = symbol.upper()
        plan = store.load_ticker_plan(sym)
        quote = snap.quotes.get(sym)
        price = quote.price if quote else None
        if price is None:
            bars = store.load_bars(sym)
            daily = bars.get("daily") if isinstance(bars, dict) else None
            if isinstance(daily, list) and daily and daily[-1].get("close"):
                price = float(daily[-1]["close"])
        fundamentals = fund.fundamentals(sym, store.data_dir)
        grown = growth_mod.growth(sym, store.data_dir)
        return envelope(
            snap,
            symbol=sym,
            plan=plan,
            risk_reward=rr(plan, price),
            journal=store.load_ticker_journal(sym),
            fundamentals=fundamentals,
            growth=grown,
            expectations=exp_mod.expectations(fundamentals, grown, price),
            relative_strength=rs_mod.relative_strength(sym, store.data_dir),
            news=news_mod.news(sym, store.data_dir),
        )

    @app.get("/api/rec_scorecard")
    def api_rec_scorecard():
        """The decision journal's own track record (per-rule forward-return hit
        rates) — same dataset as the vantage.rec_scorecard MCP tool."""
        from . import rec_scorecard as sc_mod
        snap = state.snapshot()
        return envelope(snap, scorecard=sc_mod.rec_scorecard(store.data_dir))

    @app.get("/api/ticker/{symbol}/fundamentals")
    def ticker_fundamentals(symbol: str):
        from . import fundamentals as fund
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(),
                        fundamentals=fund.fundamentals(symbol.upper(), store.data_dir))

    @app.get("/api/ticker/{symbol}/news")
    def ticker_news(symbol: str):
        """Aggregated, deduped, sentiment-tagged news for one symbol (or null)."""
        from . import news as news_mod
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(),
                        news=news_mod.news(symbol.upper(), store.data_dir))

    @app.post("/api/ticker/{symbol}/plan")
    def save_ticker_plan(symbol: str, body: dict = Body(default={})):
        """Upsert the thesis/target/stop/notes plan for one symbol."""
        store.upsert_ticker_plan(symbol.upper(), body or {}, now=_now_iso())
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(), plan=store.load_ticker_plan(symbol.upper()))

    @app.post("/api/ticker/{symbol}/note")
    def add_ticker_note(symbol: str, body: dict = Body(default={})):
        """Append a manual note to the ticker's journal."""
        text = str((body or {}).get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=400, detail="note text is required")
        store.append_ticker_journal(symbol.upper(), "note", {"text": text}, now=_now_iso())
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(), journal=store.load_ticker_journal(symbol.upper()))

    return app


app = create_app()
