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

// Panel — the visual unit of every page. Astryx's Section is semantic only
// (no border, no surface): probed live, the only bordered element on a page
// was a <select>. Data panes need EDGES to be scannable, so pages alias
// Section -> Panel and get a hairline box for free.
export function Panel({ children, className }) {
  return <div className={"vg-panel" + (className ? ` ${className}` : "")}>{children}</div>;
}
