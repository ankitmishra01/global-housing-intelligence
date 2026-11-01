import "server-only";
import {
  activeEvents, applyLive, contexts, countries, country, flags, latestRun, liveShifts, liveState, livePersonaRows, nationalLatest,
  personaRows, projections, recentEvents, sensitivities, type Projection, type Sensitivity,
} from "./data";
import { shiftBand, type Band, type SensMap } from "./toggle";
import { ATTRIBUTION, DISCLAIMER, SITE_URL, clampDelta, pctChange } from "./api-helpers";

// Read-only data products shared by the MCP server and the JSON API. Every result carries
// the run id, data vintage, attribution and a link back to the page it came from.

const HORIZONS = [1, 3, 5, 10];
const TARGETS = ["real_price", "nominal_price", "real_rent", "nominal_rent", "price_to_rent"] as const;

export class ToolError extends Error {}

async function meta(link?: string) {
  const run = await latestRun();
  if (!run) throw new ToolError("No projection run is available yet.");
  return { runId: run.id, modelVersion: run.model_version, dataVintage: run.data_vintage, attribution: ATTRIBUTION, disclaimer: DISCLAIMER, ...(link ? { url: `${SITE_URL}${link}` } : {}) };
}

const toBands = (list: Projection[], target: string): (Band & { method: string })[] =>
  list.filter((p) => p.target === target).map((p) => ({ horizon: p.horizon, year: p.year, p10: p.p10, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90, method: p.method }));

// Live-adjusted bands for every target of one country (as the country page shows them).
async function liveBands(iso3: string) {
  const [proj, shifts] = await Promise.all([projections(iso3), liveShifts(iso3)]);
  const s = shifts[iso3];
  const targets = [...new Set(proj.map((p) => p.target))];
  return Object.fromEntries(targets.map((t) => [t, applyLive(toBands(proj, t), s?.[t])])) as Record<string, (Band & { method: string })[]>;
}

const summarise = (rows: Band[] | undefined) =>
  rows?.length
    ? Object.fromEntries(HORIZONS.map((h) => {
      const r = rows.find((x) => x.horizon === h);
      return [`${h}y`, r ? { year: r.year, changePct: pctChange(r.median), range80Pct: [pctChange(r.p10), pctChange(r.p90)] } : null];
    }))
    : null;

async function requireCountry(iso3: string) {
  const c = await country(iso3);
  if (!c) throw new ToolError(`Unknown country code ${iso3}. Use list_countries to find ISO3 codes.`);
  return c;
}

export async function listCountries({ tier, region }: { tier?: number; region?: string } = {}) {
  const list = (await countries()).filter((c) => (tier ? c.tier === tier : true) && (region ? c.region.toLowerCase().includes(region.toLowerCase()) : true));
  return {
    ...(await meta("/countries")),
    count: list.length,
    note: "Tier 1 economies have an official house price index and are projected; Tier 2 economies have housing drivers only.",
    countries: list.map((c) => ({ iso3: c.iso3, name: c.name, region: c.region, tier: c.tier, hasRentIndex: !!c.has_rent, nationalAgencyData: !!c.has_national })),
  };
}

export async function countryOutlook({ iso3 }: { iso3: string }) {
  const c = await requireCountry(iso3);
  const base = await meta(`/countries/${c.iso3}`);
  if (c.tier !== 1) return { ...base, country: { iso3: c.iso3, name: c.name, tier: c.tier }, note: "No official house price index is published for this economy in the BIS or OECD datasets, so prices and rents are not projected." };
  const [bands, ctxs, allFlags, live, personas] = await Promise.all([liveBands(c.iso3), contexts(), flags(), liveState(c.iso3), livePersonaRows()]);
  const ctx = ctxs.find((x) => x.country === c.iso3);
  const persona = (personas?.rows ?? (await personaRows())).filter((r) => r.country === c.iso3);
  const details = ctx?.details as (NonNullable<typeof ctx>["details"] & { originLabel?: string }) | undefined;
  return {
    ...base,
    country: { iso3: c.iso3, name: c.name, region: c.region, tier: c.tier },
    origin: { label: details?.originLabel ?? (ctx ? String(ctx.origin_year) : null), year: ctx?.origin_year ?? null, rentOriginYear: ctx?.rent_origin_year ?? null, unit: "index, origin = 100; changes are % vs the origin" },
    projections: Object.fromEntries(TARGETS.map((t) => [t, summarise(bands[t])])),
    dwellingTypes: Object.fromEntries(Object.keys(bands).filter((t) => t.startsWith("real_price:")).map((t) => [t.split(":")[1], summarise(bands[t])])),
    methods10y: { price: bands.real_price?.find((r) => r.horizon === 10)?.method ?? null, rent: bands.real_rent?.find((r) => r.horizon === 10)?.method ?? null },
    rates: { policyRate: ctx?.policy_rate ?? null, policyRateAsOf: ctx?.policy_rate_as_of ?? null, mortgageRate: ctx?.mortgage_rate ?? null, mortgageRateSource: ctx?.mortgage_rate_source ?? null },
    liveAdjustments: live ? { asOf: live.as_of, rateDeltaPp: live.rate_delta, explanation: live.explanation.map((e) => e.text) } : null,
    riskFlags: allFlags.filter((f) => f.country === c.iso3).map((f) => ({ flag: f.flag, value: f.value, threshold: f.threshold, asOf: f.as_of })),
    personaScores: Object.fromEntries(persona.map((r) => [r.persona, { score: r.score, rank: r.rank }])),
    signals: details?.signals ?? null,
    mortgageStress: details?.stress ? { score: details.stress.score, rank: details.stress.rank } : null,
    affordability: details?.affordability ?? null,
  };
}

