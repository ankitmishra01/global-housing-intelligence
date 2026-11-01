#!/usr/bin/env node
// Trains the 10-year price and rent projections, risk flags and persona indexes from the
// observations in Turso, validates them, and writes a new versioned run.
// Run: node sync/train.js            (writes)
//      node sync/train.js --dry-run  (prints the backtest table only)
import { connect, upsertRows } from '../lib/db.js';
import { migrate } from '../db/migrate.js';
import { buildPanel, lastYear, latestMonthly, logGrowth } from '../lib/engine/panel.js';
import { trainEngine, validateEngineOutput, FEATURES, MODEL_VERSION } from '../lib/engine/projections.js';
import { computeFlags, quarterlyYoY, FLAG_RULES } from '../lib/engine/flags.js';
import { scoreAll, annuityFactor, PERSONAS } from '../lib/engine/indexes.js';
import { affordabilityMetrics, stressAll, STRESS_COMPONENTS } from '../lib/engine/affordability.js';
import { computeSignals, SIGNAL_LABELS, SIGNAL_DISCLAIMER } from '../lib/engine/signals.js';
import { runQuality, BLOCKING } from './quality.js';
import { finite, mean } from '../lib/engine/stats.js';
import { estimateEventLibrary, EVENT_CLASSES } from '../lib/engine/events.js';

const DRY_RUN = process.argv.includes('--dry-run');
// Projection origin: trailing 12 months to each country's latest BIS quarter when true, last
// calendar year when false. Tested 2026-11-01 against calendar on held-out origins (real price
// skill h1/h2/h3/h5: 25.2/16.6/16.7/13.3% vs 23.4/17.8/17.6/13.2%; type h1 8.5% vs 12.2%), so it
// failed the "no worse at h1-h5 than -0.5pp" rule. Calendar ships; the latest quarter is shown
// as an observed nowcast point (details.nowcast) instead.
export const TTM_ORIGIN = false;
export const MORTGAGE_SPREAD = 2.0; // assumed mortgage spread over the policy rate where no national series exists

export async function loadRows(db) {
  const { rows } = await db.execute(`SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations
    WHERE region = '' AND (frequency = 'A' OR indicator IN ('POLICY_RATE', 'MORTGAGE_RATE', 'REAL_PRICE', 'NOMINAL_PRICE', 'UNEMPLOYMENT_M', 'DSR_HH'))`);
  return rows.map(r => ({ ...r, value: Number(r.value) }));
}

// National levels the panel drops (it keeps national rows only): Canada's rent is the median
// of the latest CMHC two-bedroom rents across the tracked metros.
export async function loadNationalExtras(db) {
  const { rows } = await db.execute(`SELECT country, region, period, value FROM observations WHERE indicator = 'AVG_RENT_2BR' AND frequency = 'A' AND region != ''`);
  const byCountry = {};
  for (const r of rows) {
    const c = (byCountry[r.country] ||= {});
    if (!c.year || r.period > c.year) { c.year = r.period; c.values = []; }
    if (r.period === c.year) c.values.push(Number(r.value));
  }
  return Object.fromEntries(Object.entries(byCountry).map(([iso3, c]) => {
    const v = [...c.values].sort((a, b) => a - b);
    return [iso3, { rent: v[Math.floor(v.length / 2)], rentBasis: `median two-bedroom rent across ${v.length} CMHC metros, ${c.year}` }];
  }));
}

const annualMean = (monthly, year) => {
  const v = Object.entries(monthly || {}).filter(([p]) => p.startsWith(`${year}-`)).map(([, x]) => x);
  return v.length ? mean(v) : null;
};

