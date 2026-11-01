#!/usr/bin/env node
// Data quality checks over the observations and every derived output in Turso.
// Run:  node sync/quality.js            (all checks, writes data_quality)
//       node sync/quality.js --live     (live-layer checks only)
//       node sync/quality.js --dry-run  (print only)
// Each check returns { id, category, severity: 'pass'|'warn'|'fail', summary, details }.
// 'fail' is reserved for integrity failures that make published numbers wrong.
import { connect, upsertRows } from '../lib/db.js';
import { migrate } from '../db/migrate.js';
import { buildPanel, lastYear, logGrowth, HYPERINFLATION_PCT } from '../lib/engine/panel.js';
import { RANGES, COVERAGE_GATES } from '../lib/validate.js';
import { finite, mean } from '../lib/engine/stats.js';

const KEEP_RUNS = 30;
const check = (id, category, severity, summary, details = {}) => ({ id, category, severity, summary, details });
const worst = list => (list.some(s => s === 'fail') ? 'fail' : list.some(s => s === 'warn') ? 'warn' : 'pass');

// ── Pure helpers (tested) ──

// Internal gaps in an annual series: years missing between first and last observation.
export function annualGaps(series) {
  const ys = Object.keys(series || {}).map(Number).filter(y => finite(series[y])).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ys.length; i++) for (let y = ys[i - 1] + 1; y < ys[i]; y++) gaps.push(y);
  return gaps;
}

// Year-on-year moves beyond ±limit percent in an annual index.
export function bigJumps(series, limit = 30) {
  const out = [];
  for (const y of Object.keys(series || {}).map(Number).sort((a, b) => a - b)) {
    const prev = series[y - 1], cur = series[y];
    if (finite(prev) && finite(cur) && prev > 0) {
      const pct = 100 * (cur / prev - 1);
      if (Math.abs(pct) > limit) out.push({ year: y, pct: +pct.toFixed(1) });
    }
  }
  return out;
}

// Pearson correlation of annual log growth over overlapping years.
export function growthCorrelation(a, b, minYears = 8) {
  const xs = [], ys = [];
  for (const y of Object.keys(a || {}).map(Number)) {
    const ga = logGrowth(a, y - 1, y), gb = logGrowth(b, y - 1, y);
    if (finite(ga) && finite(gb)) { xs.push(ga); ys.push(gb); }
  }
  if (xs.length < minYears) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n: xs.length, meanGapPct: +(mx - my).toFixed(2) };
}

// Months between a period (YYYY, YYYY-Qn, YYYY-MM or YYYY-MM-DD) end and `now`.
export function monthsOld(period, now = new Date()) {
  const p = String(period);
  let y = Number(p.slice(0, 4)), m = 12;
  if (/-Q[1-4]$/.test(p)) m = Number(p.slice(-1)) * 3;
  else if (/^\d{4}-\d{2}/.test(p)) m = Number(p.slice(5, 7));
  return (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
}

// Freshness tolerance by frequency, in months after the period ends.
export const FRESHNESS_MONTHS = { A: 22, Q: 9, M: 5 };

// Projection rows: finite and ordered quantiles.
export function bandIntegrity(rows) {
  const bad = [];
  for (const r of rows) {
    const q = [r.p10, r.p25, r.median, r.p75, r.p90].map(Number);
    if (!q.every(finite)) bad.push({ ...pick(r), reason: 'non-finite' });
    else if (!(q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3] && q[3] <= q[4])) bad.push({ ...pick(r), reason: 'unordered' });
  }
  return bad;
}
const pick = r => ({ country: r.country, target: r.target, horizon: Number(r.horizon) });

// Band width (p90 − p10 in log points) must not shrink with horizon.
export function bandNarrowing(rows) {
  const by = new Map();
  for (const r of rows) (by.get(`${r.country}|${r.target}`) || by.set(`${r.country}|${r.target}`, []).get(`${r.country}|${r.target}`)).push(r);
  const out = [];
  for (const [key, list] of by) {
    list.sort((a, b) => a.horizon - b.horizon);
    let prev = -Infinity;
    for (const r of list) {
      const w = 100 * Math.log(r.p90 / r.p10);
      if (w < prev - 0.05) { out.push({ key, horizon: Number(r.horizon), width: +w.toFixed(2), previous: +prev.toFixed(2) }); break; }
      prev = w;
    }
  }
  return out;
}

