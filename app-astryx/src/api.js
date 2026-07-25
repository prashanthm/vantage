// Shared backend access + tiny formatting helpers for the Astryx shell.
// Same origin + localStorage settings as the legacy SPA, so both shells
// always talk to the same backend without re-configuration.

export const backend = () =>
  (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl
    || "http://127.0.0.1:8641").replace(/\/+$/, "");

export async function getJson(url, timeoutMs = 60000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const todayET = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export const etMinNow = () => {
  const [h, m] = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  }).format(new Date()).split(":");
  return Number(h) * 60 + Number(m);
};

export const money = (v) => (v == null ? "—"
  : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

export const ageMin = (iso) => {
  try { return Math.round((Date.now() - new Date(iso).getTime()) / 60000); }
  catch { return null; }
};

// Per-surface view preferences (filters, tabs, sorts) — the cheap version of
// "saved views": the page reopens the way the operator left it.
export const pref = (k, d) => {
  try { const v = JSON.parse(localStorage.getItem(`vg-next:${k}`)); return v == null ? d : v; }
  catch (e) { return d; }
};
export const setPref = (k, v) => {
  try { localStorage.setItem(`vg-next:${k}`, JSON.stringify(v)); } catch (e) { /* private mode */ }
};