export function countryComponents(iso3, c, monthly, ctx, flags) {
  const T = ctx.origin;
  const latestOf = key => { const y = lastYear(c[key]); return y ? c[key][y] : null; };
  const pti = latestOf('PTI_AVG'), ptr = latestOf('PTR_AVG');
  const ptiGap = finite(pti) ? pti - 100 : null, ptrGap = finite(ptr) ? ptr - 100 : null;
  const growth = []; for (let y = T; y > T - 15; y--) { const g = logGrowth(c.PRICE, y - 1, y); if (finite(g)) growth.push(g); }
  const volatility = growth.length >= 8 ? Math.sqrt(mean(growth.map(g => (g - mean(growth)) ** 2))) : null;
  const yoy = quarterlyYoY(monthly.REAL_PRICE_Q);
  const r0 = annualMean(monthly.POLICY_RATE, T), r3 = annualMean(monthly.POLICY_RATE, T - 3);
  const np = logGrowth(c.NPRICE, T - 3, T);
  const burden3y = finite(np) && finite(r0) && finite(r3) ? np + 100 * Math.log(annuityFactor(Math.max(0.1, r0 + MORTGAGE_SPREAD)) / annuityFactor(Math.max(0.1, r3 + MORTGAGE_SPREAD))) : null;
  const ry = lastYear(c.REAL_RENT);
  const rentGaps = ry ? [0, 1, 2, 3, 4].map(k => { const r = logGrowth(c.REAL_RENT, ry - k - 1, ry - k), g = c.GDP_PC_GROWTH?.[ry - k]; return finite(r) && finite(g) ? r - g : null; }).filter(finite) : [];
  const policy = latestMonthly(monthly.POLICY_RATE);
  return {
    proj10Price: ctx.realPriceCum?.[10] ?? null, proj3Price: ctx.realPriceCum?.[3] ?? null, proj10Rent: ctx.realRentCum?.[10] ?? null,
    ptiGap, ptrGap, valuation: [ptiGap, ptrGap].filter(finite).length ? mean([ptiGap, ptrGap].filter(finite)) : null,
    flagCount: flags.length, hhCredit: latestOf('HH_CREDIT'), volatility,
    momentum: yoy ? yoy.value : logGrowth(c.PRICE, T - 1, T), burden3y,
    rentVsIncome: rentGaps.length >= 3 ? mean(rentGaps) : null,
    rateTrend: policy && finite(policy.yearAgo) ? policy.value - policy.yearAgo : null,
  };
}

// Observed nowcast point: the latest BIS real-price quarter relative to the origin year's
// average (same base as the projection index, origin = 100). Only for BIS-priced countries.
export function latestQuarterVsOrigin(quarterly, origin, source) {
  if (!quarterly || source !== 'BIS') return null;
  const keys = Object.keys(quarterly).sort();
  const last = keys.at(-1);
  const base = keys.filter(k => k.startsWith(`${origin}-Q`)).map(k => quarterly[k]);
  if (!last || base.length !== 4 || Number(last.slice(0, 4)) <= origin) return null;
  const index = (100 * quarterly[last]) / mean(base);
  return { quarter: last, index: +index.toFixed(3), changePct: +(index - 100).toFixed(2) };
}

