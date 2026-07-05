// AI Charts view — full-screen candlestick chart with AI markers + recommendation panel.
import { TODAY, MARKET, LOTS, AI_INSIGHTS, CHART_PARAMS, CHART_MARKERS, CHART_LEVELS, CHART_RECS } from "./data.js";
import { genOHLC } from "./ohlc.js";
import { usd, signUsd, signPct, cls, dirCls, acctOf, lotValue, lotCost, fmtDate } from "./util.jsx";

const { useState, useMemo, useRef } = React;
const { FAQItem } = window.LookeyDS;

const TIMEFRAMES = [ { key: "1M", bars: 22 }, { key: "3M", bars: 66 }, { key: "6M", bars: 120 } ];
const UP = "#059669", DOWN = "#dc2626";

const fmtD = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function ChartsView({ symbol, setSymbol }) {
  const [tf, setTf] = useState("3M");
  const [hover, setHover] = useState(null); // bar index within visible slice
  const wrapRef = useRef(null);

  const all = useMemo(
    () => genOHLC(symbol, MARKET[symbol].price, CHART_PARAMS[symbol], TODAY, CHART_MARKERS[symbol] || []),
    [symbol]
  );
  const bars = useMemo(() => all.slice(-TIMEFRAMES.find((t) => t.key === tf).bars), [all, tf]);

  // position overlay (across ALL accounts)
  const held = LOTS.filter((l) => l.symbol === symbol);
  const heldShares = held.reduce((s, l) => s + l.shares, 0);
  const avgCost = heldShares ? held.reduce((s, l) => s + lotCost(l), 0) / heldShares : null;
  const heldUnrl = held.reduce((s, l) => s + lotValue(l) - lotCost(l), 0);

  /* ---- geometry ---- */
  const W = 960, H = 380, VH = 70, PADR = 56, PADT = 10;
  const plotW = W - PADR, n = bars.length;
  const levels = CHART_LEVELS[symbol];
  let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
  if (levels) { lo = Math.min(lo, levels.support); hi = Math.max(hi, levels.resistance); }
  if (avgCost != null) { lo = Math.min(lo, avgCost); hi = Math.max(hi, avgCost); }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const y = (p) => PADT + ((hi - p) / (hi - lo)) * (H - PADT - 6);
  const x = (i) => (i + 0.5) * (plotW / n);
  const cw = Math.max(2, (plotW / n) * 0.62);
  const maxV = Math.max(...bars.map((b) => b.v));
  const insight = AI_INSIGHTS[symbol], rec = CHART_RECS[symbol];

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.floor(px / (plotW / n))));
    setHover(px <= plotW ? i : null);
  };

  const gridLines = 4;
  const hb = hover != null ? bars[hover] : null;

  return (
    <div>
      <div className="vg-spread" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>AI Charts</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Simulated candles · AI markers &amp; levels are illustrative · educational only
          </p>
        </div>
        <div className="vg-pills">
          {Object.keys(CHART_PARAMS).map((s) => (
            <button key={s} className={cls("vg-pill", symbol === s && "sel")} onClick={() => { setSymbol(s); setHover(null); }}>{s}</button>
          ))}
        </div>
      </div>

      <div className="vg-chartgrid">
        {/* ------- chart card ------- */}
        <div className="vg-card" style={{ padding: 16 }}>
          <div className="vg-spread" style={{ marginBottom: 8 }}>
            <div className="vg-row">
              <strong style={{ fontSize: 17 }}>{symbol}</strong>
              <span className="vg-note">{MARKET[symbol].name}</span>
              <b style={{ fontSize: 16 }}>{usd(MARKET[symbol].price, 2)}</b>
              <span className={dirCls(MARKET[symbol].dayPct)} style={{ color: MARKET[symbol].dayPct >= 0 ? UP : DOWN, fontWeight: 600 }}>
                {signPct(MARKET[symbol].dayPct)}
              </span>
              {insight && <span className={cls("vg-bias", insight.bias)} style={{ fontSize: 12 }}>{insight.bias}</span>}
            </div>
            <div className="vg-pills">
              {TIMEFRAMES.map((t) => (
                <button key={t.key} className={cls("vg-pill", tf === t.key && "sel")} onClick={() => { setTf(t.key); setHover(null); }}>{t.key}</button>
              ))}
            </div>
          </div>

          <div ref={wrapRef} className="vg-chartwrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H + VH}`} style={{ width: "100%", display: "block" }} role="img"
              aria-label={`${symbol} candlestick chart, ${tf}`}>
              {/* grid + y labels */}
              {Array.from({ length: gridLines + 1 }, (_, g) => {
                const p = lo + ((hi - lo) * g) / gridLines;
                return (
                  <g key={g}>
                    <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="#eef1f6" />
                    <text x={plotW + 8} y={y(p) + 4} fontSize="11" fill="#94a3b8">{p >= 100 ? p.toFixed(0) : p.toFixed(1)}</text>
                  </g>
                );
              })}
              {/* support / resistance */}
              {levels && (
                <g>
                  <line x1={0} x2={plotW} y1={y(levels.resistance)} y2={y(levels.resistance)} stroke={DOWN} strokeDasharray="6 4" strokeOpacity="0.55" />
                  <text x={6} y={y(levels.resistance) - 5} fontSize="10.5" fill={DOWN}>resistance {levels.resistance}</text>
                  <line x1={0} x2={plotW} y1={y(levels.support)} y2={y(levels.support)} stroke={UP} strokeDasharray="6 4" strokeOpacity="0.55" />
                  <text x={6} y={y(levels.support) + 13} fontSize="10.5" fill={UP}>support {levels.support}</text>
                </g>
              )}
              {/* cost basis */}
              {avgCost != null && (
                <g>
                  <line x1={0} x2={plotW} y1={y(avgCost)} y2={y(avgCost)} stroke="#932cfa" strokeDasharray="2 4" strokeWidth="1.6" />
                  <text x={plotW - 4} y={y(avgCost) - 5} fontSize="10.5" fill="#932cfa" textAnchor="end">
                    your avg cost {usd(avgCost, 2)}
                  </text>
                </g>
              )}
              {/* candles */}
              {bars.map((b, i) => {
                const up = b.c >= b.o;
                return (
                  <g key={i}>
                    <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={up ? UP : DOWN} strokeWidth="1" />
                    <rect x={x(i) - cw / 2} y={y(Math.max(b.o, b.c))} width={cw}
                      height={Math.max(1.5, Math.abs(y(b.o) - y(b.c)))} rx="1"
                      fill={up ? UP : DOWN} />
                  </g>
                );
              })}
              {/* AI markers */}
              {bars.map((b, i) => b.marker && (
                <g key={`m${i}`} className="vg-marker">
                  {b.marker.type === "buy" && <path d={`M ${x(i)} ${y(b.l) + 8} l 6 10 l -12 0 z`} fill="#2e68fd" />}
                  {b.marker.type === "sell" && <path d={`M ${x(i)} ${y(b.h) - 18} l 6 -10 l -12 0 z`} fill="#dc2626" />}
                  {b.marker.type === "note" && <circle cx={x(i)} cy={y(b.h) - 14} r="5" fill="#ca8a04" />}
                  <text x={x(i)} y={b.marker.type === "buy" ? y(b.l) + 30 : y(b.h) - 26} fontSize="9.5"
                    fill="#4d525f" textAnchor="middle">AI</text>
                </g>
              ))}
              {/* volume */}
              {bars.map((b, i) => (
                <rect key={`v${i}`} x={x(i) - cw / 2} y={H + VH - (b.v / maxV) * (VH - 12)}
                  width={cw} height={(b.v / maxV) * (VH - 12)} rx="1"
                  fill={b.c >= b.o ? UP : DOWN} opacity="0.35" />
              ))}
              <text x={0} y={H + 12} fontSize="10" fill="#94a3b8">volume</text>
              {/* crosshair */}
              {hb && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={PADT} y2={H + VH} stroke="#01081b" strokeOpacity="0.25" strokeDasharray="3 3" />
                  <line x1={0} x2={plotW} y1={y(hb.c)} y2={y(hb.c)} stroke="#01081b" strokeOpacity="0.18" strokeDasharray="3 3" />
                </g>
              )}
            </svg>
            {hb && (
              <div className="vg-charttip" style={{ left: `${Math.min(92, (x(hover) / W) * 100)}%` }}>
                <b>{fmtD(hb.date)}</b> · O {hb.o.toFixed(2)} · H {hb.h.toFixed(2)} · L {hb.l.toFixed(2)} · C {hb.c.toFixed(2)}
                {hb.marker && <div className="mk">{hb.marker.label}</div>}
              </div>
            )}
          </div>

          {/* marker legend + list */}
          <div className="vg-row" style={{ marginTop: 10, fontSize: 12, color: "var(--color-grey)" }}>
            <span><span className="vg-mk-swatch" style={{ background: "#2e68fd" }} /> AI buy/accumulation</span>
            <span><span className="vg-mk-swatch" style={{ background: "#dc2626" }} /> AI sell/distribution</span>
            <span><span className="vg-mk-swatch" style={{ background: "#ca8a04", borderRadius: 99 }} /> AI note</span>
            {avgCost != null && <span><span className="vg-mk-swatch" style={{ background: "#932cfa" }} /> your avg cost</span>}
          </div>
          <div className="vg-markerlist">
            {(CHART_MARKERS[symbol] || []).map((m, i) => {
              const bar = all[all.length - 1 - m.ago];
              return (
                <span key={i} className={cls("vg-badge", m.type === "buy" ? "info" : m.type === "sell" ? "bad" : "warn")}>
                  {fmtD(bar.date)} — {m.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* ------- right panel: AI read + position + recommendation ------- */}
        <div>
          <div className="vg-card">
            <div className="vg-kicker">AI read</div>
            {insight && <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "0 0 10px" }}>{insight.summary}</p>}
            {insight && (
              <div className="vg-row" style={{ gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div className="vg-spread" style={{ fontSize: 12, color: "var(--color-grey)" }}>
                    <span>Momentum</span><span>{insight.momentum}</span>
                  </div>
                  <div className="vg-meter"><span style={{ width: `${insight.momentum}%` }} /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="vg-spread" style={{ fontSize: 12, color: "var(--color-grey)" }}>
                    <span>Sentiment</span><span>{insight.sentiment}</span>
                  </div>
                  <div className="vg-meter"><span style={{ width: `${insight.sentiment}%`, background: "var(--color-secondary)" }} /></div>
                </div>
              </div>
            )}
          </div>

          <div className="vg-card">
            <div className="vg-kicker">Your position</div>
            {heldShares > 0 ? (
              <div>
                <div className="vg-spread" style={{ fontSize: 14 }}>
                  <b>{heldShares} sh · {usd(heldShares * MARKET[symbol].price)}</b>
                  <span className={dirCls(heldUnrl)} style={{ color: heldUnrl >= 0 ? UP : DOWN, fontWeight: 600 }}>{signUsd(heldUnrl)}</span>
                </div>
                {held.map((l, i) => (
                  <div key={i} className="vg-note" style={{ marginTop: 6 }}>
                    {acctOf(l.account).short}: {l.shares} sh @ {usd(l.costPerShare, 2)} ({fmtDate(l.date)})
                  </div>
                ))}
              </div>
            ) : (
              <p className="vg-note" style={{ margin: 0 }}>Not held in any linked account.</p>
            )}
          </div>

          {rec && (
            <div className="vg-card vg-reccard">
              <div className="vg-kicker">AI recommendation</div>
              <div className="vg-recaction">{rec.action}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "8px 0" }}>{rec.detail}</p>
              <p className="vg-note" style={{ margin: 0 }}>⚠ Risk: {rec.risk}</p>
            </div>
          )}

          <div className="vg-card">
            <ChartFaq />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartFaq() {
  const [open, setOpen] = useState(false);
  return (
    <FAQItem question="What are the AI markers?" open={open} onToggle={() => setOpen(!open)}>
      Blue triangles mark AI-detected accumulation/entry zones, red triangles distribution/exit pressure, and gold
      dots contextual notes (bias flips, TLH windows on lots you own). In this prototype both the candles and the
      markers are simulated — educational only, never trading advice.
    </FAQItem>
  );
}
