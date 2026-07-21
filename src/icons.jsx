// icons.jsx — the ONE icon set. Stroke-based 16×16 SVG primitives, currentColor,
// consistent 1.5 weight — replaces emoji-as-icons (uncontrollable size/weight/
// color, per-OS rendering, screen-reader noise). Add here, never inline emoji
// in controls; emoji stay legal only as CONTENT (e.g. day-strip mood).

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round", strokeLinejoin: "round" };

const GLYPHS = {
  home: <g {...P}><path d="M3 8.2 8 3.6l5 4.6V13H3V8.2z" /><path d="M6.5 13V9.8h3V13" /></g>,
  today: <g {...P}><circle cx="8" cy="8" r="4.4" /><circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <path d="M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9" /></g>,
  plan: <g {...P}><rect x="3.2" y="2.4" width="9.6" height="11.2" rx="1" />
    <path d="M5.5 5.6h5M5.5 8h5M5.5 10.4h3" /></g>,
  scanner: <g {...P}><path d="M2.6 8a5.4 5.4 0 1 1 5.4 5.4" /><path d="M8 8l3.6-3.6" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" /></g>,
  chart: <g {...P}><path d="M5 4.4v7.2M5 5.8h-1.6v3.4H5M5 5.8h1.6v3.4H5" />
    <path d="M11 3v7.2M11 4.6H9.4v3.6H11M11 4.6h1.6v3.6H11" transform="translate(0 1.6)" /></g>,
  dashboard: <g {...P}><rect x="2.8" y="2.8" width="4.4" height="4.4" rx="0.8" />
    <rect x="8.8" y="2.8" width="4.4" height="4.4" rx="0.8" />
    <rect x="2.8" y="8.8" width="4.4" height="4.4" rx="0.8" />
    <rect x="8.8" y="8.8" width="4.4" height="4.4" rx="0.8" /></g>,
  portfolio: <g {...P}><circle cx="8" cy="8" r="5.4" /><path d="M8 2.6V8l3.9 3.7" /></g>,
  positions: <g {...P}><path d="M5 4.2h8M5 8h8M5 11.8h8" />
    <circle cx="2.9" cy="4.2" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="2.9" cy="8" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="2.9" cy="11.8" r="0.8" fill="currentColor" stroke="none" /></g>,
  options: <g {...P}><circle cx="6.2" cy="8" r="3.6" /><circle cx="9.8" cy="8" r="3.6" /></g>,
  tax: <g {...P}><path d="M4 12L12 4" /><circle cx="4.9" cy="4.9" r="1.6" /><circle cx="11.1" cy="11.1" r="1.6" /></g>,
  journal: <g {...P}><path d="M8 3.4C6.8 2.6 4.8 2.4 3 2.8v10c1.8-.4 3.8-.2 5 .6 1.2-.8 3.2-1 5-.6v-10c-1.8-.4-3.8-.2-5 .6z" />
    <path d="M8 3.4v10" /></g>,
  performance: <g {...P}><path d="M3 13h10" /><path d="M4.6 13V9.4M8 13V6M11.4 13V3.6" /></g>,
  futures: <g {...P}><path d="M2.8 4.6l3.4 3.2 2.4-2.2 4.6 4.6" /><path d="M13.2 7.4v2.8h-2.8" /></g>,
  strategies: <g {...P}><circle cx="8" cy="3.8" r="1.7" /><circle cx="4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" />
    <path d="M7.2 5.4L4.7 10.5M8.8 5.4l2.5 5.1" /></g>,
};

export function Icon({ name, size = 15 }) {
  const g = GLYPHS[name];
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
      style={{ display: "block" }}>{g}</svg>
  );
}
