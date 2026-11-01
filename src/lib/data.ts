import "server-only";
import notesFallback from "../../data/derived/country-notes.json";
import runSnapshotFile from "../../data/derived/run-snapshot.json";
import overlayFile from "../../data/derived/overlay-observations.json";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { connect } from "../../lib/db.js";
import { buildPanel } from "../../lib/engine/panel.js";

export type Country = { iso3: string; iso2: string; name: string; region: string; income_group: string | null; tier: number; has_price: number; has_rent: number; has_national: number };
export type Projection = { country: string; target: string; year: number; horizon: number; p10: number; p25: number; median: number; p75: number; p90: number; method: string };
export type Backtest = { target: string; horizon: number; method: string; status: string; mae: number; rmse: number; baseline_mae: number; baseline_rmse: number; skill_pct: number; coverage80: number; n_origins: number; n_records: number; basis: string };
export type Sensitivity = { target: string; horizon: number; coef: number; se: number; valid: number; note: string };
export type Flag = { country: string; flag: string; value: number; threshold: number; as_of: string };
export type IndexComponent = { key: string; value: number | null; percentile: number | null; weight: number };
export type PersonaRow = { country: string; persona: string; score: number; rank: number; components: IndexComponent[] };
export type Context = { country: string; origin_year: number; rent_origin_year: number | null; policy_rate: number | null; policy_rate_as_of: string | null; mortgage_rate: number | null; mortgage_rate_source: string | null; details: { components: Record<string, number | null>; inflation: Record<string, number>; priceSource: string; types: Record<string, { origin: number; source: string }>; rateSens?: { householdCreditShare?: number; imputed?: boolean } & Record<string, Record<string, { coef: number; se: number; valid: number }> | number | boolean | undefined>; affordability?: Record<string, number | string | boolean | null>; stress?: { score: number; rank: number; components: { key: string; basis: string; value: number | null; percentile: number | null; weight: number }[] } | null; signals?: Record<string, { persona: string; level: number; label: string; score: number | null; adjusted: boolean; support: string[]; oppose: string[] }> } };
export type PersonaSpec = { label: string; question: string; components: { key: string; weight: number; direction: number; label: string }[] };
export type RunSummary = { modelVersion: string; latestYear: number; units: Record<string, number>; features: string[]; flagRules: Record<string, { label: string; threshold: number }>; personas: Record<string, PersonaSpec>; distributions: Record<string, number[]>; mortgageSpread: number; uncertainty: string; limits: string[] };
export type Run = { id: string; created_at: string; model_version: string; data_vintage: string; summary: RunSummary };
export type Observation = { country: string; indicator: string; region: string; dwelling_type: string; period: string; frequency: string; value: number; status: string; source: string };

const db = cache(() => connect());

async function query<T>(sql: string, args: (string | number)[] = []): Promise<T[]> {
  try {
    const result = await db().execute({ sql, args });
    return result.rows.map((r) => ({ ...r })) as T[];
  } catch (error) {
    // An empty or not-yet-migrated database renders the empty states instead of failing the build.
    if (String(error).includes("no such table")) return [];
    throw error;
  }
}

// Every read here is read-only, so results are shared across requests for up to an hour
// (keyed by SQL + args). The daily live cron invalidates the "turso" tag after writing.
// unstable_cache is kept over "use cache" because Cache Components would change every
// route's revalidate semantics; the data is identical either way.
export const TURSO_CACHE_TAG = "turso";
const cachedQuery = unstable_cache(query, ["turso-rows-v1"], { revalidate: 3600, tags: [TURSO_CACHE_TAG] });

async function rows<T>(sql: string, args: (string | number)[] = []): Promise<T[]> {
  return (await cachedQuery(sql, args)) as T[];
}

// Run snapshot: a full training run written to data/derived/run-snapshot.json by
// `node sync/train.js --dry-run --snapshot-out ...` while database writes were blocked. It is
// served when it is newer than the latest stored run; sync/flush-overlay.js loads it into Turso.
type Snapshot = { run: Omit<Run, "summary"> & { summary: string }; tables: Record<string, Record<string, unknown>[]> };
const snapshot = (runSnapshotFile as unknown as Snapshot | null)?.run ? (runSnapshotFile as unknown as Snapshot) : null;
const fromSnapshot = <T,>(run: Run | null, table: string, keep: (r: Record<string, unknown>) => boolean = () => true): T[] | null =>
  run && snapshot && run.id === snapshot.run.id ? (snapshot.tables[table] ?? []).filter(keep) as T[] : null;