// Tier rule: Tier 1 iff ≥8 annual headline price points exist.
export function tierMismatches(countries, priceYears) {
  return countries.filter(c => (Number(c.tier) === 1) !== ((priceYears[c.iso3] || 0) >= 8))
    .map(c => ({ iso3: c.iso3, tier: Number(c.tier), priceYears: priceYears[c.iso3] || 0 }));
}

// ── Loader ──

async function all(db, sql, args = []) {
  try { return (await db.execute({ sql, args })).rows.map(r => ({ ...r })); }
  catch (e) { if (String(e).includes('no such table')) return []; throw e; }
}

async function loadState(db, { live = false } = {}) {
  const run = (await all(db, 'SELECT * FROM projection_runs ORDER BY created_at DESC LIMIT 1'))[0];
  const state = { run };
  state.liveState = await all(db, 'SELECT * FROM live_state');
  state.events = await all(db, "SELECT * FROM events WHERE status = 'active'");
  state.signals = await all(db, 'SELECT signal, country, MAX(date) AS latest FROM live_signals GROUP BY signal, country');
  state.liveAdj = await all(db, 'SELECT country, target, horizon, shift, extra_se FROM live_adjustments WHERE as_of = (SELECT MAX(as_of) FROM live_adjustments)');
  state.library = run ? await all(db, 'SELECT * FROM event_library WHERE run_id = ?', [run.id]) : [];
  if (live) return state;
  state.countries = await all(db, 'SELECT * FROM countries');
  state.rows = (await all(db, `SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations
    WHERE region = '' AND (frequency = 'A' OR indicator IN ('POLICY_RATE', 'MORTGAGE_RATE', 'REAL_PRICE', 'NOMINAL_PRICE', 'UNEMPLOYMENT_M', 'DSR_HH'))`)).map(r => ({ ...r, value: Number(r.value) }));
  state.latest = await all(db, `SELECT indicator, frequency, country, MAX(period) AS latest FROM observations WHERE region = '' AND status = 'actual' GROUP BY indicator, frequency, country`);
  state.projections = run ? (await all(db, 'SELECT country, target, horizon, p10, p25, median, p75, p90 FROM projections WHERE run_id = ?', [run.id])).map(r => ({ ...r, horizon: Number(r.horizon), p10: Number(r.p10), p25: Number(r.p25), median: Number(r.median), p75: Number(r.p75), p90: Number(r.p90) })) : [];
  state.contexts = run ? (await all(db, 'SELECT * FROM country_context WHERE run_id = ?', [run.id])).map(r => ({ ...r, details: JSON.parse(r.details) })) : [];
  state.personas = run ? await all(db, 'SELECT country, persona, score FROM persona_indexes WHERE run_id = ?', [run.id]) : [];
  return state;
}

// ── Checks ──

