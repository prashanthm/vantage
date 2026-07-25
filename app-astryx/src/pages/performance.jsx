// Performance (W1) — ONE scoreboard surface with loud Real | Paper tabs.
// Consolidates the legacy Track record (#/trades) and the Strategies paper
// tab. Real and paper money NEVER blend into one number: each tab owns its
// stats, and the by-strategy "Taken live" column is the only bridge (real
// results of trades the operator mirrored from scanner picks).
import { useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Table, proportional, pixel, useTableSortable } from "@astryxdesign/core/Table";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger, Spark } from "../templates.jsx";
import { links } from "../links.js";
import { backend, getJson, money, pref, setPref } from "../api.js";

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const pf = (v) => (v == null ? "—" : v.toFixed(2));

// last N market days (Mon–Fri), newest last — the day-P&L strip's x-axis
function lastSessions(n = 14) {
  const out = [];
  const d = new Date();
  while (out.length < n) {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" })
      .format(d);
    if (wd !== "Sat" && wd !== "Sun")
      out.unshift(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function Tile({ label, value, tone, spark, delta }) {
  return (
    <Section>
      <VStack gap={0} padding={3}>
        <Text type="supporting" color="secondary">{label}</Text>
        <HStack gap={2} align="center">
          <Text type="large" weight="semibold"
            color={tone === "good" ? "success" : tone === "bad" ? "error" : "primary"}>{value}</Text>
          {spark}
        </HStack>
        {delta}
      </VStack>
    </Section>
  );
}

// ---------------------------------------------------------------- Real tab
function RealTab({ dayPnl, rt, stats }) {
  const [tripSort, setTripSort] = useState([{ sortKey: "close_date", direction: "descending" }]);
  const tripPlugin = useTableSortable({ sort: tripSort, onSortChange: setTripSort });
  const [bktSort, setBktSort] = useState([{ sortKey: "n", direction: "descending" }]);
  const bktPlugin = useTableSortable({ sort: bktSort, onSortChange: setBktSort });
  const applySort = (list, sortState) => {
    const s0 = sortState[0];
    if (!s0) return list;
    const dir = s0.direction === "ascending" ? 1 : -1;
    return list.slice().sort((a, b) =>
      dir * (((a[s0.sortKey] ?? 0) < (b[s0.sortKey] ?? 0)) ? -1
        : ((a[s0.sortKey] ?? 0) > (b[s0.sortKey] ?? 0)) ? 1 : 0));
  };
  const days = lastSessions();
  const rows = days.map((day) => ({ day, ...((dayPnl || {})[day] || {}) }))
    .filter((r) => r.has_fills);
  const net = rows.reduce((s, r) => s + (r.realized || 0), 0);
  const summary = (rt && rt.summary) || null;
  const trips = applySort((rt && rt.roundtrips) || [], tripSort).slice(0, 30);
  return (
    <VStack gap={3}>
      <HStack gap={2} wrap="wrap">
        <Tile label={`Day trading — last ${rows.length} sessions with fills`}
          value={money(net)} tone={net >= 0 ? "good" : "bad"}
          spark={<Spark values={rows.map((r) => r.realized || 0)} />}
          delta={rows.length > 0 && (
            <Text type="supporting" color={(rows[rows.length - 1].realized || 0) >= 0 ? "success" : "error"}>
              {(rows[rows.length - 1].realized || 0) >= 0 ? "▲" : "▼"} last session {money(rows[rows.length - 1].realized)}
            </Text>
          )} />
        {summary && <Tile label="Swing roundtrips — win rate" value={pct(summary.win_rate)} />}
        {summary && <Tile label="Swing roundtrips — profit factor" value={pf(summary.profit_factor)}
          tone={summary.profit_factor >= 1 ? "good" : "bad"} />}
      </HStack>
      <div className="vg-cols wide">
      <Section>
        <VStack gap={2} padding={3} className="vg-dense">
          <HStack gap={2} align="center" justify="between">
            <Text type="label" color="secondary">Realized by session — fills synced from the broker</Text>
            <Link href={links.journalDay()}>journal →</Link>
          </HStack>
          <Table data={rows} idKey="day" density="compact" columns={[
            { key: "day", header: "Session", width: pixel(110) },
            { key: "trades", header: "Trades", width: pixel(70), align: "end", renderCell: (r) =>
              <Text type="body">{r.trades ?? "—"}</Text> },
            { key: "realized", header: "Realized", width: proportional(1), align: "end", renderCell: (r) =>
              <Text type="body" weight="semibold" color={(r.realized || 0) >= 0 ? "success" : "error"}>
                {money(r.realized)}</Text> },
          ]} />
        </VStack>
      </Section>
      {stats && (stats.notable || []).length + (stats.buckets || []).length > 0 && (
        <Section>
          <VStack gap={2} padding={3} className="vg-dense">
            <Text type="label" color="secondary">
              Condition edges &amp; leaks — Bayesian buckets vs a {pct(stats.baseline_win_rate)} baseline
            </Text>
            {(stats.notable || []).map((b, i) => (
              <HStack key={i} gap={2} align="center" wrap="wrap">
                <Badge variant={b.kind === "edge" ? "success" : "error"}
                  label={`${b.kind === "edge" ? "▲ edge" : "▼ leak"} · ${b.dimension}=${b.value}`} />
                <Text type="supporting">
                  {pct(b.win_rate)} over {b.n} trades ({money(b.total_pnl)})
                  {b.significant ? " · significant" : " · thin sample"}
                </Text>
              </HStack>
            ))}
            <Table data={applySort((stats.buckets || []).filter((b) => b.dimension !== "__baseline__"), bktSort)
                .slice(0, 12).map((b, i) => ({ id: i, ...b }))}
              idKey="id" density="compact" plugins={{ sort: bktPlugin }} columns={[
              { key: "dimension", header: "Condition", width: proportional(1.6), renderCell: (b) =>
                <Text type="body">{b.dimension} = {String(b.value)}</Text> },
              { key: "n", sortable: true, header: "n", width: pixel(50), renderCell: (b) =>
                <Text type="body">{b.n}</Text> },
              { key: "win_rate", sortable: true, header: "Win rate", width: pixel(90), renderCell: (b) =>
                <Text type="body">{pct(b.win_rate)}</Text> },
              { key: "ci", header: "90% CI", width: proportional(1), align: "end", renderCell: (b) =>
                <Text type="supporting" color="secondary">{pct(b.ci_low)}–{pct(b.ci_high)}</Text> },
              { key: "total_pnl", sortable: true, header: "P&L", width: proportional(1), renderCell: (b) =>
                <Text type="body" color={(b.total_pnl || 0) >= 0 ? "success" : "error"}>{money(b.total_pnl)}</Text> },
            ]} />
          </VStack>
        </Section>
      )}
      {summary && (
        <Section>
          <VStack gap={2} padding={3} className="vg-dense">
            <Text type="label" color="secondary">
              Swing roundtrips · {summary.count} closed · through {(rt || {}).roundtrips_as_of || "—"}
            </Text>
            <Table data={trips.map((t, i) => ({ id: i, ...t }))} idKey="id" density="compact"
              plugins={{ sort: tripPlugin }} columns={[
              { key: "close_date", sortable: true, header: "Closed", width: pixel(100) },
              { key: "symbol", header: "Symbol", width: pixel(90), renderCell: (t) =>
                <Link href={links.chart(t.symbol || "SPX")}>{t.symbol || "—"}</Link> },
              { key: "kind", header: "Kind", width: pixel(90) },
              { key: "realized_pnl", sortable: true, header: "P&L", width: proportional(1), renderCell: (t) =>
                <Text type="body" weight="semibold" color={(t.realized_pnl || 0) >= 0 ? "success" : "error"}>
                  {money(t.realized_pnl)}</Text> },
            ]} />
          </VStack>
        </Section>
      )}
      </div>
    </VStack>
  );
}

// --------------------------------------------------------------- Paper tab
function PaperTab({ spreads, reclaim }) {
  const bs = (spreads && spreads.by_strategy) || {};
  const strat = Object.entries(bs).map(([name, s]) => ({ name, ...s }));
  const manual = (spreads && spreads.live_manual) || [];
  const rs = (reclaim && reclaim.stats) || null;
  const ss = (spreads && spreads.stats) || null;
  return (
    <VStack gap={3}>
      <HStack gap={2} wrap="wrap">
        {ss && <Tile label="Scanner books — net P&L (money-at-risk closes)"
          value={money(ss.total_pnl)} tone={ss.total_pnl >= 0 ? "good" : "bad"} />}
        {ss && <Tile label="Scanner books — profit factor" value={pf(ss.profit_factor)}
          tone={ss.profit_factor >= 1 ? "good" : "bad"} />}
        {rs && <Tile label="Reclaim book — profit factor" value={pf(rs.profit_factor)}
          tone={rs.profit_factor >= 1 ? "good" : "bad"} />}
      </HStack>
      <Section>
        <VStack gap={2} padding={3}>
          <HStack gap={2} align="center" justify="between">
            <Text type="label" color="secondary">
              By strategy — which scanner armed the trade · money-at-risk closes only
            </Text>
            <Link href={links.trackRecordPaper()}>books (legacy) →</Link>
          </HStack>
          <Table data={strat} idKey="name" density="compact" columns={[
            { key: "name", header: "Strategy", width: proportional(1.4), renderCell: (s) =>
              <Badge variant="neutral" label={s.name} /> },
            { key: "open", header: "Open", width: pixel(60), align: "end", renderCell: (s) =>
              <Text type="body">{s.open || 0}</Text> },
            { key: "n", header: "Closed", width: pixel(70), align: "end", renderCell: (s) =>
              <Text type="body">{s.n || 0}</Text> },
            { key: "win_rate", header: "Win rate", width: pixel(80), align: "end", renderCell: (s) =>
              <Text type="body">{s.n ? pct(s.win_rate) : "—"}</Text> },
            { key: "profit_factor", header: "PF", width: pixel(60), align: "end", renderCell: (s) =>
              <Text type="body">{s.n ? pf(s.profit_factor) : "—"}</Text> },
            { key: "total_pnl", header: "Net P&L", width: proportional(1), align: "end", renderCell: (s) =>
              s.n ? <Text type="body" weight="semibold" color={s.total_pnl >= 0 ? "success" : "error"}>
                {money(s.total_pnl)}</Text> : <Text type="supporting" color="secondary">—</Text> },
            { key: "live_taken", header: "Taken live", width: proportional(1.2), renderCell: (s) =>
              s.live_taken
                ? <HStack gap={1} align="center">
                    <Badge variant="warning" label={`${s.live_taken} live`} />
                    {s.live_realized ? <Text type="body" weight="semibold"
                      color={s.live_realized >= 0 ? "success" : "error"}>{money(s.live_realized)}</Text> : null}
                  </HStack>
                : <Text type="supporting" color="secondary">—</Text> },
          ]} />
          <Text type="supporting" color="secondary">
            “Taken live” is the bridge to real money: scanner picks the operator mirrored on the broker,
            auto-correlated by contract. It never blends into the paper stats.
          </Text>
        </VStack>
      </Section>
      <div className="vg-cols wide">
      {manual.length > 0 && (
        <Section>
          <VStack gap={2} padding={3}>
            <Text type="label" color="secondary">Taken live — manual tags (older scans, no paper twin)</Text>
            {manual.map((m, i) => (
              <HStack key={i} gap={2} align="center" wrap="wrap">
                <Badge variant={m.status === "closed" ? (m.realized >= 0 ? "success" : "error") : "warning"}
                  label={`LIVE ${m.label}${m.status === "closed" ? ` ${money(m.realized)}` : ""}`} />
                <Badge variant="neutral" label={m.strategy} />
                <Text type="supporting" color="secondary">manual tag · exp {m.expiration}</Text>
              </HStack>
            ))}
          </VStack>
        </Section>
      )}
      {rs && (
        <Section>
          <VStack gap={2} padding={3}>
            <HStack gap={2} align="center" justify="between">
              <Text type="label" color="secondary">
                Reclaim book (SPY sim, $5k notional) · {rs.n} closed · WR {pct(rs.win_rate)} · net {money(rs.total_pnl)}
              </Text>
              <Link href={links.chart("SPY")}>chart →</Link>
            </HStack>
          </VStack>
        </Section>
      )}
      </div>
    </VStack>
  );
}

export function PerformancePage() {
  const [tab, setTabRaw] = useState(() => pref("perf.tab", "real"));
  const setTab = (v) => { setTabRaw(v); setPref("perf.tab", v); };
  const [dayPnl, setDayPnl] = useState(null);
  const [rt, setRt] = useState(null);
  const [stats, setStats] = useState(null);
  const [spreads, setSpreads] = useState(null);
  const [reclaim, setReclaim] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let dead = false;
    const days = lastSessions().join(",");
    Promise.allSettled([
      getJson(`${backend()}/api/journal/day-pnl?days=${encodeURIComponent(days)}`),
      getJson(`${backend()}/api/ml/roundtrips`),
      getJson(`${backend()}/api/ml/trade_stats`),
      getJson(`${backend()}/api/paper/spreads`),
      getJson(`${backend()}/api/paper`),
    ]).then(([a, b, e, c, d]) => {
      if (dead) return;
      if (a.status === "fulfilled") setDayPnl(a.value.pnl || null);
      if (b.status === "fulfilled") setRt(b.value);
      if (e.status === "fulfilled") setStats(e.value);
      if (c.status === "fulfilled") setSpreads(c.value);
      if (d.status === "fulfilled") setReclaim(d.value);
      setLoading(false);
    });
    return () => { dead = true; };
  }, []);
  return (
    <Ledger
      band={
        <HStack gap={3} align="center" justify="between" wrap="wrap">
          <VStack gap={0}>
            <Heading level={1}>Performance</Heading>
            <Text type="supporting" color="secondary">
              one scoreboard, two kinds of money — never blended
            </Text>
          </VStack>
          <SegmentedControl value={tab} onChange={setTab} label="Money basis">
            <SegmentedControlItem value="real" label="Real" />
            <SegmentedControlItem value="paper" label="Paper" />
          </SegmentedControl>
        </HStack>
      }>
      {loading
        ? <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Loading the record…</Text></HStack>
        : tab === "real"
          ? <RealTab dayPnl={dayPnl} rt={rt} stats={stats} />
          : <PaperTab spreads={spreads} reclaim={reclaim} />}
    </Ledger>
  );
}