export const latestRun = cache(async (): Promise<(Run & { liveRunId?: string }) | null> => {
  const [run] = await rows<Omit<Run, "summary"> & { summary: string }>("SELECT * FROM projection_runs ORDER BY created_at DESC LIMIT 1");
  if (snapshot && (!run || snapshot.run.created_at > run.created_at)) return { ...snapshot.run, summary: JSON.parse(snapshot.run.summary), liveRunId: run?.id };
  return run ? { ...run, summary: JSON.parse(run.summary) } : null;
});

export const countries = cache(() => rows<Country>("SELECT iso3, iso2, name, region, income_group, tier, has_price, has_rent, has_national FROM countries ORDER BY name"));

export const country = cache(async (iso3: string) => (await countries()).find((c) => c.iso3 === iso3.toUpperCase()) ?? null);

export const projections = cache(async (iso3?: string) => {
  const run = await latestRun();
  if (!run) return [];
  const snap = fromSnapshot<Projection>(run, "projections", (r) => !iso3 || r.country === iso3);
  if (snap) return snap;
  return iso3
    ? rows<Projection>("SELECT country, target, year, horizon, p10, p25, median, p75, p90, method FROM projections WHERE run_id = ? AND country = ? ORDER BY target, horizon", [run.id, iso3])
    : rows<Projection>("SELECT country, target, year, horizon, p10, p25, median, p75, p90, method FROM projections WHERE run_id = ? ORDER BY country, target, horizon", [run.id]);
});

export const backtests = cache(async () => { const run = await latestRun(); const snap = fromSnapshot<Backtest>(run, "backtests"); if (snap) return snap; return run ? rows<Backtest>("SELECT * FROM backtests WHERE run_id = ? ORDER BY target, horizon", [run.id]) : []; });
export const sensitivities = cache(async () => { const run = await latestRun(); const snap = fromSnapshot<Sensitivity>(run, "rate_sensitivity"); if (snap) return [...snap].sort((a, b) => a.target.localeCompare(b.target) || a.horizon - b.horizon); return run ? rows<Sensitivity>("SELECT target, horizon, coef, se, valid, note FROM rate_sensitivity WHERE run_id = ? ORDER BY target, horizon", [run.id]) : []; });
export const flags = cache(async () => { const run = await latestRun(); const snap = fromSnapshot<Flag>(run, "risk_flags"); if (snap) return [...snap].sort((a, b) => b.value - a.value); return run ? rows<Flag>("SELECT country, flag, value, threshold, as_of FROM risk_flags WHERE run_id = ? ORDER BY value DESC", [run.id]) : []; });

export const personaRows = cache(async () => {
  const run = await latestRun();
  if (!run) return [];
  const list = fromSnapshot<Omit<PersonaRow, "components"> & { components: string }>(run, "persona_indexes")?.sort((a, b) => a.persona.localeCompare(b.persona) || a.rank - b.rank)
    ?? await rows<Omit<PersonaRow, "components"> & { components: string }>("SELECT country, persona, score, rank, components FROM persona_indexes WHERE run_id = ? ORDER BY persona, rank", [run.id]);
  return list.map((r) => ({ ...r, components: JSON.parse(r.components) as IndexComponent[] }));
});

export const contexts = cache(async () => {
  const run = await latestRun();
  if (!run) return [];
  const list = fromSnapshot<Omit<Context, "details"> & { details: string }>(run, "country_context")
    ?? await rows<Omit<Context, "details"> & { details: string }>("SELECT country, origin_year, rent_origin_year, policy_rate, policy_rate_as_of, mortgage_rate, mortgage_rate_source, details FROM country_context WHERE run_id = ?", [run.id]);
  return list.map((r) => ({ ...r, details: JSON.parse(r.details) })) as Context[];
});

// Not data-cached: the largest countries (NLD, FRA) exceed the 2 MB cache-item limit, and the
// pages that read this are prerendered with ISR anyway.
export const observations = cache((iso3: string) =>
  query<Observation>("SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations WHERE country = ? ORDER BY indicator, region, dwelling_type, period", [iso3]),
);

