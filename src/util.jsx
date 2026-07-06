// Shared helpers: formatting, portfolio math, settings, tiny components.
import {
  TODAY, ACCOUNTS, MARKET, LOTS, RECENT_BUYS, AUTO_BUYS, PARTNER_MAP,
  WASH_FAMILIES, OVERLAP_GROUPS, WASH_WINDOW_DAYS,
} from "./data.js";

/* ---------- formatting ---------- */
export const usd = (n, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signUsd = (n) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
export const signPct = (n, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}%`;
export const cls = (...xs) => xs.filter(Boolean).join(" ");
export const dirCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

const DAY_MS = 86400000;
export const daysAgo = (iso) => Math.floor((TODAY - new Date(iso + "T12:00:00")) / DAY_MS);
export const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/* ---------- portfolio math (real logic, mock data) ---------- */
export const lotValue = (l) => l.shares * MARKET[l.symbol].price;
export const lotCost = (l) => l.shares * l.costPerShare;
export const lotUnrl = (l) => lotValue(l) - lotCost(l);
// Runtime account registry: live backend accounts (e.g. imported Robinhood)
// registered by the App shell so views can resolve ids the fixtures don't know.
// acctOf never returns undefined — unknown ids degrade to an id-labeled shape.
const _liveAccounts = {};
export const registerAccounts = (list) => {
  for (const a of list || []) if (a && a.id) _liveAccounts[a.id] = a;
};
export const acctOf = (id) =>
  ACCOUNTS.find((a) => a.id === id) ||
  _liveAccounts[id] ||
  { id, name: id, short: id, type: "", taxable: true };

export function washFamily(sym) {
  const fam = WASH_FAMILIES.find((f) => f.includes(sym));
  return fam ? fam : [sym];
}

// Wash-sale status across ALL accounts: 30-day look-back on actual buys plus
// look-forward on scheduled auto-buys (a future repurchase also washes the loss).
export function washStatus(sym) {
  const fam = washFamily(sym);
  const past = RECENT_BUYS.find((b) => fam.includes(b.symbol) && daysAgo(b.date) <= WASH_WINDOW_DAYS);
  if (past) {
    return {
      blocked: true,
      reason: `${acctOf(past.account).short} bought ${past.symbol} on ${fmtDate(past.date)} (${past.note})`,
      clearsOn: addDays(past.date, WASH_WINDOW_DAYS + 1),
      futureRisk: AUTO_BUYS.find((ab) => fam.includes(ab.symbol)),
    };
  }
  const future = AUTO_BUYS.find((ab) => fam.includes(ab.symbol) && ab.dayOfMonth != null);
  if (future) {
    return {
      blocked: true,
      reason: `${acctOf(future.account).short} auto-buys ${future.symbol} monthly (next: Aug ${future.dayOfMonth}) — a buy within 30 days after the sale washes it`,
      clearsOn: "auto-buy paused",
      futureRisk: future,
    };
  }
  return { blocked: false };
}

export function selectedLots(accountId) {
  return accountId === "all" ? LOTS : LOTS.filter((l) => l.account === accountId);
}

export function positions(accountId) {
  const bySym = {};
  for (const l of selectedLots(accountId)) {
    const p = (bySym[l.symbol] ||= { symbol: l.symbol, shares: 0, value: 0, cost: 0, accounts: new Set(), lots: [] });
    p.shares += l.shares;
    p.value += lotValue(l);
    p.cost += lotCost(l);
    p.accounts.add(l.account);
    p.lots.push(l);
  }
  const total = Object.values(bySym).reduce((s, p) => s + p.value, 0);
  return Object.values(bySym)
    .map((p) => ({
      ...p,
      unrl: p.value - p.cost,
      dayPl: (p.value * MARKET[p.symbol].dayPct) / 100,
      weight: total ? (p.value / total) * 100 : 0,
      overlap: overlapFor(p.symbol),
    }))
    .sort((a, b) => b.value - a.value);
}

// Overlap is inherently cross-account: computed over the FULL portfolio.
export function overlapFor(sym) {
  for (const g of OVERLAP_GROUPS) {
    if (!g.symbols.includes(sym)) continue;
    const held = g.symbols.filter((s) => LOTS.some((l) => l.symbol === s));
    if (held.length >= 2) return { label: g.label, symbols: held };
  }
  return null;
}

// TLH candidates: taxable accounts only; per-lot marking (sentinel tlh_monitor semantics).
export function tlhCandidates(settings) {
  const out = [];
  for (const l of LOTS) {
    const acct = acctOf(l.account);
    if (l.symbol === "CASH") continue;
    const unrl = lotUnrl(l);
    if (unrl >= 0) continue;
    const lossPct = (-unrl / lotCost(l)) * 100;
    const pastThreshold = -unrl >= settings.thresholdUsd || lossPct >= settings.thresholdPct;
    if (!acct.taxable) { out.push({ lot: l, acct, unrl, lossPct, status: "na" }); continue; }
    if (!pastThreshold) { out.push({ lot: l, acct, unrl, lossPct, status: "below" }); continue; }
    const wash = washStatus(l.symbol);
    out.push({
      lot: l, acct, unrl, lossPct,
      status: wash.blocked ? "blocked" : "clear",
      wash,
      replacement: PARTNER_MAP[l.symbol] || null,
    });
  }
  return out.sort((a, b) => a.unrl - b.unrl);
}

export function allocation(accountId) {
  const byClass = { usEquity: 0, intlEquity: 0, bonds: 0, cash: 0 };
  let total = 0;
  for (const l of selectedLots(accountId)) {
    const v = lotValue(l);
    byClass[MARKET[l.symbol].assetClass] += v;
    total += v;
  }
  return { byClass, total };
}

export const accountValue = (id) => LOTS.filter((l) => l.account === id).reduce((s, l) => s + lotValue(l), 0);

/* ---------- settings ---------- */
export const SETTINGS_KEY = "vantage.settings.v1";
export const DEFAULT_SETTINGS = {
  defaultAccount: "all",
  thresholdUsd: 200,
  thresholdPct: 3,
  taxRate: 24,
  notifPrefs: { tlh: true, wash: true, price: true, drift: true, system: true },
  // Phase V4 — live integration (ADR-013/014). Fixtures stay the fallback.
  backendUrl: "http://127.0.0.1:8641",
  miraUrl: "http://127.0.0.1:8080",
  aiBackend: "mira", // "mira" | "off"
};
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, notifPrefs: { ...DEFAULT_SETTINGS.notifPrefs, ...(parsed.notifPrefs || {}) } };
    }
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_SETTINGS;
}

/* ---------- tiny components ---------- */
export function StatTile({ label, value, delta, deltaDir, note }) {
  return (
    <div className="vg-stat">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {delta != null && <div className={cls("delta", deltaDir)}>{delta}</div>}
      {note && <div className="vg-note">{note}</div>}
    </div>
  );
}

export function heatTint(pct) {
  if (Math.abs(pct) < 0.15) return "#f1f5f9";
  const a = Math.min(0.08 + (Math.abs(pct) / 5) * 0.3, 0.38);
  return pct > 0 ? `rgba(5,150,105,${a.toFixed(3)})` : `rgba(220,38,38,${a.toFixed(3)})`;
}