export function buildRun(rows, now = new Date(), { national = {}, ttm = TTM_ORIGIN } = {}) {
  const built = buildPanel(rows, { ttm });
  const engine = trainEngine(built);
  validateEngineOutput(engine);
  const flags = [], components = {}, contexts = [];
  // Affordability and mortgage stress first: stress ranks need every country's metrics.
  const metrics = Object.fromEntries(Object.keys(engine.contexts).map(iso3 => [iso3, affordabilityMetrics(built.panel[iso3], built.monthly[iso3] || {}, national[iso3] || {})]));
  const stress = stressAll(metrics);
  const stressBy = Object.fromEntries(stress.rows.map(r => [r.country, r]));
  for (const [iso3, ctx] of Object.entries(engine.contexts)) {
    const c = built.panel[iso3], monthly = built.monthly[iso3] || {};
    const f = computeFlags(iso3, c, monthly, { ...metrics[iso3], stressScore: stressBy[iso3]?.score ?? null });
    flags.push(...f);
    components[iso3] = countryComponents(iso3, c, monthly, ctx, f);
    const policy = latestMonthly(monthly.POLICY_RATE), mortgage = latestMonthly(monthly.MORTGAGE_RATE);
    const nowcast = latestQuarterVsOrigin(monthly.REAL_PRICE_Q, ctx.origin, c.PRICE_SOURCE);
    const originLabel = c.TTM ? `12 months to ${c.TTM.latest}` : String(ctx.origin);
    contexts.push({
      country: iso3, origin_year: ctx.origin, rent_origin_year: ctx.rentOrigin ?? null,
      policy_rate: policy?.value ?? null, policy_rate_as_of: policy?.period ?? null,
      mortgage_rate: mortgage ? mortgage.value : policy ? Math.max(0.1, policy.value + MORTGAGE_SPREAD) : null,
      mortgage_rate_source: mortgage ? (iso3 === 'CAN' ? 'Bank of Canada 5-year conventional mortgage' : iso3 === 'USA' ? 'Freddie Mac 30-year fixed' : 'national series') : policy ? `policy rate + ${MORTGAGE_SPREAD.toFixed(1)}pp assumed spread` : null,
      details: JSON.stringify({ originLabel, originQuarter: c.TTM?.quarter ?? null, rentOriginLabel: ctx.rentOrigin ? String(ctx.rentOrigin) : null, nowcast, components: components[iso3], rateSens: ctx.rateSens ?? null, affordability: metrics[iso3], stress: stressBy[iso3] ?? null, inflation: ctx.inflation, priceSource: ctx.priceSource, types: Object.fromEntries(Object.entries(ctx.types || {}).map(([t, v]) => [t, { origin: v.origin, source: v.source }])) }),
    });
  }
  const { rows: indexRows, distributions } = scoreAll(components);
  // Market signals per persona, from index scores, stress and flags; stored in details.
  for (const ctx of contexts) {
    const mine = indexRows.filter(r => r.country === ctx.country);
    const signals = computeSignals({
      scores: Object.fromEntries(mine.map(r => [r.persona, r.score])),
      components: Object.fromEntries(mine.map(r => [r.persona, r.components])),
      flags: flags.filter(f => f.country === ctx.country).map(f => f.flag),
      stress: stressBy[ctx.country] ?? null,
    });
    ctx.details = JSON.stringify({ ...JSON.parse(ctx.details), signals });
  }
  const eventLibrary = estimateEventLibrary({ records: engine.backtestRecords });
  const id = `run_${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const dataVintage = rows.reduce((m, r) => (r.frequency === 'A' && r.status !== 'forecast' && r.period > m ? r.period : m), '');
  const summary = {
    modelVersion: MODEL_VERSION, latestYear: engine.latestYear, units: engine.units, features: FEATURES, flagRules: FLAG_RULES,
    personas: PERSONAS, distributions, mortgageSpread: MORTGAGE_SPREAD, eventClasses: EVENT_CLASSES,
    featureSensitivities: engine.featureSensitivities, originMode: ttm ? 'trailing 12 months to latest quarter' : 'calendar year',
    stressComponents: STRESS_COMPONENTS, stressDistributions: stress.distributions, signalLabels: SIGNAL_LABELS, signalDisclaimer: SIGNAL_DISCLAIMER,
    uncertainty: 'Empirical rolling-origin residual quantiles per horizon, held non-decreasing with distance. p25-p75 is the 50% band, p10-p90 the 80% band.',
    limits: [
      'Tier 1 covers about 58 economies with official house price indexes; rents exist for about 43.',
      'Ten-year backtests rest on far fewer origins than one-year backtests; check n_origins on the methodology page.',
      'Rate sensitivity is pooled across countries and is a model-implied association, not a causal estimate.',
      'Projections start from the last complete calendar year; the latest quarter is shown as an observed point (a trailing-12-month origin was tested and did not beat calendar origins on held-out years).',
      'Dwelling-type paths use a separate pooled model trained on the type series; coverage varies by country.',
      'Nominal paths use IMF WEO inflation forecasts, held flat after the last WEO year.',
      'Projections are not financial advice.',
    ],
  };
  return { id, dataVintage, engine, flags, contexts, indexRows, eventLibrary, summary };
}

// Run-keyed tables pruned together. A run is kept if it is among the latest KEEP_LATEST or the
// last run of its calendar month (one per month is kept forever for the track record).
const RUN_TABLES = ['projections', 'backtests', 'rate_sensitivity', 'risk_flags', 'persona_indexes', 'country_context', 'event_library', 'feature_sensitivity', 'backtest_points'];
export const KEEP_LATEST = 10;
export function runsToPrune(runs) {
  const sorted = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const keep = new Set(sorted.slice(0, KEEP_LATEST).map(r => r.id));
  const monthLast = new Map();
  for (const r of sorted) if (!monthLast.has(r.created_at.slice(0, 7))) monthLast.set(r.created_at.slice(0, 7), r.id);
  for (const id of monthLast.values()) keep.add(id);
  return sorted.filter(r => !keep.has(r.id)).map(r => r.id);
}

// Score past runs' projections whose target year is now observed (index, origin = 100).
export function scoreVintages({ projections, contexts, panel, scoredAt }) {
  const out = [];
  const ctxBy = new Map(contexts.map(c => [`${c.run_id}|${c.country}`, c]));
  for (const p of projections) {
    if (p.target !== 'real_price' && p.target !== 'real_rent') continue;
    const ctx = ctxBy.get(`${p.run_id}|${p.country}`);
    let details = {};
    try { details = typeof ctx?.details === 'string' ? JSON.parse(ctx.details) : ctx?.details || {}; } catch { /* old rows */ }
    if (details.originQuarter) continue; // trailing-12-month vintages need the matching TTM series
    const series = p.target === 'real_price' ? panel[p.country]?.PRICE : panel[p.country]?.REAL_RENT;
    const origin = Number(p.year) - Number(p.horizon);
    if (!series || !finite(series[origin]) || !finite(series[p.year])) continue;
    const actual = (100 * series[p.year]) / series[origin];
    out.push({ vintage_run_id: p.run_id, country: p.country, target: p.target, horizon: Number(p.horizon), target_year: Number(p.year),
      projected_median: Number(p.median), p10: Number(p.p10), p90: Number(p.p90), actual: +actual.toFixed(3), error: +(actual - Number(p.median)).toFixed(3),
      in80: actual >= Number(p.p10) && actual <= Number(p.p90) ? 1 : 0, scored_at: scoredAt });
  }
  return out;
}

async function main() {
  const db = connect();
  await migrate(db);
  const rows = await loadRows(db);
  const national = await loadNationalExtras(db);
  console.log(`Loaded ${rows.length} observations`);
  const run = buildRun(rows, new Date(), { national });
  console.log('\nTarget        H  Method                          MAE   Zero MAE  Skill   80% cov  Origins');
  for (const b of run.engine.backtests) console.log(`${b.target.padEnd(12)} ${String(b.horizon).padStart(2)}  ${b.method.padEnd(30)} ${String(b.mae).padStart(6)}  ${String(b.baseline_mae).padStart(8)}  ${String(b.skill_pct).padStart(5)}%  ${String(b.coverage80).padStart(6)}%  ${b.n_origins}`);
  console.log('\nRate sensitivity per +1pp (log points x100):');
  for (const s of run.engine.sensitivities.filter(s => [1, 3, 5, 10].includes(s.horizon))) console.log(`  ${s.target.padEnd(12)} h${String(s.horizon).padEnd(2)} ${String(s.coef).padStart(8)} ± ${s.se}  ${s.valid ? '' : 'DISABLED'}`);
  console.log('\nEvent library (x100 log points vs model, shrunk):');
  for (const e of run.eventLibrary) console.log(`  ${e.class.padEnd(18)} ${e.target.padEnd(10)} h${e.horizon} ${String(e.effect).padStart(8)} ± ${String(e.se).padEnd(6)} n=${e.n_episodes}${e.pooled ? ' (pooled fallback)' : ''}`);
  console.log(`\n${new Set(run.engine.projections.map(p => p.country)).size} countries projected, ${run.flags.length} flags, ${run.indexRows.length} index scores`);
  if (DRY_RUN) return;

  await upsertRows(db, 'projection_runs', ['id', 'created_at', 'model_version', 'data_vintage', 'summary'], [{ id: run.id, created_at: new Date().toISOString(), model_version: MODEL_VERSION, data_vintage: run.dataVintage, summary: JSON.stringify(run.summary) }]);
  const withRun = list => list.map(r => ({ ...r, run_id: run.id }));
  const yearOf = p => run.contexts.find(c => c.country === p.country);
  await upsertRows(db, 'projections', ['run_id', 'country', 'target', 'year', 'horizon', 'p10', 'p25', 'median', 'p75', 'p90', 'method'],
    withRun(run.engine.projections.map(p => {
      const ctx = yearOf(p), t = p.target.split(':')[1];
      const origin = p.target.includes('rent') && ctx.rent_origin_year ? ctx.rent_origin_year : t ? JSON.parse(ctx.details).types[t]?.origin ?? ctx.origin_year : ctx.origin_year;
      return { ...p, year: origin + p.horizon };
    })));
  await upsertRows(db, 'backtests', ['run_id', 'target', 'horizon', 'method', 'status', 'mae', 'rmse', 'baseline_mae', 'baseline_rmse', 'skill_pct', 'coverage80', 'n_origins', 'n_records', 'basis'], withRun(run.engine.backtests));
  await upsertRows(db, 'rate_sensitivity', ['run_id', 'target', 'horizon', 'coef', 'se', 'valid', 'note'], withRun(run.engine.sensitivities));
  await upsertRows(db, 'risk_flags', ['run_id', 'country', 'flag', 'value', 'threshold', 'as_of'], withRun(run.flags));
  await upsertRows(db, 'persona_indexes', ['run_id', 'country', 'persona', 'score', 'rank', 'components'], withRun(run.indexRows.map(r => ({ ...r, components: JSON.stringify(r.components) }))));
  await upsertRows(db, 'country_context', ['run_id', 'country', 'origin_year', 'rent_origin_year', 'policy_rate', 'policy_rate_as_of', 'mortgage_rate', 'mortgage_rate_source', 'details'], withRun(run.contexts));
  await upsertRows(db, 'event_library', ['run_id', 'class', 'target', 'horizon', 'effect', 'se', 'n_episodes', 'episodes'], withRun(run.eventLibrary));
  await upsertRows(db, 'feature_sensitivity', ['run_id', 'target', 'feature', 'horizon', 'coef', 'se', 'valid', 'note'], withRun(run.engine.featureSensitivities));
  await upsertRows(db, 'backtest_points', ['run_id', 'country', 'target', 'horizon', 'origin', 'predicted', 'actual', 'method'], withRun(run.engine.backtestPoints));
  console.log(`Wrote ${run.id}`);

  // Track record: score every stored past run whose target years are now observed.
  const past = await db.execute({ sql: "SELECT run_id, country, target, year, horizon, median, p10, p90 FROM projections WHERE run_id != ? AND target IN ('real_price', 'real_rent')", args: [run.id] });
  const pastCtx = await db.execute({ sql: 'SELECT run_id, country, details FROM country_context WHERE run_id != ?', args: [run.id] });
  const scored = scoreVintages({ projections: past.rows, contexts: pastCtx.rows, panel: buildPanel(rows, { ttm: false }).panel, scoredAt: new Date().toISOString() });
  await upsertRows(db, 'vintage_scores', ['vintage_run_id', 'country', 'target', 'horizon', 'target_year', 'projected_median', 'p10', 'p90', 'actual', 'error', 'in80', 'scored_at'], scored);
  console.log(`Track record: ${run.engine.backtestPoints.length} backtest points, ${scored.length} vintage projections scored`);

  // Retention: latest runs plus one per calendar month, forever.
  const runs = (await db.execute('SELECT id, created_at FROM projection_runs')).rows;
  const prune = runsToPrune(runs);
  if (prune.length) {
    const ph = prune.map(() => '?').join(',');
    await db.batch([
      ...RUN_TABLES.map(t => ({ sql: `DELETE FROM ${t} WHERE run_id IN (${ph})`, args: prune })),
      { sql: `DELETE FROM vintage_scores WHERE vintage_run_id IN (${ph})`, args: prune },
      { sql: `DELETE FROM projection_runs WHERE id IN (${ph})`, args: prune },
    ], 'write');
    console.log(`Retention: pruned ${prune.length} intra-month runs (kept latest ${KEEP_LATEST} + one per month)`);
  }
  // Full data quality pass on the new run. Only integrity failures stop the pipeline.
  const quality = await runQuality({ db });
  const counts = Object.fromEntries(['pass', 'warn', 'fail'].map(k => [k, quality.checks.filter(c => c.severity === k).length]));
  console.log(`Data quality: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail`);
  for (const c of quality.checks.filter(c => c.severity !== 'pass')) console.log(`  ${c.severity.toUpperCase()} ${c.id}: ${c.summary}`);
  const blocking = quality.checks.filter(c => c.severity === 'fail' && BLOCKING.has(c.id));
  if (blocking.length) { console.error(`Integrity checks failed: ${blocking.map(c => c.id).join(', ')}`); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.stack || error); process.exit(1); });
