import { latestRun } from "@/lib/data";
import { ATTRIBUTION, DISCLAIMER, SITE_URL, SOURCE_CREDITS } from "@/lib/api-helpers";

export const revalidate = 86400;

export async function GET() {
  const run = await latestRun();
  const text = `# Global Housing Intelligence

> House prices and rents for 217 economies, with 10-year projections tested against history,
> an interest-rate toggle, a daily live layer (rate moves, events, sales slumps), affordability
> and mortgage-stress measures, and indexes for investors, buyers, renters and sellers.
> ${DISCLAIMER}
> Free to cite with attribution: "${ATTRIBUTION}", linking the page the figure came from.

Notes for agents: projections are indexes with the origin = 100 (changePct = % vs the origin;
"real" means after inflation) and carry 80% ranges from backtest errors. Only Tier 1 economies
(an official house price index exists) are projected; Tier 2 economies show drivers only.
Live adjustments are already included in API and MCP outputs. Data vintage: ${run?.data_vintage ?? "n/a"};
latest projection run: ${run?.id ?? "n/a"}. Refreshed monthly (full) and daily (live layer).

## Machine access (public, read-only, no sign-up; ${process.env.API_RATE_LIMIT || 60} requests per 10 minutes per IP)
- MCP server (Streamable HTTP): ${SITE_URL}/api/mcp
  tools: list_countries, country_outlook, rate_scenario, compare, persona_rankings, affordability, live_events
- [All countries](${SITE_URL}/api/v1/countries): JSON, tier and coverage flags
- [One country, full](${SITE_URL}/api/v1/countries/CAN): JSON, live-adjusted bands, flags, signals, affordability, national data
- [Projections](${SITE_URL}/api/v1/projections?c=CAN&target=real_price): JSON, raw run projections (not live-adjusted)
- [Persona rankings](${SITE_URL}/api/v1/indexes?persona=buyer): JSON
- [Change feed](${SITE_URL}/feed.xml): RSS; per country at /countries/{ISO3}/feed.xml
- [API documentation](${SITE_URL}/api-docs)

## Pages
- [Overview](${SITE_URL}/): world map of the 10-year outlook, persona leaders, risk register
- [Live](${SITE_URL}/live): today's rate moves and detected events, and what they did to the outlook
- [Countries](${SITE_URL}/countries): all 217 economies; country pages at /countries/{ISO3}
- [Indexes](${SITE_URL}/indexes): investor, buyer, renter and seller league tables
- [Methodology](${SITE_URL}/methodology): sources, live backtest table, rate sensitivities, limits
- [Data quality](${SITE_URL}/quality): automated checks after every refresh

## Sources
${SOURCE_CREDITS.map((s) => `- ${s}`).join("\n")}
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
