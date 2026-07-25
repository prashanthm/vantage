// Journal endpoint clients for the Astryx shell — same URLs as src/live.js,
// same payloads; both shells hit one backend.
import { backend, getJson } from "./api.js";

async function post(path, body) {
  const res = await fetch(`${backend()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.ok ? res.json() : { available: false };
}

export const getJournal = (symbol = "SPX") =>
  getJson(`${backend()}/api/journal${symbol && symbol !== "SPX" ? `?symbol=${symbol}` : ""}`);
export const ensureTodayJournal = (symbol) =>
  post("/api/journal/ensure_today", symbol ? { symbol } : {});
export const deleteJournal = (id) => post("/api/journal/delete", { id });
export const saveJournalEntry = (id, entry) => post("/api/journal/entry", { id, entry });
export const journalImageUrl = (id) => `${backend()}/api/journal/image/${id}`;

export async function uploadJournal(fileOrBlob, note, forecastKind = "prior", attachTo = null, symbol = "SPX") {
  const fd = new FormData();
  if (fileOrBlob) fd.append("image", fileOrBlob, fileOrBlob.name || "chart.png");
  fd.append("note", note || "");
  fd.append("forecast_kind", forecastKind);
  fd.append("symbol", symbol || "SPX");
  if (attachTo != null) fd.append("attach_to", String(attachTo));
  try {
    const res = await fetch(`${backend()}/api/journal/upload`, { method: "POST", body: fd });
    return res.ok ? res.json() : { available: false };
  } catch (e) { return { available: false }; }
}

export const getSessionActivity = (day, underlying) => {
  const q = new URLSearchParams();
  if (day) q.set("day", day);
  if (underlying) q.set("underlying", underlying);
  return getJson(`${backend()}/api/journal/activity?${q.toString()}`);
};
export const getDayPnl = (days, underlying) => {
  const q = new URLSearchParams({ days: days.join(",") });
  if (underlying) q.set("underlying", underlying);
  return getJson(`${backend()}/api/journal/day-pnl?${q.toString()}`);
};
export const getEntryStructure = (day, trade, underlying = "SPX") =>
  getJson(`${backend()}/api/journal/entry-structure?day=${encodeURIComponent(day)}&trade=${trade}&underlying=${encodeURIComponent(underlying)}`);
export const getTradeDna = (day, trade, underlying = "SPX") =>
  getJson(`${backend()}/api/journal/trade-dna?day=${encodeURIComponent(day)}&trade=${trade}&underlying=${encodeURIComponent(underlying)}`, 60000);
export const saveTradeAnalysis = (body) => post("/api/journal/trade-analysis", body);
export const getAnalyzedKeys = (day) =>
  getJson(`${backend()}/api/journal/analyzed-keys?day=${encodeURIComponent(day)}`);
export const getDayReviewBundle = (day, underlying = "SPX") =>
  getJson(`${backend()}/api/journal/day-review-bundle?day=${encodeURIComponent(day)}&underlying=${encodeURIComponent(underlying)}`, 180000);
export const saveDayReview = (body) => post("/api/journal/day-review", body);
export const getDayReviews = (day) =>
  getJson(`${backend()}/api/journal/day-review?day=${encodeURIComponent(day)}`);
export const getJournalAnalysisBundle = (from, to, underlying = "SPX") =>
  getJson(`${backend()}/api/journal/analysis/bundle?window_from=${encodeURIComponent(from)}&window_to=${encodeURIComponent(to)}&underlying=${encodeURIComponent(underlying)}`);
export const saveJournalAnalysis = (body) => post("/api/journal/analysis", body);
export const getJournalAnalyses = (underlying = "SPX") =>
  getJson(`${backend()}/api/journal/analysis?underlying=${encodeURIComponent(underlying)}`);
