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

/* ---------------- Mira client (:8080) ---------------- */

export const miraHealth = () => getJson(`${miraBase()}/health`);

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