// National rows only. Country pages use this: city panels can run to 140,000 rows (US metros),
// and city detail lives on /countries/[iso3]/cities and the region pages.
export const nationalObservations = cache((iso3: string) =>
  query<Observation>("SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations WHERE country = ? AND region = '' ORDER BY indicator, dwelling_type, period", [iso3]),
);

// Observations waiting to be written while database writes were blocked
// (data/derived/overlay-observations.json; sync/flush-overlay.js --write loads them into Turso).
type OverlayRow = { country: string; indicator: string; region: string; dwelling_type: string; period: string; frequency: string; value: number; status: string; source: string };
const overlay = (overlayFile as unknown as OverlayRow[]) ?? [];
const overlayFor = (iso3: string, keep: (r: OverlayRow) => boolean = () => true) => overlay.filter((r) => r.country === iso3.toUpperCase() && keep(r));
// Labels for overlay indicators not yet in the indicators table.
const OVERLAY_LABELS: Record<string, { key: string; label: string; unit: string; source: string }> = {
  ASSESSED_VALUE: { key: "ASSESSED_VALUE", label: "Median assessed value of residential property", unit: "local currency", source: "Statistics Canada, Canadian Housing Statistics Program" },
};

export const indicatorLabels = cache(async () => {
  const list = await rows<{ key: string; label: string; unit: string; source: string }>("SELECT key, label, unit, source FROM indicators");
  return { ...OVERLAY_LABELS, ...Object.fromEntries(list.map((i) => [i.key, i])) };
});

// Annual history for one country, rebased so the projection origin year = 100.
export type HistoryPoint = { year: number; value: number };
export function rebased(series: Record<string, number> | undefined, origin: number | null | undefined): HistoryPoint[] {
  if (!series || origin == null || !series[origin]) return [];
  return Object.entries(series).map(([y, v]) => ({ year: Number(y), value: (100 * v) / series[origin] })).filter((p) => p.year >= origin - 25 && p.year <= origin).sort((a, b) => a.year - b.year);
}

export async function countryPanel(iso3: string) {
  const obs = await nationalObservations(iso3);
  const built = buildPanel(obs.map((o) => ({ ...o, value: Number(o.value) }))) as unknown as { panel: Record<string, unknown>; monthly: Record<string, unknown> };
  const { panel, monthly } = built;
  return { panel: (panel[iso3] ?? {}) as Record<string, Record<string, number>> & { TYPE_REAL?: Record<string, Record<string, number>>; PRICE_SOURCE?: string }, monthly: (monthly[iso3] ?? {}) as Record<string, Record<string, number>>, observations: obs };
}

export async function latestValue(iso3: string, indicator: string) {
  const obs = (await nationalObservations(iso3)).filter((o) => o.indicator === indicator && !o.dwelling_type && o.frequency === "A" && o.status === "actual");
  return obs.at(-1) ?? null;
}

// ── Live layer ──
export type LiveShift = { shift: number; extra: number };
export type LiveEvent = { id: string; country: string; class: string; status: string; onset: string; last_seen: string; intensity: number; metric: string; evidence: string; source: string };
export type LiveState = { country: string; as_of: string; run_id: string; policy_rate_now: number | null; policy_rate_date: string | null; policy_rate_origin: number | null; rate_delta: number | null; events: { id: string; class: string; onset: string; intensity: number; metric: string; effect3?: number; n_episodes?: number }[]; shift10_price: number | null; shift10_rent: number | null; explanation: { kind: string; text: string }[] };
export type LiveLog = { id: number; date: string; country: string; kind: string; message: string; delta10: number | null };

export const liveStates = cache(async () => {
  const run = await latestRun();
  if (!run) return [] as LiveState[];
  // Live state is keyed to the stored run it was computed against (the snapshot run has none).
  const list = await rows<Omit<LiveState, "events" | "explanation"> & { events: string; explanation: string }>("SELECT * FROM live_state WHERE run_id = ?", [run.liveRunId ?? run.id]);
  return list.map((r) => ({ ...r, events: JSON.parse(r.events || "[]"), explanation: JSON.parse(r.explanation || "[]") })) as LiveState[];
});

