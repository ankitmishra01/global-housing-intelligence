import type { Metadata } from "next";
import Link from "next/link";
import { ATTRIBUTION, DISCLAIMER, SITE_URL, SOURCE_CREDITS } from "@/lib/api-helpers";

export const metadata: Metadata = { title: "API and MCP", description: "Public, read-only JSON API, MCP server and RSS feeds for Global Housing Intelligence." };

const LIMIT = Number(process.env.API_RATE_LIMIT) || 60;

const TOOLS = [
  { name: "list_countries", args: "tier?, region?", what: "Covered economies with ISO3 code, region, tier (1 = projected, 2 = drivers only) and coverage flags." },
  { name: "country_outlook", args: "iso3", what: "Live-adjusted 1/3/5/10-year real and nominal price, rent and price-to-rent paths with 80% ranges, dwelling types, rates, live adjustments, flags, persona scores, signals, stress and affordability." },
  { name: "rate_scenario", args: "iso3, deltaPp (−5 to +5)", what: "Current vs scenario paths for a sustained policy-rate move, using the country's model-implied sensitivity." },
  { name: "compare", args: "iso3s (2–4)", what: "Side-by-side outlook, rates, persona scores, stress and flag counts." },
  { name: "persona_rankings", args: "persona, limit?", what: "Investor, buyer, renter or seller league table (0–100) with component weights; today's live scores where available." },
  { name: "affordability", args: "iso3", what: "Price and mortgage payment to income, rent to income, debt service, unemployment trend, real wages, household debt, mortgage stress index and signals." },
  { name: "live_events", args: "country?", what: "Active and recent events from the daily live layer, with evidence and whether they adjust projections." },
];

const ENDPOINTS = [
  { path: "/api/v1/countries", what: "All 217 economies with tier and coverage flags." },
  { path: "/api/v1/countries/CAN", what: "One country in full: live-adjusted bands for every target, outlook summary, flags, signals, affordability and the latest national and regional values." },
  { path: "/api/v1/projections?c=CAN&target=real_price", what: "Raw projections from the latest run (before live adjustments)." },
  { path: "/api/v1/indexes?persona=buyer", what: "Persona league table and weights." },
  { path: "/feed.xml", what: "RSS: live-layer changes and new projection runs." },
  { path: "/countries/CAN/feed.xml", what: "RSS for one country: live changes, risk flags and market signals." },
  { path: "/llms.txt", what: "Plain-text guide for language models and agents." },
];

export default function ApiDocs() {
  const mcp = `${SITE_URL}/api/mcp`;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Developers and AI tools</p>
          <h1>API and MCP server</h1>
          <p className="lede">Everything on the site is available as public, read-only JSON, an MCP server for Claude, ChatGPT and other AI tools, and RSS feeds. No sign-up. Please credit the source.</p>
        </div>
      </header>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">MCP server</p><h2>Connect an AI assistant</h2></div><p>Streamable HTTP, stateless, read-only.</p></div>
        <div className="panel">
          <p style={{ marginTop: 0 }}>Endpoint: <code className="mono">{mcp}</code></p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li><strong>Claude (claude.ai):</strong> Settings → Connectors → Add custom connector, and paste the endpoint URL.</li>
            <li><strong>Claude Code:</strong> <code className="mono">claude mcp add --transport http global-housing {mcp}</code></li>
            <li><strong>Other clients:</strong> point any Streamable HTTP MCP client at the endpoint; stdio-only clients can use <code className="mono">npx -y mcp-remote {mcp}</code>.</li>
          </ul>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Tool</th><th>Arguments</th><th>Returns</th></tr></thead>
            <tbody>{TOOLS.map((t) => <tr key={t.name}><td className="mono">{t.name}</td><td className="mono note">{t.args}</td><td>{t.what}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">JSON and feeds</p><h2>Endpoints</h2></div><p>Responses are cached at the edge for up to an hour.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Endpoint</th><th>What it returns</th></tr></thead>
            <tbody>{ENDPOINTS.map((e) => <tr key={e.path}><td className="mono"><a className="link" href={e.path}>{e.path}</a></td><td>{e.what}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Examples</p>
          <pre className="mono" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: 12.5 }}>{`curl ${SITE_URL}/api/v1/countries/CAN

curl -X POST ${mcp} \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rate_scenario","arguments":{"iso3":"CAN","deltaPp":1}}}'`}</pre>
        </div>
      </section>

      <section className="section grid-2">
        <div className="panel">
          <p className="eyebrow">Rate limits</p>
          <p style={{ marginBottom: 0 }}>{LIMIT} requests per 10 minutes per IP address, counted separately for the JSON API and the MCP server. Over the limit you get HTTP 429 with a <code className="mono">Retry-After</code> header. IP addresses are stored only as salted hashes.</p>
        </div>
        <div className="panel">
          <p className="eyebrow">Reading the numbers</p>
          <p style={{ marginBottom: 0 }}>Projections are indexes with the origin = 100; <code className="mono">changePct</code> is the % change from the origin and &ldquo;real&rdquo; means after inflation. Ranges are 80% bands from historical backtest errors. Only Tier 1 economies are projected. {DISCLAIMER} See the <Link className="link" href="/methodology">methodology</Link>.</p>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Licensing</p><h2>Attribution</h2></div></div>
        <div className="panel">
          <p style={{ marginTop: 0 }}>Credit &ldquo;{ATTRIBUTION}&rdquo; and link to the page each figure came from (every API and MCP result includes its <code className="mono">url</code>). Figures derived from these sources keep their licences:</p>
          <ul style={{ marginBottom: 0, paddingLeft: 18 }}>{SOURCE_CREDITS.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}
