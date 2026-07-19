// Chart theme tokens + conviction/recommendation badge — the shared helpers that
// outlived the old AI-Charts view (charts.jsx). Kept small and dependency-light so
// chart_core / chart_layers / spx_forecast / notebook can import them without pulling
// in a whole view. (Extracted from charts.jsx when the legacy ChartsView was deleted.)
import { cls } from "./util.jsx";

/* ---------- theme-aware chart colors ----------
   Canvas (Lightweight Charts) can't consume var() strings, so read the resolved
   theme tokens at chart-creation time. A chart picks up a theme change on its
   next mount (navigate away/back or refresh). */
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};
const hexRgb = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export function chartTheme() {
  const up = cssVar("--vg-up", "#1F9D6B");
  const down = cssVar("--vg-down", "#D93B4E");
  const faint = cssVar("--vg-faint", "#8C95AB");
  return {
    up, down, upRgb: hexRgb(up), downRgb: hexRgb(down),
    ink: cssVar("--vg-ink", "#131A2A"),
    text: faint, faintRgb: hexRgb(faint),
    grid: cssVar("--vg-hairline", "#E3E7F0"),
    border: cssVar("--vg-rule", "#CDD4E3"),
    accent: cssVar("--vg-accent", "#B97A16"),
    // distinct identity colors for the strike / cost-basis lines (non-semantic
    // series identities — the same purples read on both grounds)
    strike: "#8b5cf6", cost: "#a855f7",
  };
}

/* ============================================================= badge helpers */

// conviction.label -> display + semantic badge tone. Backend labels:
// strong|neutral|weak|freefall.
export const CONVICTION = {
  strong:   { text: "STRONG",   cls: "good" },
  neutral:  { text: "NEUTRAL",  cls: "plain" },
  weak:     { text: "WEAK",     cls: "warn" },
  freefall: { text: "FREEFALL", cls: "bad" },
};
// recommendation -> human label for the badge.
export const REC_LABEL = {
  HOLD_AND_SELL_CALL: "HOLD & SELL CALL",
  CLOSE_AND_BOOK_LOSS: "CLOSE & BOOK LOSS",
  HOLD_WASH_BLOCKED: "HOLD — WASH BLOCKED",
  MONITOR: "MONITOR",
};

export function ConvictionBadge({ analysis }) {
  if (!analysis) return null;
  const c = CONVICTION[analysis.conviction.label] || CONVICTION.neutral;
  const rec = REC_LABEL[analysis.recommendation] || analysis.recommendation;
  return (
    <div className="vg-row" style={{ gap: 8, flexWrap: "wrap" }}>
      <span className={cls("vg-badge", c.cls)}>{c.text}</span>
      <span className="vg-badge info">{rec}</span>
    </div>
  );
}