export const liveState = cache(async (iso3: string) => (await liveStates()).find((s) => s.country === iso3) ?? null);

// Latest live shifts for one country (or all), keyed target → horizon.
export const liveShifts = cache(async (iso3?: string) => {
  const [latest] = await rows<{ as_of: string }>("SELECT MAX(as_of) AS as_of FROM live_adjustments");
  if (!latest?.as_of) return {} as Record<string, Record<string, Record<number, LiveShift>>>;
  const list = iso3
    ? await rows<{ country: string; target: string; horizon: number; shift: number; extra_se: number }>("SELECT country, target, horizon, shift, extra_se FROM live_adjustments WHERE as_of = ? AND country = ?", [latest.as_of, iso3])
    : await rows<{ country: string; target: string; horizon: number; shift: number; extra_se: number }>("SELECT country, target, horizon, shift, extra_se FROM live_adjustments WHERE as_of = ? AND target IN ('real_price', 'real_rent')", [latest.as_of]);
  const out: Record<string, Record<string, Record<number, LiveShift>>> = {};
  for (const r of list) ((out[r.country] ||= {})[r.target] ||= {})[r.horizon] = { shift: Number(r.shift), extra: Number(r.extra_se) };
  return out;
});

export const activeEvents = cache(() => rows<LiveEvent>("SELECT * FROM events WHERE status = 'active' ORDER BY intensity DESC"));
export const recentEvents = cache(() => rows<LiveEvent>("SELECT * FROM events ORDER BY last_seen DESC LIMIT 60"));
export const liveLog = cache(() => rows<LiveLog>("SELECT * FROM live_log ORDER BY date DESC, id DESC LIMIT 120"));

export const livePersonaRows = cache(async () => {
  const [latest] = await rows<{ as_of: string }>("SELECT MAX(as_of) AS as_of FROM persona_indexes_live");
  if (!latest?.as_of) return null;
  const list = await rows<Omit<PersonaRow, "components"> & { components: string }>("SELECT country, persona, score, rank, components FROM persona_indexes_live WHERE as_of = ? ORDER BY persona, rank", [latest.as_of]);
  return { asOf: latest.as_of, rows: list.map((r) => ({ ...r, components: JSON.parse(r.components) as IndexComponent[] })) };
});

export const eventLibrary = cache(async () => {
  const run = await latestRun();
  const snap = fromSnapshot<{ class: string; target: string; horizon: number; effect: number; se: number; n_episodes: number; episodes: string }>(run, "event_library");
  if (snap) return snap;
  return run ? rows<{ class: string; target: string; horizon: number; effect: number; se: number; n_episodes: number; episodes: string }>("SELECT class, target, horizon, effect, se, n_episodes, episodes FROM event_library WHERE run_id = ? ORDER BY class, target, horizon", [run.id]) : [];
});

// Apply live shifts (x100 log points) to an index band; projection bands are origin = 100.
export function applyLive<T extends { horizon: number; p10: number; p25: number; median: number; p75: number; p90: number }>(rows: T[], shifts: Record<number, LiveShift> | undefined): T[] {
  if (!shifts) return rows;
  const z80 = 1.2816, z50 = 0.6745, lg = (v: number) => 100 * Math.log(v / 100), ix = (v: number) => 100 * Math.exp(v / 100);
  return rows.map((r) => {
    const s = shifts[r.horizon];
    if (!s) return r;
    return { ...r, p10: ix(lg(r.p10) + s.shift - z80 * s.extra), p25: ix(lg(r.p25) + s.shift - z50 * s.extra), median: ix(lg(r.median) + s.shift), p75: ix(lg(r.p75) + s.shift + z50 * s.extra), p90: ix(lg(r.p90) + s.shift + z80 * s.extra) };
  });
}

