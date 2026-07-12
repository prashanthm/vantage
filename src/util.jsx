// Shared helpers: formatting, lot math, settings, tiny components. No demo data.

/* ---------- formatting ---------- */
export const usd = (n, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
// Currency-aware money formatter — INR uses the Indian (lakh/crore) grouping.
const _LOCALE = { USD: "en-US", INR: "en-IN", GBP: "en-GB", EUR: "de-DE",
                  CAD: "en-CA", HKD: "en-HK", JPY: "ja-JP", AUD: "en-AU" };
export const money = (n, ccy = "USD", digits = 0) =>
  n.toLocaleString(_LOCALE[ccy] || "en-US",
    { style: "currency", currency: ccy, minimumFractionDigits: digits, maximumFractionDigits: digits });
// Render a {currency: subtotal} map as side-by-side subtotals — NEVER summed
// across currencies (the "never cross-sum" rule). Single-currency -> one value.
export const moneyByCcy = (byCcy, digits = 0) => {
  const keys = Object.keys(byCcy || {}).filter((k) => byCcy[k] !== 0);
  if (keys.length === 0) return money(0, "USD", digits);
  return keys.sort().map((k) => money(byCcy[k], k, digits)).join(" · ");
};
export const signUsd = (n) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
export const signMoney = (n, ccy = "USD") => `${n >= 0 ? "+" : "−"}${money(Math.abs(n), ccy)}`;
export const signPct = (n, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}%`;
export const cls = (...xs) => xs.filter(Boolean).join(" ");
export const dirCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

const DAY_MS = 86400000;
export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso + "T12:00:00")) / DAY_MS);
export const fmtDate = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? String(iso || "—") : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
export const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Relative "synced <time> ago" for the account rail. Reads a real wall-clock
// ISO timestamp (last_synced meta from the store), NOT the frozen fixture TODAY.
// "never"/empty -> "never"; <60s -> "just now"; then m/h/d; older -> a date.
export const syncedAgo = (iso) => {
  if (!iso || iso === "never") return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "never";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/* ---------- symbol classification (options / sleeves) ---------- */
// Option-contract symbols from the importer: "SPY 2026-07-17 750C".
export const isOptionSym = (sym) => /\d{4}-\d{2}-\d{2} \d+(\.\d+)?[CP]$/.test(sym || "");
// Portfolio sleeves reported as a single value line (no per-share quote).
export const isSleeveSym = (sym) => sym === "CRYPTO" || sym === "FUTURES" || sym === "CASH";
// The chartable equity underlying of a holding symbol: option contracts and
// plain tickers both reduce to their first token ("SPY 2026-07-17 750C" → SPY).
// This is the key /api/analysis decisions are indexed by.
export const underlyingOf = (sym) => (sym || "").trim().split(" ")[0].toUpperCase();

/* ---------- lot math (live data only) ---------- */
// A live-mapped lot carries `price` (the position's per-share current price).
// When absent (older payloads) value falls back to cost — never a fixture quote.
export const lotValue = (l) => l.shares * (l.price != null ? l.price : l.costPerShare);
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
  _liveAccounts[id] ||
  { id, name: id, short: id, type: "", taxable: true };


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
  // theme-aware: translucent semantic tints over the card tone; the neutral is a
  // subtle raise so flat names read as "no move" on either ground.
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme &&
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (Math.abs(pct) < 0.15) return dark ? "rgba(255,255,255,0.05)" : "rgba(19,26,42,0.04)";
  const a = Math.min(0.10 + (Math.abs(pct) / 5) * 0.3, 0.42);
  const up = dark ? "41,168,116" : "31,157,107";
  const down = dark ? "246,70,93" : "217,59,78";
  return pct > 0 ? `rgba(${up},${a.toFixed(3)})` : `rgba(${down},${a.toFixed(3)})`;
}

/* ---------- theme (light / dark / system) ---------- */
// Persisted to localStorage and stamped as data-theme on <html> — index.html
// stamps it pre-paint too, so there's no flash. "system" removes the stamp and
// lets the prefers-color-scheme media query in app.css decide.
export const THEME_KEY = "vantage.theme";
const THEME_ORDER = ["system", "dark", "light"];
export const THEME_ICON = { system: "◐", dark: "☾", light: "☀" };

export function applyTheme(t) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.dataset.theme = t;
  else delete root.dataset.theme;
}

export function useTheme() {
  const [theme, setTheme] = React.useState(() => {
    const t = localStorage.getItem(THEME_KEY);
    return THEME_ORDER.includes(t) ? t : "system";
  });
  const cycle = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
    applyTheme(next);
  };
  return [theme, cycle];
}

// the underlyings the 0DTE playbook / paper / journal cover (SPX default).
export const UNDERLYINGS = ["SPX", "QQQ", "IWM"];

// A compact SPX/QQQ/IWM segmented toggle. `value` is the selected key; `onChange`
// gets the new key. Used on the Playbook, Paper, and Journal pages.
export function SymbolSwitcher({ value, onChange, options = UNDERLYINGS }) {
  return (
    <div className="vg-symsw" role="tablist" aria-label="underlying">
      {options.map((s) => (
        <button key={s} role="tab" aria-selected={s === value}
          className={cls("vg-symsw-btn", s === value && "on")}
          onClick={() => onChange(s)}>{s}</button>
      ))}
    </div>
  );
}