// Same rule as the country page: per-country sensitivities (scaled by household credit) when
// the run stored them, else the pooled table.
function sensFor(target: "real_price" | "real_rent" | "type_price", rateSens: Record<string, unknown> | undefined, pooled: Sensitivity[]): SensMap | undefined {
  const m = rateSens?.[target];
  if (m && typeof m === "object") {
    return Object.fromEntries(Object.entries(m as Record<string, { coef: number; se: number; valid: number }>).map(([h, v]) => [Number(h), { coef: v.coef, se: v.se, valid: !!v.valid }]));
  }
  const rows = pooled.filter((s) => s.target === target);
  return rows.length ? Object.fromEntries(rows.map((s) => [s.horizon, { coef: s.coef, se: s.se, valid: !!s.valid }])) : undefined;
}

export async function rateScenario({ iso3, deltaPp }: { iso3: string; deltaPp: number }) {
  const c = await requireCountry(iso3);
  const delta = clampDelta(deltaPp);
  const base = await meta(`/countries/${c.iso3}`);
  if (c.tier !== 1) throw new ToolError(`${c.name} has no official house price index, so there is no projection to shift.`);
  const [bands, ctxs, pooled] = await Promise.all([liveBands(c.iso3), contexts(), sensitivities()]);
  const ctx = ctxs.find((x) => x.country === c.iso3);
  const rs = ctx?.details.rateSens as Record<string, unknown> | undefined;
  const priceSens = sensFor("real_price", rs, pooled), rentSens = sensFor("real_rent", rs, pooled), typeSens = sensFor("type_price", rs, pooled);
  const pick = (t: string): SensMap | undefined => (t.includes("rent") ? rentSens : t.startsWith("real_price:") ? typeSens : priceSens);
  const scenario = Object.fromEntries([...TARGETS.filter((t) => t !== "price_to_rent"), ...Object.keys(bands).filter((t) => t.startsWith("real_price:"))]
    .filter((t) => bands[t]?.length)
    .map((t) => [t, { current: summarise(bands[t]), scenario: summarise(shiftBand(bands[t], pick(t), delta)) }]));
  return {
    ...base,
    country: { iso3: c.iso3, name: c.name },
    deltaPp: delta,
    policyRateNow: ctx?.policy_rate ?? null,
    mortgageRateNow: ctx?.mortgage_rate ?? null,
    mortgageRateScenario: ctx?.mortgage_rate != null ? Number((ctx.mortgage_rate + delta).toFixed(2)) : null,
    method: "A sustained rate move of deltaPp from today, applied to the model-implied sensitivity of each path; bands widen with the sensitivity's uncertainty. Price effects that are not statistically clear are not applied.",
    priceEffectApplied: !!priceSens && Object.values(priceSens).some((s) => s.valid),
    paths: scenario,
  };
}