// ── Data quality ──
export type QualityCheck = { run_at: string; check_id: string; category: string; severity: "pass" | "warn" | "fail" | "info"; summary: string; details: Record<string, unknown> };
export const qualityChecks = cache(async () => {
  const [latest] = await rows<{ run_at: string }>("SELECT run_at FROM data_quality WHERE check_id = 'coverage.tiers' ORDER BY run_at DESC LIMIT 1");
  if (!latest?.run_at) return { runAt: null as string | null, checks: [] as QualityCheck[], liveRunAt: null as string | null };
  const full = await rows<Omit<QualityCheck, "details"> & { details: string }>("SELECT * FROM data_quality WHERE run_at = ? ORDER BY category, check_id", [latest.run_at]);
  // Live checks also run daily on their own; show whichever is newer per check.
  const [liveLatest] = await rows<{ run_at: string }>("SELECT MAX(run_at) AS run_at FROM data_quality WHERE check_id LIKE 'live.%'");
  const live = liveLatest?.run_at && liveLatest.run_at > latest.run_at ? await rows<Omit<QualityCheck, "details"> & { details: string }>("SELECT * FROM data_quality WHERE run_at = ? AND check_id LIKE 'live.%'", [liveLatest.run_at]) : [];
  const merged = [...full.filter((c) => !(live.length && c.check_id.startsWith("live."))), ...live];
  return { runAt: latest.run_at, liveRunAt: live.length ? liveLatest!.run_at : null, checks: merged.map((c) => ({ ...c, details: JSON.parse(c.details) })) as QualityCheck[] };
});

// ── Public API / feeds helpers (read-only) ──
export const liveLogFor = cache((iso3: string) => rows<LiveLog>("SELECT * FROM live_log WHERE country = ? ORDER BY date DESC, id DESC LIMIT 60", [iso3]));
export const recentRuns = cache((limit = 12) => rows<{ id: string; created_at: string; model_version: string; data_vintage: string }>("SELECT id, created_at, model_version, data_vintage FROM projection_runs ORDER BY created_at DESC LIMIT ?", [limit]));
// Latest actual value of each national / regional series for one country (annual where present, else latest).
export const nationalLatest = cache(async (iso3: string) => {
  const obs = (await observations(iso3)).filter((o) => o.status === "actual" && (o.region || o.dwelling_type || ["AVG_PRICE", "MEDIAN_PRICE", "AVG_RENT", "AVG_RENT_2BR", "VACANCY_RATE", "HOUSING_STARTS", "NEW_HOUSING_PRICE", "MORTGAGE_RATE", "RENT_CPI", "SALES_COUNT", "MEDIAN_PSF", "DLD_PRICE_INDEX", "GROSS_YIELD", "MEDIAN_HH_INCOME", "UNEMPLOYMENT", "UNEMPLOYMENT_M", "DSR_HH", "POLICY_RATE", "HH_CREDIT", "PTI_AVG", "PTR_AVG", "INFLATION"].includes(o.indicator)));
  const latest = new Map<string, Observation>();
  for (const o of obs) {
    const key = `${o.indicator}|${o.region}|${o.dwelling_type}`;
    const prev = latest.get(key);
    if (!prev || o.period > prev.period) latest.set(key, o);
  }
  return [...latest.values()].map((o) => ({ indicator: o.indicator, region: o.region || null, dwellingType: o.dwelling_type || null, period: o.period, frequency: o.frequency, value: Number(o.value), source: o.source }));
});

// ── Track record and scenario sensitivities (engine wave 1) ──
export type BacktestPoint = { country: string; target: string; horizon: number; origin: number; predicted: number; actual: number; method: string };
export type VintageScore = { vintage_run_id: string; country: string; target: string; horizon: number; target_year: number; projected_median: number; p10: number; p90: number; actual: number; error: number; in80: number; scored_at: string };
export type FeatureSensitivity = { target: string; feature: string; horizon: number; coef: number; se: number; valid: number; note: string };

// Pseudo-out-of-sample backtest points of the latest run for one country (x100 log growth).
export const backtestPoints = cache(async (iso3: string) => {
  const run = await latestRun();
  const snap = fromSnapshot<BacktestPoint>(run, "backtest_points", (r) => r.country === iso3);
  if (snap) return snap;
  return run ? rows<BacktestPoint>("SELECT country, target, horizon, origin, predicted, actual, method FROM backtest_points WHERE run_id = ? AND country = ? ORDER BY target, horizon, origin", [run.id, iso3]) : [];
});

