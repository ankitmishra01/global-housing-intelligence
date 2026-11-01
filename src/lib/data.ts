import "server-only";
import { cache } from "react";
import { connect } from "../../lib/db.js";
import { buildPanel } from "../../lib/engine/panel.js";

export type Country = { iso3: string; iso2: string; name: string; region: string; income_group: string | null; tier: number; has_price: number; has_rent: number; has_national: number };
export type Projection = { country: string; target: string; year: number; horizon: number; p10: number; p25: number; median: number; p75: number; p90: number; method: string };
export type Backtest = { target: string; horizon: number; method: string; status: string; mae: number; rmse: number; baseline_mae: number; baseline_rmse: number; skill_pct: number; coverage80: number; n_origins: number; n_records: number; basis: string };
export type Sensitivity = { target: string; horizon: number; coef: number; se: number; valid: number; note: string };
export type Flag = { country: string; flag: string; value: number; threshold: number; as_of: string };
export type IndexComponent = { key: string; value: number | null; percentile: number | null; weight: number };
export type PersonaRow = { country: string; persona: string; score: number; rank: number; components: IndexComponent[] };
export type Context = { country: string; origin_year: number; rent_origin_year: number | null; policy_rate: number | null; policy_rate_as_of: string | null; mortgage_rate: number | null; mortgage_rate_source: string | null; details: { components: Record<string, number | null>; inflation: Record<string, number>; priceSource: string; types: Record<string, { origin: number; source: string }> } };
export type PersonaSpec = { label: string; question: string; components: { key: string; weight: number; direction: number; label: string }[] };
export type RunSummary = { modelVersion: string; latestYear: number; units: Record<string, number>; features: string[]; flagRules: Record<string, { label: string; threshold: number }>; personas: Record<string, PersonaSpec>; distributions: Record<string, number[]>; mortgageSpread: number; uncertainty: string; limits: string[] };
export type Run = { id: string; created_at: string; model_version: string; data_vintage: string; summary: RunSummary };
export type Observation = { country: string; indicator: string; region: string; dwelling_type: string; period: string; frequency: string; value: number; status: string; source: string };

const db = cache(() => connect());

async function rows<T>(sql: string, args: (string | number)[] = []): Promise<T[]> {
  try {
    const result = await db().execute({ sql, args });
    return result.rows.map((r) => ({ ...r })) as T[];
  } catch (error) {
    // An empty or not-yet-migrated database renders the empty states instead of failing the build.
    if (String(error).includes("no such table")) return [];
    throw error;
  }
}

export const latestRun = cache(async (): Promise<Run | null> => {
  const [run] = await rows<Omit<Run, "summary"> & { summary: string }>("SELECT * FROM projection_runs ORDER BY created_at DESC LIMIT 1");
  return run ? { ...run, summary: JSON.parse(run.summary) } : null;
});

export const countries = cache(() => rows<Country>("SELECT iso3, iso2, name, region, income_group, tier, has_price, has_rent, has_national FROM countries ORDER BY name"));

export const country = cache(async (iso3: string) => (await countries()).find((c) => c.iso3 === iso3.toUpperCase()) ?? null);

export const projections = cache(async (iso3?: string) => {
  const run = await latestRun();
  if (!run) return [];
  return iso3
    ? rows<Projection>("SELECT country, target, year, horizon, p10, p25, median, p75, p90, method FROM projections WHERE run_id = ? AND country = ? ORDER BY target, horizon", [run.id, iso3])
    : rows<Projection>("SELECT country, target, year, horizon, p10, p25, median, p75, p90, method FROM projections WHERE run_id = ? ORDER BY country, target, horizon", [run.id]);
});

export const backtests = cache(async () => { const run = await latestRun(); return run ? rows<Backtest>("SELECT * FROM backtests WHERE run_id = ? ORDER BY target, horizon", [run.id]) : []; });
export const sensitivities = cache(async () => { const run = await latestRun(); return run ? rows<Sensitivity>("SELECT target, horizon, coef, se, valid, note FROM rate_sensitivity WHERE run_id = ? ORDER BY target, horizon", [run.id]) : []; });
export const flags = cache(async () => { const run = await latestRun(); return run ? rows<Flag>("SELECT country, flag, value, threshold, as_of FROM risk_flags WHERE run_id = ? ORDER BY value DESC", [run.id]) : []; });

export const personaRows = cache(async () => {
  const run = await latestRun();
  if (!run) return [];
  const list = await rows<Omit<PersonaRow, "components"> & { components: string }>("SELECT country, persona, score, rank, components FROM persona_indexes WHERE run_id = ? ORDER BY persona, rank", [run.id]);
  return list.map((r) => ({ ...r, components: JSON.parse(r.components) as IndexComponent[] }));
});

export const contexts = cache(async () => {
  const run = await latestRun();
  if (!run) return [];
  const list = await rows<Omit<Context, "details"> & { details: string }>("SELECT country, origin_year, rent_origin_year, policy_rate, policy_rate_as_of, mortgage_rate, mortgage_rate_source, details FROM country_context WHERE run_id = ?", [run.id]);
  return list.map((r) => ({ ...r, details: JSON.parse(r.details) })) as Context[];
});

export const observations = cache((iso3: string) =>
  rows<Observation>("SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations WHERE country = ? ORDER BY indicator, region, dwelling_type, period", [iso3]),
);

export const indicatorLabels = cache(async () => {
  const list = await rows<{ key: string; label: string; unit: string; source: string }>("SELECT key, label, unit, source FROM indicators");
  return Object.fromEntries(list.map((i) => [i.key, i]));
});

// Annual history for one country, rebased so the projection origin year = 100.
export type HistoryPoint = { year: number; value: number };
export function rebased(series: Record<string, number> | undefined, origin: number | null | undefined): HistoryPoint[] {
  if (!series || origin == null || !series[origin]) return [];
  return Object.entries(series).map(([y, v]) => ({ year: Number(y), value: (100 * v) / series[origin] })).filter((p) => p.year >= origin - 25 && p.year <= origin).sort((a, b) => a.year - b.year);
}

export async function countryPanel(iso3: string) {
  const obs = await observations(iso3);
  const built = buildPanel(obs.map((o) => ({ ...o, value: Number(o.value) }))) as unknown as { panel: Record<string, unknown>; monthly: Record<string, unknown> };
  const { panel, monthly } = built;
  return { panel: (panel[iso3] ?? {}) as Record<string, Record<string, number>> & { TYPE_REAL?: Record<string, Record<string, number>>; PRICE_SOURCE?: string }, monthly: (monthly[iso3] ?? {}) as Record<string, Record<string, number>>, observations: obs };
}

export async function latestValue(iso3: string, indicator: string) {
  const obs = (await observations(iso3)).filter((o) => o.indicator === indicator && !o.region && !o.dwelling_type && o.frequency === "A" && o.status === "actual");
  return obs.at(-1) ?? null;
}