function liveChecks(s, now) {
  const out = [];
  const asOf = s.liveState.map(r => r.as_of).sort().at(-1);
  const ageDays = asOf ? Math.round((now - new Date(`${asOf}T00:00:00Z`)) / 864e5) : null;
  out.push(check('live.freshness', 'Live layer', asOf == null ? 'warn' : ageDays > 2 ? 'warn' : 'pass',
    asOf ? `Live state as of ${asOf} (${ageDays} day${ageDays === 1 ? '' : 's'} old), ${s.liveState.length} countries` : 'Live layer has not run', { asOf, countries: s.liveState.length }));
  const conflictLatest = s.signals.filter(r => r.signal === 'conflict_mentions').map(r => r.latest).sort().at(-1);
  const cAge = conflictLatest ? Math.round((now - new Date(`${conflictLatest}T00:00:00Z`)) / 864e5) : null;
  out.push(check('live.gdelt', 'Live layer', cAge == null || cAge > 4 ? 'warn' : 'pass', conflictLatest ? `GDELT conflict signal through ${conflictLatest} (${cAge} days old)` : 'No GDELT history', { latest: conflictLatest }));
  const rates = s.signals.filter(r => r.signal === 'policy_rate');
  const staleRates = rates.filter(r => (now - new Date(`${r.latest}T00:00:00Z`)) / 864e5 > 21).map(r => `${r.country} ${r.latest}`);
  out.push(check('live.policy_rates', 'Live layer', staleRates.length > rates.length / 4 ? 'warn' : 'pass',
    `${rates.length} daily policy rates; ${staleRates.length} older than 3 weeks`, { stale: staleRates }));
  const big = s.liveAdj.filter(r => Math.abs(Number(r.shift)) > 45 || !finite(Number(r.shift)) || !finite(Number(r.extra_se)));
  out.push(check('live.adjustments', 'Live layer', big.length ? 'fail' : 'pass', big.length ? `${big.length} live shifts non-finite or beyond ±45 log points` : `${s.liveAdj.length} live shifts, all finite and within ±45`, { examples: big.slice(0, 10) }));
  const noEvidence = s.events.filter(e => { try { return !Object.keys(JSON.parse(e.evidence || '{}')).length; } catch { return true; } });
  out.push(check('live.events', 'Live layer', noEvidence.length ? 'warn' : 'pass', `${s.events.length} active events; ${noEvidence.length} without evidence`, { active: s.events.map(e => `${e.country}:${e.class}`) }));
  const thin = s.library.filter(r => Number(r.n_episodes) < 3 || !(Number(r.se) > 0));
  out.push(check('live.event_library', 'Live layer', s.library.length === 0 ? 'warn' : thin.length ? 'warn' : 'pass',
    s.library.length ? `${s.library.length} event-library rows; ${thin.length} with fewer than 3 episodes or zero se` : 'Event library empty for the latest run', { thin: thin.map(r => `${r.class}/${r.target}/h${r.horizon} n=${r.n_episodes}`) }));
  return out;
}