// Real track record: past vintages scored against outcomes (all countries, or one).
export const vintageScores = cache((iso3?: string) =>
  iso3
    ? rows<VintageScore>("SELECT * FROM vintage_scores WHERE country = ? ORDER BY target_year DESC, horizon", [iso3])
    : rows<VintageScore>("SELECT * FROM vintage_scores ORDER BY target_year DESC, country, horizon"),
);

// Headline track-record numbers: backtest hit rate of direction and mean absolute error per
// target/horizon (latest run), plus live vintage counts and 80%-band coverage once scored.
export const trackRecordSummary = cache(async () => {
  const run = await latestRun();
  const snapPts = fromSnapshot<BacktestPoint>(run, "backtest_points");
  const backtest = snapPts ? summariseBacktest(snapPts) : run ? await rows<{ target: string; horizon: number; n: number; mae: number; direction_hit: number; bias: number }>(
    `SELECT target, horizon, COUNT(*) AS n, AVG(ABS(actual - predicted)) AS mae,
            AVG(CASE WHEN (actual >= 0) = (predicted >= 0) THEN 1.0 ELSE 0.0 END) AS direction_hit,
            AVG(predicted - actual) AS bias
     FROM backtest_points WHERE run_id = ? GROUP BY target, horizon ORDER BY target, horizon`, [run.id]) : [];
  const live = await rows<{ target: string; horizon: number; n: number; mae: number; coverage80: number }>(
    `SELECT target, horizon, COUNT(*) AS n, AVG(ABS(error)) AS mae, AVG(in80) AS coverage80 FROM vintage_scores GROUP BY target, horizon ORDER BY target, horizon`);
  return { runId: run?.id ?? null, backtest, live };
});

// Same aggregates as the SQL in trackRecordSummary, for snapshot rows.
function summariseBacktest(pts: BacktestPoint[]) {
  const groups = new Map<string, BacktestPoint[]>();
  for (const p of pts) { const k = `${p.target}|${p.horizon}`; (groups.get(k) || groups.set(k, []).get(k)!).push(p); }
  return [...groups.values()].map((g) => ({
    target: g[0].target, horizon: g[0].horizon, n: g.length,
    mae: g.reduce((s, p) => s + Math.abs(p.actual - p.predicted), 0) / g.length,
    direction_hit: g.filter((p) => (p.actual >= 0) === (p.predicted >= 0)).length / g.length,
    bias: g.reduce((s, p) => s + p.predicted - p.actual, 0) / g.length,
  })).sort((a, b) => a.target.localeCompare(b.target) || a.horizon - b.horizon);
}

export const featureSensitivities = cache(async () => {
  const run = await latestRun();
  const snap = fromSnapshot<FeatureSensitivity>(run, "feature_sensitivity");
  if (snap) return snap;
  return run ? rows<FeatureSensitivity>("SELECT target, feature, horizon, coef, se, valid, note FROM feature_sensitivity WHERE run_id = ? ORDER BY target, feature, horizon", [run.id]) : [];
});

// ── Wave 2 product: regions, briefs, track record (read-only) ──
export const slugify = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Distinct regions with observations for one country, with their slugs and series counts.
export const regionsFor = cache(async (iso3: string) => {
  const list = await query<{ region: string; indicators: string }>("SELECT region, group_concat(DISTINCT indicator) AS indicators FROM observations WHERE country = ? AND region != '' GROUP BY region", [iso3]);
  const by = new Map(list.map((r) => [r.region, new Set(String(r.indicators).split(","))]));
  for (const o of overlayFor(iso3, (r) => !!r.region)) (by.get(o.region) || by.set(o.region, new Set()).get(o.region)!).add(o.indicator);
  return [...by].map(([name, ind]) => ({ name, slug: slugify(name), indicators: [...ind] })).sort((a, b) => a.name.localeCompare(b.name));
});

// All observations for one region, plus the national rows of the same indicators for comparison.
export const regionData = cache(async (iso3: string, slug: string) => {
  const region = (await regionsFor(iso3)).find((r) => r.slug === slug)?.name;
  if (!region) return null;
  const obs = await query<Observation>("SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations WHERE country = ? AND region IN (?, '') ORDER BY indicator, region, dwelling_type, period", [iso3, region]);
  const extra = overlayFor(iso3, (r) => r.region === region) as unknown as Observation[];
  const rows = [...obs.filter((o) => o.region === region), ...extra].map((o) => ({ ...o, value: Number(o.value) }));
  const indicators = new Set(rows.map((r) => r.indicator));
  const national = obs.filter((o) => !o.region && indicators.has(o.indicator)).map((o) => ({ ...o, value: Number(o.value) }));
  return { region, rows, national };
});

