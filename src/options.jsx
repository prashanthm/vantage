// Options Intelligence view — IV context, income ideas on YOUR holdings, unusual flow.
import { OPTIONS_CONTEXT, OPTIONS_FLOW, INCOME_IDEAS } from "./data.js";
import { cls, acctOf } from "./util.jsx";

const { useState } = React;
const { SecurityCard, FAQItem } = window.LookeyDS;

export function OptionsView({ setSymbol, go }) {
  const [faq, setFaq] = useState(false);
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Options Intelligence</h2>
      <p className="vg-sub">Volatility context, income ideas generated against your holdings, and unusual flow · educational only</p>

      {/* IV context tiles */}
      <div className="vg-ivgrid">
        {Object.entries(OPTIONS_CONTEXT).map(([sym, c]) => (
          <button key={sym} className="vg-ivtile" onClick={() => { setSymbol(sym); go("charts"); }}
            title={`Open ${sym} on AI Charts`}>
            <div className="vg-spread">
              <b>{sym}</b>
              <span className={cls("vg-badge", c.ivRank >= 60 ? "warn" : c.ivRank >= 40 ? "info" : "plain")}>
                IV rank {c.ivRank}
              </span>
            </div>
            <div className="vg-meter" style={{ margin: "8px 0 6px" }}>
              <span style={{ width: `${c.ivRank}%`, background: c.ivRank >= 60 ? "#ca8a04" : "var(--color-primary)" }} />
            </div>
            <div className="vg-note">exp. move {c.expMove} · P/C {c.pcr.toFixed(2)}</div>
          </button>
        ))}
      </div>
      <p className="vg-note" style={{ margin: "6px 0 20px" }}>
        High IV rank = rich premium (favor selling); low = cheap optionality (favor buying). Click a tile to open the chart.
      </p>

      {/* income ideas — cross-account */}
      <div className="vg-spread" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Income ideas on your book</h3>
        <span className="vg-note">screened across all 4 accounts · premiums are mock</span>
      </div>
      <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px", marginBottom: 20 }}>
        <table className="vg-table">
          <thead>
            <tr>
              <th>Idea</th><th>Backing</th><th>Contract</th>
              <th className="num">Δ</th><th className="num">Premium</th><th className="num">Ann. yield</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {INCOME_IDEAS.map((r, i) => (
              <tr key={i}>
                <td>
                  <span className={cls("vg-badge", r.kind === "Not yet eligible" ? "plain" : "good")}>{r.kind}</span>
                  <div style={{ marginTop: 4 }}><b>{r.sym}</b></div>
                </td>
                <td><span className="vg-chip">{acctOf(r.acct).short}</span><div className="vg-note">{r.basis}</div></td>
                <td>{r.contract}</td>
                <td className="num">{r.delta != null ? r.delta.toFixed(2) : "—"}</td>
                <td className="num">{r.premium != null ? `$${r.premium.toFixed(2)}` : "—"}</td>
                <td className="num">{r.yieldAnn != null ? `${r.yieldAnn.toFixed(1)}%` : "—"}</td>
                <td className="vg-note" style={{ maxWidth: 260 }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* unusual flow */}
      <div className="vg-spread" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Unusual options activity</h3>
        <span className="vg-note">large prints & sweeps · mock feed</span>
      </div>
      <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px", marginBottom: 20 }}>
        <table className="vg-table">
          <thead>
            <tr><th>Ticker</th><th>Flow</th><th>Contract</th><th className="num">Premium</th><th>Read</th><th className="num">Conf</th></tr>
          </thead>
          <tbody>
            {OPTIONS_FLOW.map((f, i) => (
              <tr key={i}>
                <td><b>{f.sym}</b><div className="vg-note">{f.time}</div></td>
                <td><span className={cls("vg-badge", f.side === "CALL" ? "good" : "bad")}>{f.side} {f.kind}</span></td>
                <td>{f.detail}</td>
                <td className="num">{f.premium}</td>
                <td><span className={cls("vg-bias", f.sentiment)} style={{ fontSize: 12 }}>{f.sentiment}</span></td>
                <td className="num">{f.conf}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="vg-grid2" style={{ marginBottom: 20 }}>
        <SecurityCard accent="teal" title="Premium pairs well with your TLH calendar">
          Selling calls against a lot you plan to harvest can wash the loss if assigned early. Vantage cross-checks
          every income idea against your Tax Center before suggesting it.
        </SecurityCard>
        <SecurityCard accent="orange" title="Approval levels differ per account">
          Roth allows covered calls and CSPs at most brokers; 401(k)s rarely allow options at all. Ideas are tagged
          with the account they're actually executable in.
        </SecurityCard>
      </div>

      <div className="vg-card">
        <FAQItem question="How are income ideas generated?" open={faq} onToggle={() => setFaq(!faq)}>
          The screener looks for positions of 100+ shares (covered calls) and idle cash (cash-secured puts) in each
          linked account, targets ~0.20–0.30 delta at the next monthly expiry, and ranks by annualized premium yield
          adjusted for IV rank. In this prototype the chains are simulated — educational only, not advice.
        </FAQItem>
      </div>
    </div>
  );
}
