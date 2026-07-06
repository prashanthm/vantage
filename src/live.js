// Phase V4 — live integration adapter (ADR-013/ADR-014).
//
// Talks to the Vantage backend (REST, :8641) and Mira (AI, :8080) with plain
// fetch + ReadableStream — no dependencies, no EventSource. Every function is
// progressive-enhancement-safe: it returns null (never throws) on any failure,
// so the SPA's fixture data remains the default experience when either service
// is down. Mappers convert API payloads (snake_case, enveloped) into the exact
// shapes the views already consume from src/util.jsx / src/data.js.
import { loadSettings } from "./util.jsx";

/* ---------------- low-level fetch ---------------- */

// GET url -> parsed JSON, or null on non-200 / network error / timeout.
export async function getJson(url, { timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null; // unreachable, aborted, or bad JSON — callers fall back to fixtures
  } finally {
    clearTimeout(timer);
  }
}

const backendBase = () => (loadSettings().backendUrl || "").replace(/\/+$/, "");
const miraBase = () => (loadSettings().miraUrl || "").replace(/\/+$/, "");

/* ---------------- Vantage backend client (:8641) ---------------- */

export const health = () => getJson(`${backendBase()}/api/health`);
export const accounts = () => getJson(`${backendBase()}/api/accounts`);
export const positions = (account = "all") =>
  getJson(`${backendBase()}/api/positions?account=${encodeURIComponent(account)}`);
export const allocation = (account = "all") =>
  getJson(`${backendBase()}/api/allocation?account=${encodeURIComponent(account)}`);
export const lots = (account = "all") =>
  getJson(`${backendBase()}/api/lots?account=${encodeURIComponent(account)}`);
export const wash = () => getJson(`${backendBase()}/api/tax/wash`);
export const tlh = ({ thresholdUsd, thresholdPct } = {}) => {
  const q = new URLSearchParams();
  if (thresholdUsd != null) q.set("thresholdUsd", String(thresholdUsd));
  if (thresholdPct != null) q.set("thresholdPct", String(thresholdPct));
  const qs = q.toString();
  return getJson(`${backendBase()}/api/tax/tlh${qs ? `?${qs}` : ""}`);
};
export const quotes = () => getJson(`${backendBase()}/api/quotes`);
export const getSignals = () => getJson(`${backendBase()}/api/signals`);
// GET /api/history[?account=..][&limit=N] -> payload or null. "all" means
// unscoped (no account param). 404 (endpoint not deployed yet), non-200 and
// network failures all resolve to null via getJson.
export const getHistory = (account = "all", limit) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (limit != null) q.set("limit", String(limit));
  const qs = q.toString();
  return getJson(`${backendBase()}/api/history${qs ? `?${qs}` : ""}`);
};

// GET /api/strategies[?account=..][&status=open|closed][&by=ticker] -> payload
// or null. "all" means unscoped (no account param); omit status to get both
// open and closed. by="ticker" returns the per-underlying position book
// (by_ticker) instead of the open/closed strategy roll-up. 404 (endpoint not
// deployed), non-200 and network failures resolve to null via getJson — the
// Strategies section then shows its empty state.
export const getStrategies = (account = "all", status, by) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (status) q.set("status", status);
  if (by) q.set("by", by);
  const qs = q.toString();
  return getJson(`${backendBase()}/api/strategies${qs ? `?${qs}` : ""}`);
};

/* ---------------- payload -> view-shape mappers ---------------- */

const mapLot = (l) => ({
  account: l.account,
  symbol: l.symbol,
  date: l.date,
  shares: l.shares,
  costPerShare: l.cost_per_share,
});

const mapWashStatus = (w) => ({
  blocked: w.blocked,
  reason: w.reason,
  clearsOn: w.clears_on,
  clearsOnDate: w.clears_on_date,
  futureRisk: w.future_risk
    ? {
        account: w.future_risk.account,
        symbol: w.future_risk.symbol,
        dayOfMonth: w.future_risk.day_of_month,
        amount: w.future_risk.amount,
        cadence: w.future_risk.cadence,
      }
    : null,
});

// /api/positions -> the array util.jsx positions() produces.
export function mapPositions(payload) {
  if (!payload || !Array.isArray(payload.positions)) return null;
  return payload.positions.map((p) => ({
    symbol: p.symbol,
    shares: p.shares,
    value: p.value,
    cost: p.cost,
    unrl: p.unrealized,
    dayPl: p.day_pl,
    weight: p.weight,
    accounts: p.accounts, // array; views spread it like the fixture Set
    lots: (p.lots || []).map(mapLot),
    overlap: p.overlap || null,
  }));
}