export async function compare({ iso3s }: { iso3s: string[] }) {
  const unique = [...new Set(iso3s.map((s) => s.toUpperCase()))];
  const items = await Promise.all(unique.map(async (iso3) => {
    const o = await countryOutlook({ iso3 });
    if (!("projections" in o)) return { iso3, name: o.country.name, tier: o.country.tier, note: o.note };
    return {
      iso3, name: o.country.name, origin: o.origin.label,
      realPrice: { "3y": o.projections.real_price?.["3y"]?.changePct ?? null, "10y": o.projections.real_price?.["10y"]?.changePct ?? null },
      realRent10y: o.projections.real_rent?.["10y"]?.changePct ?? null,
      priceToRent10y: o.projections.price_to_rent?.["10y"]?.changePct ?? null,
      policyRate: o.rates.policyRate, mortgageRate: o.rates.mortgageRate,
      personaScores: o.personaScores, mortgageStress: o.mortgageStress?.score ?? null, riskFlags: o.riskFlags.length,
    };
  }));
  return { ...(await meta(`/compare?c=${unique.join(",")}`)), countries: items };
}

export async function personaRankings({ persona, limit = 20 }: { persona: string; limit?: number }) {
  const [live, baseRows, list] = await Promise.all([livePersonaRows(), personaRows(), countries()]);
  const rowsAll = live?.rows.length ? live.rows : baseRows;
  const names = Object.fromEntries(list.map((c) => [c.iso3, c.name]));
  const run = await latestRun();
  const spec = run?.summary.personas?.[persona];
  return {
    ...(await meta(`/indexes?persona=${persona}`)),
    persona, question: spec?.question ?? null, live: !!live?.rows.length, liveAsOf: live?.asOf ?? null,
    weights: spec?.components.map((c) => ({ component: c.label, weight: c.weight, betterWhen: c.direction > 0 ? "higher" : "lower" })) ?? null,
    rankings: rowsAll.filter((r) => r.persona === persona).slice(0, Math.max(1, Math.min(60, limit))).map((r) => ({ rank: r.rank, iso3: r.country, name: names[r.country] ?? r.country, score: r.score })),
  };
}

export async function affordability({ iso3 }: { iso3: string }) {
  const c = await requireCountry(iso3);
  const ctx = (await contexts()).find((x) => x.country === c.iso3);
  if (!ctx) throw new ToolError(`${c.name} has no affordability metrics (only Tier 1 economies are covered).`);
  return {
    ...(await meta(`/countries/${c.iso3}`)),
    country: { iso3: c.iso3, name: c.name },
    metrics: ctx.details.affordability ?? null,
    mortgageStress: ctx.details.stress ?? null,
    signals: ctx.details.signals ?? null,
    note: "Ratios carry their basis (e.g. national median income vs a GDP-per-head proxy). Market-level signals, not personal advice.",
  };
}

export async function liveEvents({ country: iso3 }: { country?: string } = {}) {
  const [active, recent, list] = await Promise.all([activeEvents(), recentEvents(), countries()]);
  const names = Object.fromEntries(list.map((c) => [c.iso3, c.name]));
  const filter = <T extends { country: string }>(xs: T[]) => (iso3 ? xs.filter((e) => e.country === iso3.toUpperCase()) : xs);
  const fmt = (e: (typeof active)[number]) => {
    let evidence: unknown = null;
    try { evidence = JSON.parse(e.evidence); } catch { /* keep null */ }
    return { country: e.country, name: names[e.country] ?? e.country, class: e.class, status: e.status, onset: e.onset, lastSeen: e.last_seen, intensity: e.intensity, metric: e.metric, source: e.source, evidence };
  };
  const state = iso3 ? await liveState(iso3.toUpperCase()) : null;
  return {
    ...(await meta("/live")),
    note: "Events are detected daily from GDELT, GDACS, exchange rates and land-registry sales. An event shifts projections only when past episodes of its class show a statistically clear effect.",
    active: filter(active).map(fmt),
    recent: filter(recent).slice(0, 30).map(fmt),
    ...(state ? { liveAdjustments: { asOf: state.as_of, explanation: state.explanation.map((e) => e.text) } } : {}),
  };
}

// Full JSON for /api/v1/countries/[iso3]: the outlook plus every live-adjusted band and the
// latest national / regional values.
export async function countryFull(iso3: string) {
  const outlook = await countryOutlook({ iso3 });
  const c = await requireCountry(iso3);
  const national = await nationalLatest(c.iso3);
  if (c.tier !== 1) return { ...outlook, national };
  const bands = await liveBands(c.iso3);
  return { ...outlook, bands: Object.fromEntries(Object.entries(bands).map(([t, rows]) => [t, rows.map((r) => ({ horizon: r.horizon, year: r.year, p10: +r.p10.toFixed(3), p25: +r.p25.toFixed(3), median: +r.median.toFixed(3), p75: +r.p75.toFixed(3), p90: +r.p90.toFixed(3), method: r.method }))])), national };
}
