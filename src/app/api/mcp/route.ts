import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ATTRIBUTION, DISCLAIMER, PERSONAS, SOURCE_CREDITS } from "@/lib/api-helpers";
import { affordability, compare, countryOutlook, listCountries, liveEvents, personaRankings, rateScenario, ToolError } from "@/lib/mcp-tools";
import { withRateLimit } from "@/lib/rate-limit";

// Public, read-only MCP server (Streamable HTTP). No sign-in; rate-limited per IP.
export const maxDuration = 60;

const INSTRUCTIONS = `Global Housing Intelligence: house prices and rents for 217 economies, with 10-year projections tested against history.
- Tier 1 economies (about 59) have an official house price index and are projected; Tier 2 economies have housing drivers only and are never projected.
- Projections are indexes with the origin = 100; changePct is the % change from the origin, real means after inflation. Every path has an 80% range from historical backtest errors.
- Live adjustments (central bank rate moves since the origin, statistically clear event effects) are already included.
- rate_scenario applies a sustained rate move to each path using the model-implied, per-country sensitivity.
- ${DISCLAIMER} Persona signals are market-level, not personal advice.
Attribution: credit "${ATTRIBUTION}" and link to the page in each result's url. Underlying sources: ${SOURCE_CREDITS.join("; ")}.`;

const iso3 = z.string().regex(/^[A-Za-z]{3}$/, "ISO3 country code, e.g. CAN").transform((s) => s.toUpperCase());

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });

async function run<T>(fn: () => Promise<T>) {
  try {
    return json(await fn());
  } catch (error) {
    const message = error instanceof ToolError ? error.message : "The data service is temporarily unavailable.";
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

const handler = createMcpHandler(
  (server) => {
    server.registerTool("list_countries", {
      title: "List countries",
      description: "List covered economies with ISO3 code, region, tier (1 = projected, 2 = drivers only), rent-index and national-data coverage. Optional filters: tier, region substring.",
      inputSchema: z.object({ tier: z.union([z.literal(1), z.literal(2)]).optional(), region: z.string().max(80).optional() }),
      annotations: readOnly,
    }, async ({ tier, region }) => run(() => listCountries({ tier, region })));

    server.registerTool("country_outlook", {
      title: "Country housing outlook",
      description: "Live-adjusted 1/3/5/10-year projections for real and nominal house prices, rents and price-to-rent (with 80% ranges), dwelling types, rates, live adjustments, risk flags, persona scores and signals, mortgage stress and affordability for one country.",
      inputSchema: z.object({ iso3 }),
      annotations: readOnly,
    }, async ({ iso3: code }) => run(() => countryOutlook({ iso3: code })));

    server.registerTool("rate_scenario", {
      title: "Interest-rate scenario",
      description: "Shift a country's projected price and rent paths for a sustained policy-rate move of deltaPp percentage points (−5 to +5) from today, using its model-implied rate sensitivity. Returns current vs scenario paths.",
      inputSchema: z.object({ iso3, deltaPp: z.number().min(-5).max(5) }),
      annotations: readOnly,
    }, async ({ iso3: code, deltaPp }) => run(() => rateScenario({ iso3: code, deltaPp })));

    server.registerTool("compare", {
      title: "Compare countries",
      description: "Side-by-side 3/10-year real price, 10-year real rent and price-to-rent, rates, persona scores, mortgage stress and flag counts for 2 to 4 countries.",
      inputSchema: z.object({ iso3s: z.array(iso3).min(2).max(4) }),
      annotations: readOnly,
    }, async ({ iso3s }) => run(() => compare({ iso3s })));

    server.registerTool("persona_rankings", {
      title: "Persona rankings",
      description: "League table for the investor, buyer, renter or seller index (0-100, 100 = most favourable), with component weights. Uses today's live scores when available.",
      inputSchema: z.object({ persona: z.enum(PERSONAS), limit: z.number().int().min(1).max(60).optional() }),
      annotations: readOnly,
    }, async ({ persona, limit }) => run(() => personaRankings({ persona, limit })));

    server.registerTool("affordability", {
      title: "Affordability and mortgage stress",
      description: "House price to income, mortgage payment and rent as a share of income, household debt service, unemployment trend, real wage growth, household debt, the mortgage stress index and persona market signals for one country. Each ratio states its basis.",
      inputSchema: z.object({ iso3 }),
      annotations: readOnly,
    }, async ({ iso3: code }) => run(() => affordability({ iso3: code })));

    server.registerTool("live_events", {
      title: "Live events",
      description: "Active and recent events detected by the daily live layer (armed conflict, regional spillover, natural disasters, currency crises, sales slumps), with evidence and whether they adjust projections. Optional country filter.",
      inputSchema: z.object({ country: iso3.optional() }),
      annotations: readOnly,
    }, async ({ country }) => run(() => liveEvents({ country })));
  },
  { serverInfo: { name: "global-housing-intelligence", version: "1.0.0" }, instructions: INSTRUCTIONS },
);

const limited = withRateLimit("mcp", handler);
export { limited as GET, limited as POST, limited as DELETE };