function fullChecks(s, now) {
  const out = [];
  const { panel, monthly } = buildPanel(s.rows);
  const tier1 = s.countries.filter(c => Number(c.tier) === 1);

  // Coverage
  const counts = {};
  for (const r of s.latest) if (r.frequency === 'A' || !counts[r.indicator]) (counts[r.indicator] ||= new Set()).add(r.country);
  const gateRows = Object.entries(COVERAGE_GATES).map(([k, min]) => ({ indicator: k, countries: counts[k]?.size || 0, min }));
  const gateFail = gateRows.filter(g => g.countries < g.min);
  out.push(check('coverage.gates', 'Coverage', gateFail.length ? 'warn' : 'pass', gateFail.length ? `${gateFail.length} indicators below their coverage gate` : `All ${gateRows.length} gated indicators meet coverage`, { gates: gateRows }));

  const priceYears = Object.fromEntries(Object.entries(panel).map(([iso3, c]) => [iso3, Object.keys(c.PRICE || {}).length]));
  const mism = tierMismatches(s.countries, priceYears);
  out.push(check('coverage.tiers', 'Coverage', mism.length ? 'fail' : 'pass', mism.length ? `${mism.length} countries' tier disagrees with their price history` : `${tier1.length} Tier 1 and ${s.countries.length - tier1.length} Tier 2 economies; tiers match price history`, { mismatches: mism }));

  const noInfl = tier1.filter(c => !Object.keys(panel[c.iso3]?.INFLATION || {}).length).map(c => c.iso3);
  out.push(check('coverage.inflation', 'Coverage', noInfl.length ? 'warn' : 'pass', noInfl.length ? `${noInfl.length} Tier 1 economies lack inflation (real rents/types cannot be built)` : 'Every Tier 1 economy has an inflation series', { missing: noInfl }));

  const gaps = [];
  for (const c of tier1) for (const key of ['PRICE', 'RENT', 'PTI_AVG']) {
    const g = annualGaps(panel[c.iso3]?.[key]);
    if (g.length) gaps.push({ iso3: c.iso3, series: key, missingYears: g.length, sample: g.slice(0, 5) });
  }
  out.push(check('coverage.gaps', 'Coverage', gaps.length ? 'warn' : 'pass', gaps.length ? `${gaps.length} headline series have missing years inside their span` : 'No internal gaps in headline annual series', { gaps }));

  // Freshness
  const latestBy = {};
  for (const r of s.latest) { const k = `${r.indicator}|${r.frequency}`; if (!latestBy[k] || r.latest > latestBy[k].latest) latestBy[k] = { indicator: r.indicator, frequency: r.frequency, latest: r.latest }; }
  const fresh = Object.values(latestBy).map(r => ({ ...r, monthsOld: monthsOld(r.latest, now), stale: monthsOld(r.latest, now) > FRESHNESS_MONTHS[r.frequency] }));
  const staleSources = fresh.filter(r => r.stale);
  out.push(check('freshness.sources', 'Freshness', staleSources.length ? 'warn' : 'pass', staleSources.length ? `${staleSources.length} series are older than their frequency allows` : `All ${fresh.length} series are current for their frequency`, { series: fresh.sort((a, b) => a.indicator.localeCompare(b.indicator)) }));

  const maxOrigin = Math.max(...s.contexts.map(c => Number(c.origin_year)));
  const staleOrigins = [
    ...s.contexts.filter(c => Number(c.origin_year) <= maxOrigin - 2).map(c => ({ iso3: c.country, series: 'price', origin: Number(c.origin_year) })),
    ...s.contexts.filter(c => c.rent_origin_year != null && Number(c.rent_origin_year) <= maxOrigin - 2).map(c => ({ iso3: c.country, series: 'rent', origin: Number(c.rent_origin_year) })),
  ];
  out.push(check('freshness.origins', 'Freshness', staleOrigins.length ? 'warn' : 'pass', staleOrigins.length ? `${staleOrigins.length} price or rent paths start 2+ years before ${maxOrigin}: ${staleOrigins.map(o => `${o.iso3} ${o.series} ${o.origin}`).join(', ')}` : `Every projection starts in ${maxOrigin - 1} or later`, { stale: staleOrigins, maxOrigin }));

  const headlineLag = [];
  for (const c of tier1) {
    const q = Object.keys(monthly[c.iso3]?.REAL_PRICE_Q || {}).sort().at(-1);
    const y = lastYear(panel[c.iso3]?.PRICE);
    const latest = q || (y ? String(y) : null);
    if (latest && monthsOld(latest, now) > 12) headlineLag.push({ iso3: c.iso3, latest });
  }
  out.push(check('freshness.headline_prices', 'Freshness', headlineLag.length ? 'warn' : 'pass', headlineLag.length ? `${headlineLag.length} Tier 1 price series have nothing in the last 12 months` : 'Every Tier 1 price series has a reading within 12 months', { lagging: headlineLag }));

  // Validity
  const outOfRange = s.rows.filter(r => RANGES[r.indicator] && (r.value < RANGES[r.indicator][0] || r.value > RANGES[r.indicator][1]));
  out.push(check('validity.ranges', 'Validity', outOfRange.length ? 'fail' : 'pass', outOfRange.length ? `${outOfRange.length} stored values outside plausible ranges` : 'All stored values within plausible ranges', { examples: outOfRange.slice(0, 10) }));

  const jumps = [];
  for (const c of tier1) for (const key of ['PRICE', 'REAL_RENT']) for (const j of bigJumps(panel[c.iso3]?.[key])) if (j.year >= 1990) jumps.push({ iso3: c.iso3, series: key, ...j });
  out.push(check('validity.jumps', 'Validity', jumps.length > 30 ? 'warn' : 'pass', jumps.length ? `${jumps.length} real price/rent moves beyond ±30% in a year since 1990 (reviewed: booms and busts such as the Baltics 2005–09, Hong Kong 1997–98, Türkiye 2022–24; kept)` : 'No real price or rent move beyond ±30% in a year since 1990', { jumps }));

  const nonPos = s.rows.filter(r => /PRICE|RENT/.test(r.indicator) && r.value <= 0);
  out.push(check('validity.nonpositive', 'Validity', nonPos.length ? 'fail' : 'pass', nonPos.length ? `${nonPos.length} zero or negative price/rent values` : 'No zero or negative price or rent values', { examples: nonPos.slice(0, 10) }));

  // Consistency
  const corr = [];
  for (const c of tier1) {
    const p = panel[c.iso3];
    if (p?.REAL_PRICE && p?.OECD_REAL_PRICE) { const g = growthCorrelation(p.REAL_PRICE, p.OECD_REAL_PRICE); if (g) corr.push({ iso3: c.iso3, ...g, r: g.r == null ? null : +g.r.toFixed(2) }); }
  }
  const lowCorr = corr.filter(x => x.r != null && x.r < 0.7);
  out.push(check('consistency.bis_oecd', 'Consistency', lowCorr.length ? 'warn' : 'pass', `BIS vs OECD real price growth: ${corr.length} countries compared, median r ${corr.length ? [...corr].sort((a, b) => a.r - b.r)[Math.floor(corr.length / 2)].r : '–'}, ${lowCorr.length} below 0.7`, { low: lowCorr, all: corr }));

  const nationalPairs = [
    { iso3: 'GBR', a: 'NOMINAL_PRICE', b: 'AVG_PRICE', label: 'UK BIS nominal vs Land Registry average' },
    { iso3: 'USA', a: 'NOMINAL_PRICE', b: 'MEDIAN_PRICE', label: 'US BIS nominal vs Census median sales price' },
    { iso3: 'CAN', a: 'NOMINAL_PRICE', b: 'NEW_HOUSING_PRICE', label: 'Canada BIS nominal vs StatCan new housing (new homes only)' },
    { iso3: 'AUS', a: 'NOMINAL_PRICE', b: 'AVG_PRICE', label: 'Australia BIS nominal vs ABS mean dwelling price' },
  ];
  const nat = nationalPairs.map(pr => { const g = growthCorrelation(panel[pr.iso3]?.[pr.a], panel[pr.iso3]?.[pr.b], 6); return { ...pr, r: g?.r == null ? null : +g.r.toFixed(2), n: g?.n ?? 0, meanGapPct: g?.meanGapPct ?? null }; });
  out.push(check('consistency.national', 'Consistency', nat.some(x => x.r != null && x.r < 0.5 && x.iso3 !== 'CAN') ? 'warn' : 'pass', nat.map(x => `${x.iso3} r=${x.r ?? '–'} (n=${x.n})`).join(' · '), { pairs: nat }));

  const inflGap = [];
  for (const [iso3, c] of Object.entries(panel)) for (const [y, v] of Object.entries(c.INFLATION || {})) {
    const w = c.CPI_INFLATION_WB?.[y];
    if (finite(w) && Number(y) >= 2000 && Math.abs(v) < 50 && Math.abs(v - w) > 3) inflGap.push({ iso3, year: Number(y), imf: +v.toFixed(1), worldBank: +w.toFixed(1) });
  }
  const inflGapT1 = inflGap.filter(g => tier1.some(c => c.iso3 === g.iso3));
  out.push(check('consistency.inflation', 'Consistency', inflGapT1.length > 10 ? 'warn' : 'pass', `IMF vs World Bank inflation since 2000: ${inflGap.length} country-years differ by more than 3pp, ${inflGapT1.length} in Tier 1 (IMF is used; World Bank only fills years before 1980)`, { tier1: inflGapT1, examples: inflGap.slice(0, 25) }));

  const rateGap = [];
  for (const r of s.signals.filter(x => x.signal === 'policy_rate')) {
    const m = monthly[r.country]?.POLICY_RATE; const last = m ? Object.keys(m).sort().at(-1) : null;
    const st = s.liveState.find(x => x.country === r.country);
    if (last && st && finite(Number(st.policy_rate_now)) && Math.abs(Number(st.policy_rate_now) - m[last]) > 1) rateGap.push({ iso3: r.country, monthly: m[last], monthlyPeriod: last, daily: Number(st.policy_rate_now), dailyDate: st.policy_rate_date });
  }
  out.push(check('consistency.policy_rates', 'Consistency', rateGap.length ? 'warn' : 'pass', rateGap.length ? `${rateGap.length} countries where the daily policy rate differs from the latest monthly by over 1pp` : 'Daily and monthly policy rates agree within 1pp', { gaps: rateGap }));

  // Derived
  const hyper = [];
  for (const c of tier1) { const v = Object.entries(panel[c.iso3]?.INFLATION || {}).filter(([y, x]) => Number(y) >= 1990 && x > 50); if (v.length) hyper.push({ iso3: c.iso3, years: v.length, max: Math.max(...v.map(([, x]) => x)) }); }
  // Years above the hyperinflation threshold are dropped from self-deflated real series (panel.js).
  const leaked = [];
  for (const c of tier1) for (const [y, v] of Object.entries(panel[c.iso3]?.INFLATION || {})) if (v > HYPERINFLATION_PCT && finite(panel[c.iso3]?.REAL_RENT?.[y])) leaked.push(`${c.iso3} ${y}`);
  out.push(check('derived.cpi_chain', 'Derived series', leaked.length ? 'fail' : 'pass', leaked.length ? `${leaked.length} hyperinflation years still present in derived real rents` : `${hyper.length} Tier 1 economies had inflation above ${HYPERINFLATION_PCT}% since 1990; those years are excluded from self-deflated real series`, { economies: hyper, leaked }));

  const integrity = bandIntegrity(s.projections);
  out.push(check('projections.integrity', 'Projections', integrity.length ? 'fail' : 'pass', integrity.length ? `${integrity.length} projection rows non-finite or unordered` : `${s.projections.length} projection rows, all finite with ordered bands`, { bad: integrity.slice(0, 20) }));

  const narrowing = bandNarrowing(s.projections.filter(r => r.target !== 'price_to_rent'));
  out.push(check('projections.band_widening', 'Projections', narrowing.length ? 'warn' : 'pass', narrowing.length ? `${narrowing.length} paths whose 80% band narrows at a longer horizon` : 'Every 80% band widens or holds with horizon', { examples: narrowing.slice(0, 15) }));

  const extreme = s.projections.filter(r => r.target === 'real_price' && r.horizon === 10 && Math.abs(r.median - 100) > 80);
  out.push(check('projections.extremes', 'Projections', extreme.length ? 'warn' : 'pass', extreme.length ? `${extreme.length} 10-year real price medians beyond ±80%` : 'No 10-year real price median beyond ±80%', { extreme: extreme.map(pick) }));

  // Nominal path = real path + inflation path (both x100 log points from the same origin).
  const nominalGap = [];
  const byKey = new Map(s.projections.map(r => [`${r.country}|${r.target}|${r.horizon}`, r]));
  for (const ctx of s.contexts) {
    let acc = 0;
    for (let h = 1; h <= 10; h++) {
      acc += 100 * Math.log(1 + (ctx.details.inflation?.[h] ?? 0) / 100);
      const re = byKey.get(`${ctx.country}|real_price|${h}`), no = byKey.get(`${ctx.country}|nominal_price|${h}`);
      if (re && no) { const gap = 100 * Math.log(no.median / re.median) - acc; if (Math.abs(gap) > 0.5) { nominalGap.push({ iso3: ctx.country, horizon: h, gap: +gap.toFixed(2) }); break; } }
    }
  }
  out.push(check('projections.nominal', 'Projections', nominalGap.length ? 'fail' : 'pass', nominalGap.length ? `${nominalGap.length} nominal price paths inconsistent with real path plus inflation` : 'Nominal price paths equal real paths plus the stored inflation path', { examples: nominalGap.slice(0, 10) }));

  const ptrGap = [];
  for (const r of s.projections.filter(x => x.target === 'price_to_rent')) {
    const np = byKey.get(`${r.country}|nominal_price|${r.horizon}`), nr = byKey.get(`${r.country}|nominal_rent|${r.horizon}`);
    if (np && nr && Math.abs(100 * np.median / nr.median - r.median) > 0.5) ptrGap.push({ ...pick(r), stored: r.median, implied: +(100 * np.median / nr.median).toFixed(2) });
  }
  out.push(check('projections.price_to_rent', 'Projections', ptrGap.length ? 'warn' : 'pass', ptrGap.length ? `${ptrGap.length} price-to-rent points differ from nominal price ÷ nominal rent (paths with different origins)` : 'Price-to-rent equals nominal price ÷ nominal rent', { examples: ptrGap.slice(0, 10) }));

  const sensBad = [];
  for (const ctx of s.contexts) for (const [target, byH] of Object.entries(ctx.details.rateSens || {})) {
    if (!byH || typeof byH !== 'object') continue;
    for (const [h, v] of Object.entries(byH)) {
      if (!finite(v.coef) || Math.abs(v.coef) > 10 || (target !== 'real_rent' && v.coef > 0)) sensBad.push({ iso3: ctx.country, target, horizon: Number(h), coef: v.coef });
    }
  }
  out.push(check('projections.rate_sensitivity', 'Projections', sensBad.length ? 'fail' : 'pass', sensBad.length ? `${sensBad.length} per-country rate sensitivities out of bounds or wrong-signed` : 'Per-country rate sensitivities finite, within ±10 and correctly signed', { bad: sensBad.slice(0, 10) }));

  const pBad = s.personas.filter(r => !(Number(r.score) >= 0 && Number(r.score) <= 100));
  const pCov = Object.fromEntries(['investor', 'buyer', 'renter', 'seller'].map(k => [k, s.personas.filter(r => r.persona === k).length]));
  out.push(check('indexes.personas', 'Indexes', pBad.length ? 'fail' : Object.values(pCov).some(n => n < tier1.length * 0.6) ? 'warn' : 'pass', `Persona scores: ${Object.entries(pCov).map(([k, n]) => `${k} ${n}`).join(', ')} of ${tier1.length} Tier 1; ${pBad.length} outside 0–100`, { coverage: pCov }));

  const aff = [];
  let stressCount = 0;
  for (const ctx of s.contexts) {
    const a = ctx.details.affordability || {};
    if (ctx.details.stress?.score != null) stressCount++;
    if (finite(a.priceToIncome) && (a.priceToIncome < 1 || a.priceToIncome > 30)) aff.push({ iso3: ctx.country, metric: 'priceToIncome', value: +a.priceToIncome.toFixed(2), basis: a.priceToIncomeBasis });
    if (finite(a.mortgageToIncome) && (a.mortgageToIncome < 5 || a.mortgageToIncome > 100)) aff.push({ iso3: ctx.country, metric: 'mortgageToIncome', value: +a.mortgageToIncome.toFixed(1), basis: a.mortgageToIncomeBasis });
    if (finite(a.rentToIncome) && (a.rentToIncome < 5 || a.rentToIncome > 80)) aff.push({ iso3: ctx.country, metric: 'rentToIncome', value: +a.rentToIncome.toFixed(1), basis: a.rentToIncomeBasis });
  }
  out.push(check('indexes.affordability', 'Indexes', aff.length ? 'warn' : 'pass', aff.length ? `${aff.length} affordability ratios outside plausible bounds` : 'Affordability ratios within plausible bounds', { implausible: aff }));
  out.push(check('indexes.stress', 'Indexes', stressCount < 20 ? 'warn' : 'pass', `Mortgage stress index scored for ${stressCount} of ${s.contexts.length} projected economies (needs half its weight; debt-service data covers 17)`, { scored: stressCount }));
  return out;
}

