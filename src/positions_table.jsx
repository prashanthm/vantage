// PositionsTable — the shared "what you hold + is it protected" table. Today's
// PositionsCard and Exits' BrokerBook rendered the same symbol/shares/cost/value/
// unrealized/protection rows (Today even links to Exits); this is the one component.
// `dayPl` adds the day-P/L column (Exits shows it, Today doesn't). The naked-position
// warning is the point of the table, so it's built in.
import { cls } from "./util.jsx";

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toFixed(0)}`);

// one protection cell: a resting monitor stop (good) or unprotected (bad).
function Protection({ p }) {
  return p.managed
    ? <span className="vg-badge good" title={p.managed_id ? `managed position #${p.managed_id}` : undefined}>
        stop {fmt(p.stop_price)}
      </span>
    : <span className="vg-badge bad">unprotected</span>;
}

export function PositionsTable({ rows, dayPl = false, warn }) {
  const held = (rows || []).filter((p) => (p.shares || 0) !== 0);
  if (!held.length) return null;
  const naked = held.filter((p) => !p.managed);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="vg-table" style={{ fontSize: 14 }}>
        <thead>
          <tr>
            <th>symbol</th><th>shares</th><th>cost</th><th>value</th><th>unrealized</th>
            {dayPl && <th>day P/L</th>}
            <th>protection</th>
          </tr>
        </thead>
        <tbody>
          {held.map((p) => (
            <tr key={p.symbol}>
              <td><b>{p.symbol}</b></td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.shares, 0)}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.cost)}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.value)}</td>
              <td className={p.unrealized >= 0 ? "vg-up" : "vg-down"}
                style={{ fontVariantNumeric: "tabular-nums" }}>{signed(p.unrealized)}</td>
              {dayPl && (
                <td className={p.day_pl >= 0 ? "vg-up" : "vg-down"}
                  style={{ fontVariantNumeric: "tabular-nums" }}>{signed(p.day_pl)}</td>)}
              <td><Protection p={p} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {naked.length > 0 && warn && (
        <p className={cls("vg-note", warn.verdict && "vg-verdict")}
          style={warn.verdict ? undefined : { marginTop: 6, color: "var(--vg-down)" }}>
          ⚠️ {warn.text(naked)}
        </p>)}
    </div>
  );
}
