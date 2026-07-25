// The three page templates (audit deficit 3): every migrated surface maps to
// exactly one — Workbench (focus + rail), Ledger (band + table), Brief
// (reading column). Templates own ALL page-level spacing; pages compose
// regions and never touch margins. Grid CSS lives in theme-vantage.css.

export function Workbench({ band, focus, rail, ledger }) {
  return (
    <div className="vg-workbench">
      {band && <div className="t-band">{band}</div>}
      <div className="t-focus">{focus}</div>
      {rail && <div className="t-rail">{rail}</div>}
      {ledger && <div className="t-ledger">{ledger}</div>}
    </div>
  );
}

export function Ledger({ band, children }) {
  return (
    <div className="vg-ledger">
      {band && <div className="t-band">{band}</div>}
      {children}
    </div>
  );
}

export function Brief({ children }) {
  return <div className="vg-brief">{children}</div>;
}

// Spark — a dependency-free inline sparkline: faint path, accented endpoint.
// Pair with a delta ("▲ +$1,810") so a tile shows direction AND trajectory.
export function Spark({ values, width = 120, height = 28 }) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const px = (i) => (i / (v.length - 1)) * (width - 4) + 2;
  const py = (x) => height - 3 - ((x - min) / span) * (height - 6);
  const d = v.map((x, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(x).toFixed(1)}`).join(" ");
  const last = v[v.length - 1];
  const up = last >= v[v.length - 2];
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block" }}>
      {min < 0 && max > 0 && (
        <line x1="2" x2={width - 2} y1={py(0)} y2={py(0)}
          stroke="var(--color-border)" strokeDasharray="2 3" strokeWidth="1" />
      )}
      <path d={d} fill="none" stroke="var(--color-border)" strokeWidth="1.5" />
      <circle cx={px(v.length - 1)} cy={py(last)} r="2.5"
        fill={up ? "var(--color-icon-success, #2f8a5d)" : "var(--color-icon-error, #b3423a)"} />
    </svg>
  );
}