// /api/tax/wash -> { SYMBOL: washStatus } in util.jsx washStatus() shape.
export function mapWash(payload) {
  if (!payload || !payload.wash) return null;
  const out = {};
  for (const [sym, w] of Object.entries(payload.wash)) out[sym] = mapWashStatus(w);
  return out;
}

// /api/tax/tlh -> the array util.jsx tlhCandidates() produces.
export function mapTlh(payload) {
  if (!payload || !Array.isArray(payload.candidates)) return null;
  return payload.candidates.map((c) => ({
    lot: mapLot(c.lot),
    acct: c.account
      ? {
          id: c.account.id,
          name: c.account.name,
          short: c.account.short,
          type: c.account.type,
          taxable: c.account.taxable,
          lastSync: c.account.last_sync,
        }
      : null,
    unrl: c.unrealized,
    lossPct: c.loss_pct,
    status: c.status,
    wash: c.wash ? mapWashStatus(c.wash) : undefined,
    replacement: c.replacement || null,
  }));
}

// /api/allocation -> { byClass: {cls: value}, total } (util.jsx allocation()).
export function mapAllocation(payload) {
  if (!payload || !payload.by_class) return null;
  const byClass = {};
  for (const [k, v] of Object.entries(payload.by_class)) byClass[k] = v.value;
  return { byClass, total: payload.total };
}

// /api/signals -> the data.js SIGNALS row shape the signals view consumes.
// Backend statuses (computed from quotes, never authored) map onto the
// fixture vocabulary: hit_target -> "hit-target", stopped -> "stopped",
// open -> "active"; "unquoted" (no quote for the symbol) passes through and
// gets a neutral badge in the view. pnl_pct / progress_grade ride along as
// extra fields (null when unquoted).
const SIGNAL_STATUS = { hit_target: "hit-target", stopped: "stopped", open: "active", unquoted: "unquoted" };
export function mapSignals(payload) {
  if (!payload || !Array.isArray(payload.signals)) return null;
  return payload.signals.map((g) => ({
    id: g.signal.id,
    sym: g.signal.sym,
    pattern: g.signal.pattern,
    entry: g.signal.entry,
    target: g.signal.target,
    stop: g.signal.stop,
    movePct: g.signal.move_pct,
    conf: g.signal.conf,
    time: g.signal.created_at,
    status: SIGNAL_STATUS[g.status] || g.status,
    // live-only extras
    price: g.price,
    pnlPct: g.pnl_pct,
    grade: g.progress_grade,
  }));
}

// /api/history -> the row shape the Activity view consumes. Backend order
// (newest first) is preserved as-is — no client-side re-sort. History has NO
// fixture fallback: null (malformed payload / endpoint unavailable) or an
// empty array both land on the view's "no activity imported" empty state.
export function mapHistory(payload) {
  if (!payload || !Array.isArray(payload.history)) return null;
  return payload.history.map((h) => ({
    account: h.account,
    brokerAccount: h.broker_account,
    date: h.date,
    kind: h.kind || "other",   // "equity" | "option" | "other"
    symbol: h.symbol,
    description: h.description,
    side: h.side,              // "buy" | "sell" | undefined
    qty: h.quantity,
    price: h.price,
    amount: h.amount,          // signed: buys negative, sells positive
    state: h.state,            // "filled" | "cancelled" | "open" | ...
  }));
}

// /api/strategies -> { open: [...], closed: [...] } of camelCase view rows.
// Backend order is preserved (closed already sorted newest-first). Both arrays
// default to [] when absent, so a payload with only "open" still maps cleanly.
// null (malformed payload / endpoint unavailable) drives the empty state.
const mapStrategyLeg = (l) => ({
  side: l.side,                 // "buy" | "sell"
  optionType: l.option_type,    // "call" | "put"
  strike: l.strike,
  contracts: l.contracts,
  positionType: l.position_type, // "long" | "short" (open legs)
  ratio: l.ratio,               // closed legs
  expiration: l.expiration,     // by_ticker legs carry their own expiry
  openedAt: l.opened_at,        // by_ticker legs carry their open date
  avgPrice: l.avg_price,
  mark: l.mark,
});