// Per-country backtest quality from pseudo-out-of-sample points (x100 log growth → %).
export const toPctChange = (logPts: number) => 100 * (Math.exp(logPts / 100) - 1);
export async function countryTrackRecord(iso3: string, target = "real_price", horizon = 1) {
  const pts = (await backtestPoints(iso3)).filter((p) => p.target === target && Number(p.horizon) === horizon)
    .map((p) => ({ origin: Number(p.origin), predicted: toPctChange(Number(p.predicted)), actual: toPctChange(Number(p.actual)), method: p.method }));
  if (!pts.length) return null;
  const mae = pts.reduce((s, p) => s + Math.abs(p.actual - p.predicted), 0) / pts.length;
  const hit = pts.filter((p) => (p.actual >= 0) === (p.predicted >= 0)).length / pts.length;
  return { points: pts, mae, hit, n: pts.length, first: pts[0].origin, last: pts.at(-1)!.origin };
}

// All backtest points of the latest run for a target/horizon, for the global scatter and country table.
export const allBacktestPoints = cache(async (target: string, horizon: number) => {
  const run = await latestRun();
  const snap = fromSnapshot<BacktestPoint>(run, "backtest_points", (r) => r.target === target && r.horizon === horizon);
  if (snap) return snap;
  return run ? rows<BacktestPoint>("SELECT country, target, horizon, origin, predicted, actual, method FROM backtest_points WHERE run_id = ? AND target = ? AND horizon = ? ORDER BY country, origin", [run.id, target, horizon]) : [];
});

// Latest live-layer runs (when the live page last updated, and by what).
export type LiveRun = { run_at: string; trigger: string; ok: number; countries: number | null; events: number | null; log_entries: number | null; seconds: number | null; error: string | null };
export const liveRuns = cache(() => rows<LiveRun>("SELECT * FROM live_runs ORDER BY run_at DESC LIMIT 10"));

// ── Cities: one summary row per city or region of a country (read-only) ──
// BIS city series carry aggregate labels ("7 cities", "whole country excluding ..."); those are
// not places and are left out of city listings. Names like "all dwellings. Rome" are cleaned.
const NOT_A_PLACE = /(^|\s)(cities|city area|whole country|excluding|rest of|non-urban|discontinued|big cities|capital area)(\s|$)|^\d+\s+cities$|^metropolitan area$|^cities$/i;
export const cleanPlaceName = (name: string) => name.replace(/^all dwellings\.\s*/i, "").trim();

export type CityMetric = { indicator: string; dwellingType: string; value: number; period: string; change1y: number | null; change5y: number | null; kind: "level" | "index" | "rate" | "count" };
export type CitySummary = { name: string; slug: string; price: CityMetric | null; rent: CityMetric | null; vacancy: CityMetric | null; sales: CityMetric | null; indicators: string[]; sources: string[] };

const PRICE_ORDER: [string, string, CityMetric["kind"]][] = [["AVG_PRICE", "", "level"], ["MEDIAN_PRICE", "", "level"], ["MEDIAN_PRICE", "house", "level"], ["TYPE_PRICE_LEVEL", "house", "level"], ["REGION_PRICE_INDEX", "", "index"], ["CASE_SHILLER_INDEX", "", "index"], ["CITY_PRICE", "", "index"], ["NEW_HOUSING_PRICE", "", "index"], ["TYPE_PRICE_INDEX", "house", "index"], ["ASSESSED_VALUE", "", "level"]];
const RENT_ORDER: [string, string][] = [["AVG_RENT", ""], ["AVG_RENT_2BR", ""], ["AVG_RENT", "condo"]];

