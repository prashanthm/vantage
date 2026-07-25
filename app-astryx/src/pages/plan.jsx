// Daily plan (W4b) — the 0DTE playbook in the shell. The plan of record:
// regime banner (plain narrative, CALM/AMPLIFY), the two trigger scenarios
// side by side, the computed level ladder (every price chart-linked), and
// the market-context read. Pine export + ticket staging stay on the legacy
// page until ported (linked, not re-rendered).
import { useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Panel as Section } from "../templates.jsx";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger } from "../templates.jsx";
import { links } from "../links.js";
import { backend, getJson } from "../api.js";

const SYMBOLS = ["SPX", "QQQ", "IWM"];

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function Tile({ label, value, tone }) {
  return (
    <Section>
      <VStack gap={0} padding={2}>
        <Text type="supporting" color="secondary">{label}</Text>
        <Text type="body" weight="semibold"
          color={tone === "good" ? "success" : tone === "bad" ? "error" : "primary"}>{value}</Text>
      </VStack>
    </Section>
  );
}

function ScenarioCard({ s, symbol }) {
  return (
    <Section>
      <VStack gap={2} padding={2}>
        <Text type="label">{s.trigger}</Text>
        <Text type="supporting" color="secondary">{s.bias}</Text>
        {s.structure && <Text type="supporting">{s.structure}</Text>}
        {(s.targets || []).length > 0 && (
          <VStack gap={0}>
            {(s.targets || []).map((t, i) => (
              <HStack key={i} gap={2} align="center">
                <Text type="supporting" color="secondary">T{i + 1}</Text>
                <Link href={links.chart(symbol)}><Text type="body" weight="semibold">{t.price}</Text></Link>
                <Text type="supporting" color="secondary">
                  {t.kind}{t.pts_from_trigger != null ? ` · ${t.pts_from_trigger}pt from trigger` : ""}
                </Text>
              </HStack>
            ))}
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

export function PlanPage() {
  const [symbol, setSymbol] = useState("SPX");
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pine, setPine] = useState(null);      // null | {script} | {error}
  const [copied, setCopied] = useState(false);
  const load = () => getJson(`${backend()}/api/spx/playbook?symbol=${symbol}`)
    .then((r) => setD(r && r.available ? r : null))
    .catch(() => setD(null));
  useEffect(() => {
    let dead = false;
    setLoading(true); setD(null);
    load().finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  const recompute = async () => {
    setBusy(true);
    try { await postJson(`${backend()}/api/spx/playbook/recompute`, { symbol }); await load(); }
    catch (e) { /* surfaced by the stale banner */ }
    setBusy(false);
  };

  const sc = (d && d.scaffold) || {};
  const reg = sc.regime || {};
  const rows = ((sc.table || {}).rows || []).map((r, i) => ({ id: i, ...r }));
  const setups = sc.setups || [];
  const bullets = reg.market_bullets || [];
  const caveats = sc.caveats || [];
  const amplify = reg.gamma === "negative";

  return (
    <Ledger
      band={
        <VStack gap={2}>
          <HStack gap={3} align="center" justify="between" wrap="wrap">
            <VStack gap={0}>
              <Heading level={1}>Daily plan</Heading>
              <Text type="supporting" color="secondary">
                {d ? `for ${d.date} · ${d.session || ""}` : "the plan of record"} ·{" "}
                <Link href={links.dailyPlan()}>pine export &amp; tickets (legacy) →</Link>
              </Text>
            </VStack>
            <HStack gap={2} align="center" wrap="wrap">
              {reg.spot != null && <Tile label="Spot" value={reg.spot} />}
              {reg.vix != null && <Tile label={`VIX (${reg.vix_band || "?"})`} value={reg.vix} />}
              {reg.gamma && <Tile label="Gamma" value={amplify ? "AMPLIFY" : "CALM"}
                tone={amplify ? "bad" : "good"} />}
              <SegmentedControl value={symbol} onChange={setSymbol} label="Underlying">
                {SYMBOLS.map((s) => <SegmentedControlItem key={s} value={s} label={s} />)}
              </SegmentedControl>
              <Button label={busy ? "Refreshing…" : "Refresh plan"} variant="primary"
                isDisabled={busy} onClick={recompute} />
              <Button label={pine ? "Hide Pine" : "Export to Pine"} variant="secondary"
                onClick={async () => {
                  if (pine) { setPine(null); return; }
                  try {
                    const r = await getJson(`${backend()}/api/spx/playbook/pine?symbol=${symbol}`);
                    setPine(r && r.available !== false && r.script ? { script: r.script }
                      : { error: "no script for today — refresh the plan first" });
                  } catch (e) { setPine({ error: String(e && e.message || e) }); }
                }} />
            </HStack>
          </HStack>
          {reg.gamma_text && <Banner status={amplify ? "warning" : "info"} title={reg.gamma_text} />}
        </VStack>
      }>
      {loading && <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Loading the plan…</Text></HStack>}
      {!loading && !d && <Banner status="error" title={`No plan for ${symbol} — run the nightly or Refresh plan.`} />}
      {pine && (
        <Section>
          <VStack gap={2} padding={2}>
            <HStack gap={2} align="center" justify="between">
              <Text type="label" color="secondary">TradingView Pine — today&apos;s levels as an indicator</Text>
              <Button label={copied ? "Copied ✓" : "Copy"} variant="secondary" onClick={() => {
                navigator.clipboard.writeText(pine.script || "").then(() => {
                  setCopied(true); setTimeout(() => setCopied(false), 1500);
                });
              }} />
            </HStack>
            {pine.error
              ? <Banner status="warning" title={pine.error} />
              : <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", fontSize: 12,
                  fontFamily: "var(--font-family-mono)", whiteSpace: "pre-wrap" }}>{pine.script}</pre>}
          </VStack>
        </Section>
      )}
      {d && (
        <>
          {setups.length > 0 && (
            <div className="vg-cols wide">
              {setups.map((s, i) => <ScenarioCard key={i} s={s} symbol={symbol} />)}
            </div>
          )}
          <div className="vg-cols wide">
            <Section>
              <VStack gap={2} padding={2} className="vg-dense">
                <HStack gap={2} align="center" justify="between">
                  <Text type="label" color="secondary">The level ladder — computed, chart-linked</Text>
                  <Link href={links.chart(symbol)}>chart →</Link>
                </HStack>
                <Table data={rows} idKey="id" density="compact" hasHover columns={[
                  { key: "price", header: "Level", width: proportional(1.2), renderCell: (r) => (
                    <VStack gap={0}>
                      <Link href={links.chart(symbol)}>
                        <Text type="body" weight="semibold">
                          {r.lo != null && r.hi != null && r.hi > r.lo ? `${r.lo}–${r.hi}` : r.price}
                        </Text>
                      </Link>
                      <Text type="supporting" color="secondary">{r.label}</Text>
                    </VStack>
                  )},
                  { key: "role", header: "Role", width: pixel(90), renderCell: (r) =>
                    <Badge variant={r.role === "support" ? "success" : "error"} label={r.role} /> },
                  { key: "expect", header: "Expect", width: proportional(2), renderCell: (r) =>
                    <Text type="supporting">{r.expect || "—"}</Text> },
                ]} />
              </VStack>
            </Section>
            <VStack gap={3}>
              {bullets.length > 0 && (
                <Section>
                  <VStack gap={1} padding={2}>
                    <Text type="label" color="secondary">Market context</Text>
                    {bullets.map((b, i) => (
                      <Text key={i} type="supporting">{typeof b === "string" ? b : (b.text || JSON.stringify(b))}</Text>
                    ))}
                  </VStack>
                </Section>
              )}
              {caveats.length > 0 && (
                <Section>
                  <VStack gap={1} padding={2}>
                    <Text type="label" color="secondary">Caveats — read before leaning on the map</Text>
                    {caveats.map((c, i) => <Text key={i} type="supporting" color="secondary">{c}</Text>)}
                  </VStack>
                </Section>
              )}
            </VStack>
          </div>
        </>
      )}
    </Ledger>
  );
}