// /api/strategies?by=ticker -> { byTicker: [...] } of camelCase position-book
// rows (all option legs of a ticker in one row, netting a diagonal's short).
// null (malformed payload / endpoint unavailable) drives the empty state.
export function mapByTicker(payload) {
  if (!payload || typeof payload !== "object") return null;
  const rows = payload.by_ticker;
  if (rows != null && !Array.isArray(rows)) return null;
  return {
    byTicker: (rows || []).map((s) => ({
      underlying: s.underlying,
      netCost: s.net_cost,             // signed debit: positive = you paid
      currentValue: s.current_value,   // may be null if a leg is unmarked
      unrealized: s.unrealized,        // null if currentValue null
      firstOpened: s.first_opened,
      lastOpened: s.last_opened,
      legCount: s.leg_count,
      hasShort: s.has_short,
      spansExpiries: s.spans_expiries, // flags diagonals/calendars
      account: s.account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
  };
}

export function mapStrategies(payload) {
  if (!payload || typeof payload !== "object") return null;
  const open = payload.open;
  const closed = payload.closed;
  if (open != null && !Array.isArray(open)) return null;
  if (closed != null && !Array.isArray(closed)) return null;
  return {
    open: (open || []).map((s) => ({
      kind: s.kind,
      name: s.name,
      structure: s.structure,
      underlying: s.underlying,
      expiration: s.expiration,
      dte: s.dte,
      netCost: s.net_cost,           // signed debit: positive = you paid
      currentValue: s.current_value, // may be null if a leg is unmarked
      unrealized: s.unrealized,      // null if currentValue null
      account: s._vantage_account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
    closed: (closed || []).map((s) => ({
      kind: s.kind,
      name: s.name,
      structure: s.structure,
      underlying: s.underlying,
      direction: s.direction,        // "credit" | "debit"
      price: s.price,
      multiplier: s.multiplier,
      cash: s.cash,                  // signed $ moved: buys negative
      state: s.state,                // "filled" | "cancelled" | "rejected"
      quantity: s.quantity,
      timestamp: s.timestamp,
      orderId: s.order_id,
      account: s._vantage_account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
  };
}

/* ---------------- Mira client (:8080) ---------------- */

export const miraHealth = () => getJson(`${miraBase()}/health`);

// GET /explain?correlation_id=... -> {"records": [...]} grounding trace for
// one streamed turn (the id arrives on the turn's `done` SSE event).
// 404/503/unreachable all resolve to null via getJson.
export const getExplanation = (correlationId) =>
  getJson(`${miraBase()}/explain?correlation_id=${encodeURIComponent(correlationId)}`);

// GET /insights?domain=advisor -> report or null (404 unknown domain,
// 503 unconfigured, network failure — all null).
export const getInsights = () => getJson(`${miraBase()}/insights?domain=advisor`);

// One stable thread id per page load.
let _threadId = null;
export function threadId() {
  if (!_threadId) _threadId = `vantage-${Date.now()}`;
  return _threadId;
}

// Parse one SSE frame ("event: <kind>\ndata: <json>") into {kind, ...data}.
function parseSseFrame(frame) {
  let kind = null;
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!kind && dataLines.length === 0) return null;
  let data = {};
  if (dataLines.length) {
    const raw = dataLines.join("\n");
    try { data = JSON.parse(raw); } catch (e) { data = { text: raw }; }
  }
  if (typeof data !== "object" || data === null) data = { text: String(data) };
  return { ...data, kind: kind || "message" };
}

// POST {miraUrl}/turn and stream the SSE response incrementally.
// Calls onEvent({kind, ...data}) per frame; guarantees exactly one terminal
// event (done or error) unless aborted. Returns an abort function.
export function streamTurn(prompt, thread, onEvent) {
  const ctrl = new AbortController();
  let terminal = false;
  const emit = (evt) => {
    if (terminal || !evt) return;
    if (evt.kind === "done" || evt.kind === "error") terminal = true;
    try { onEvent(evt); } catch (e) { /* a view error must not kill the stream */ }
  };

  (async () => {
    let res;
    try {
      res = await fetch(`${miraBase()}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, thread_id: thread }),
        signal: ctrl.signal,
      });
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "Mira is not reachable" });
      return;
    }
    if (!res.ok || !res.body) {
      emit({ kind: "error", code: "unreachable", message: `Mira answered ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) !== -1) {
          emit(parseSseFrame(buf.slice(0, cut)));
          buf = buf.slice(cut + 2);
        }
      }
      emit(parseSseFrame(buf)); // unterminated tail frame, if any
      emit({ kind: "done" });   // stream ended without an explicit done frame
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "stream interrupted" });
    }
  })();

  return () => { terminal = true; ctrl.abort(); };
}

/* ---------------- React glue ---------------- */

// Progressive enhancement: state starts as `fallback` (fixtures); the fetcher
// fires on mount and whenever `deps` change; live data swaps in only when the
// fetch produced a non-null payload. Views never see an error state.
export function useLive(fetcher, fallback, deps = []) {
  const [liveData, setLiveData] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setLiveData(null);
    Promise.resolve()
      .then(fetcher)
      .then((d) => { if (alive && d != null) setLiveData(d); })
      .catch(() => { /* fixtures remain */ });
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: liveData != null ? liveData : fallback, isLive: liveData != null };
}