export const citySummaries = cache(async (iso3: string): Promise<CitySummary[]> => {
  const code = iso3.toUpperCase();
  // Annual rows from 2014 are enough for latest, one-year and five-year changes and stay small.
  const [data, srcs] = await Promise.all([
    rows<{ region: string; indicator: string; dwelling_type: string; period: string; value: number }>(
      "SELECT region, indicator, dwelling_type, period, value FROM observations WHERE country = ? AND region != '' AND frequency = 'A' AND status = 'actual' AND period >= '2014' ORDER BY region, indicator, dwelling_type, period", [code]),
    rows<{ region: string; source: string }>("SELECT region, source FROM observations WHERE country = ? AND region != '' GROUP BY region, source", [code]),
  ]);
  const series = new Map<string, Map<string, { period: string; value: number }[]>>();
  const extra = overlayFor(code, (r) => !!r.region && r.frequency === "A" && r.period >= "2014");
  for (const r of extra) srcs.push({ region: r.region, source: r.source });
  for (const r of [...data, ...extra].sort((a, b) => a.region.localeCompare(b.region) || a.indicator.localeCompare(b.indicator) || String(a.period).localeCompare(String(b.period)))) {
    const byKey = series.get(r.region) || series.set(r.region, new Map()).get(r.region)!;
    const key = `${r.indicator}|${r.dwelling_type}`;
    (byKey.get(key) || byKey.set(key, []).get(key)!).push({ period: String(r.period), value: Number(r.value) });
  }
  const metric = (byKey: Map<string, { period: string; value: number }[]>, indicator: string, type: string, kind: CityMetric["kind"]): CityMetric | null => {
    const pts = byKey.get(`${indicator}|${type}`);
    if (!pts?.length) return null;
    const last = pts.at(-1)!;
    const back = (n: number) => pts.find((p) => Number(p.period) === Number(last.period) - n);
    const pct = (b?: { value: number }) => (b && b.value ? 100 * (last.value / b.value - 1) : null);
    const diff = (b?: { value: number }) => (b ? last.value - b.value : null);
    return { indicator, dwellingType: type, value: last.value, period: last.period, change1y: kind === "rate" ? diff(back(1)) : pct(back(1)), change5y: kind === "rate" ? diff(back(5)) : pct(back(5)), kind };
  };
  const sourceBy = new Map<string, Set<string>>();
  for (const s of srcs) (sourceBy.get(s.region) || sourceBy.set(s.region, new Set()).get(s.region)!).add(s.source.replace(/\s*\(.*$/, "").replace(/,.*$/, ""));
  const out: CitySummary[] = [];
  for (const [region, byKey] of series) {
    const name = cleanPlaceName(region);
    if (NOT_A_PLACE.test(name)) continue;
    const price = PRICE_ORDER.map(([i, t, k]) => metric(byKey, i, t, k)).find(Boolean) ?? null;
    const rent = RENT_ORDER.map(([i, t]) => metric(byKey, i, t, "level")).find(Boolean) ?? null;
    out.push({
      name, slug: slugify(region), price, rent,
      vacancy: metric(byKey, "VACANCY_RATE", "", "rate"),
      sales: metric(byKey, "SALES_COUNT", "", "count"),
      indicators: [...new Set([...byKey.keys()].map((k) => k.split("|")[0]))],
      sources: [...(sourceBy.get(region) ?? [])].sort(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

// ── Country notes: curated, sourced context (Turso table country_notes; the combined file in
// the repo stands in while the table is empty, e.g. when database writes were blocked) ──
export type NoteSource = { title: string; publisher?: string; url: string; date?: string };
export type CountryNote = { topic: string; effect: string; text: string; sources: NoteSource[] };
export const countryNotes = cache(async (iso3: string): Promise<{ asOf: string | null; notes: CountryNote[] }> => {
  const code = iso3.toUpperCase();
  try {
    const list = await rows<{ topic: string; effect: string; text: string; sources: string; as_of: string | null }>("SELECT topic, effect, text, sources, as_of FROM country_notes WHERE country = ? ORDER BY idx", [code]);
    if (list.length) return { asOf: list[0].as_of, notes: list.map((r) => ({ topic: r.topic, effect: r.effect, text: r.text, sources: JSON.parse(r.sources) })) };
  } catch { /* table not created yet */ }
  const file = (notesFallback as Record<string, { asOf: string; notes: CountryNote[] }>)[code];
  return file ? { asOf: file.asOf, notes: file.notes } : { asOf: null, notes: [] };
});