export async function runQuality({ db, live = false, write = true, now = new Date() } = {}) {
  await migrate(db);
  const state = await loadState(db, { live });
  const checks = live ? liveChecks(state, now) : [...fullChecks(state, now), ...liveChecks(state, now)];
  if (write) {
    const runAt = now.toISOString();
    await upsertRows(db, 'data_quality', ['run_at', 'check_id', 'category', 'severity', 'summary', 'details'],
      checks.map(c => ({ run_at: runAt, check_id: c.id, category: c.category, severity: c.severity, summary: c.summary, details: JSON.stringify(c.details) })));
    await db.execute({ sql: `DELETE FROM data_quality WHERE run_at NOT IN (SELECT DISTINCT run_at FROM data_quality ORDER BY run_at DESC LIMIT ${KEEP_RUNS})`, args: [] });
  }
  return { checks, severity: worst(checks.map(c => c.severity)) };
}

// Integrity failures stop the pipeline; staleness and consistency warnings never do.
export const BLOCKING = new Set(['coverage.tiers', 'projections.integrity', 'projections.nominal', 'validity.ranges', 'validity.nonpositive', 'projections.rate_sensitivity', 'indexes.personas', 'live.adjustments']);

async function main() {
  const db = connect();
  const { checks } = await runQuality({ db, live: process.argv.includes('--live'), write: !process.argv.includes('--dry-run') });
  for (const c of checks) console.log(`${c.severity.toUpperCase().padEnd(4)}  ${c.id.padEnd(30)} ${c.summary}`);
  if (process.argv.includes('--verbose')) console.log(JSON.stringify(checks, null, 1));
  if (checks.some(c => c.severity === 'fail' && BLOCKING.has(c.id))) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.stack || error); process.exit(1); });
