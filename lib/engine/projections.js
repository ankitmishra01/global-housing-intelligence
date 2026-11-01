// 10-year house price and rent projection engine.
//
// Direct multi-horizon pooled ridge on cumulative real log growth, with rolling-origin
// backtests against two baselines. Measurement, modelling and narration stay separate:
// this module produces every number; the UI renders them; the LLM only explains them.
import { finite, fitRidge, mean, median, metric, mulberry32, quantile, round } from './stats.js';
import { lastYear, logGrowth, valueAtOrBefore } from './panel.js';
import { stressFeatures } from './affordability.js';

export const MODEL_VERSION = 'housing-ridge-1';
export const FIT_HORIZONS = [1, 2, 3, 5, 7, 10];
export const ALL_HORIZONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DWELLING_TYPES = ['house', 'detached', 'semi_detached', 'townhouse', 'condo'];
const MIN_TRAIN = 60;
// The model must beat the best baseline by this share of MAE on held-out origins.
// Overlapping long-horizon windows leave few independent origins, so tiny wins are noise.
const MIN_SKILL_MARGIN = 0.02;
const MIN_SPLIT_ORIGINS = 6;
const MIN_SPLIT_RECORDS = 12;
const FIRST_BACKTEST_ORIGIN = 1995;
const MIN_TRAIN_YEAR = 1972;
const BOOTSTRAP_DRAWS = 40;

export const FEATURES = ['own 1y real growth', 'own 3y average real growth', 'price-to-income gap', 'price-to-rent gap', 'real policy rate', 'policy rate change', 'household credit change (3y)', 'credit-to-GDP gap', 'population growth', 'real GDP growth', 'cross momentum (rent for prices, prices for rents)', 'house type', 'condo type', 'unemployment change (1y)', 'real wage growth', 'household debt-service gap', 'real policy rate × household credit'];
// The rate toggle moves both the real policy rate and its one-year change by the same amount.
export const RATE_FEATURES = [4, 5];
// Real policy rate × household credit (share of GDP): lets the data decide whether
// more indebted households make prices more rate-sensitive, giving per-country effects.
export const RATE_DEBT_FEATURE = 16;

export const METHOD_NAMES = { zero: 'no real change baseline', drift: 'historical real trend baseline', ridge: 'pooled ridge regression, direct multi-horizon', carry: 'shorter-horizon model held flat' };

// A unit is one modelled series: a country's real price or real rent index, or a
// country × dwelling type real price index.
export function buildUnits(panel) {
  const units = { real_price: [], real_rent: [], type_price: [] };
  for (const [iso3, c] of Object.entries(panel)) {
    if (c.PRICE && Object.keys(c.PRICE).length >= 8) units.real_price.push({ id: iso3, iso3, series: c.PRICE, cross: c.REAL_RENT });
    if (c.REAL_RENT && Object.keys(c.REAL_RENT).length >= 8) units.real_rent.push({ id: iso3, iso3, series: c.REAL_RENT, cross: c.PRICE });
    for (const [type, series] of Object.entries(c.TYPE_REAL || {})) if (Object.keys(series).length >= 8) units.type_price.push({ id: `${iso3}|${type}`, iso3, type, series, cross: c.PRICE });
  }
  return units;
}

export function featureVector(c, unit, t) {
  const s = unit.series;
  const policy = valueAtOrBefore(c.POLICY_RATE, t, 1), policyPrev = valueAtOrBefore(c.POLICY_RATE, t - 1, 1);
  const infl = valueAtOrBefore(c.INFLATION, t, 1);
  const credit = valueAtOrBefore(c.HH_CREDIT, t, 1), creditPrev = valueAtOrBefore(c.HH_CREDIT, t - 3, 1);
  const pti = valueAtOrBefore(c.PTI_AVG, t, 1), ptr = valueAtOrBefore(c.PTR_AVG, t, 1);
  const m3 = logGrowth(s, t - 3, t);
  return [
    logGrowth(s, t - 1, t),
    finite(m3) ? m3 / 3 : null,
    finite(pti) ? pti - 100 : null,
    finite(ptr) ? ptr - 100 : null,
    finite(policy) && finite(infl) ? policy - infl : null,
    finite(policy) && finite(policyPrev) ? policy - policyPrev : null,
    finite(credit) && finite(creditPrev) ? credit - creditPrev : null,
    valueAtOrBefore(c.CREDIT_GAP, t, 1),
    valueAtOrBefore(c.POP_GROWTH, t, 1),
    valueAtOrBefore(c.GDP_GROWTH, t, 1),
    unit.cross ? logGrowth(unit.cross, t - 1, t) : null,
    unit.type ? (['house', 'detached', 'semi_detached', 'townhouse'].includes(unit.type) ? 1 : 0) : null,
    unit.type ? (unit.type === 'condo' ? 1 : 0) : null,
    // Labour and debt-service stress help the headline models in backtests but not the type model.
    ...(unit.type ? [null, null, null] : stressFeatures(c, t)),
    finite(policy) && finite(infl) && finite(credit) ? ((policy - infl) * credit) / 100 : null,
  ];
}

function samplesFor(panel, units, horizon, maxTargetYear) {
  const out = [];
  for (const unit of units) {
    const c = panel[unit.iso3];
    for (const t of Object.keys(unit.series).map(Number)) {
      if (t < MIN_TRAIN_YEAR || t + horizon > maxTargetYear) continue;
      const y = logGrowth(unit.series, t, t + horizon);
      if (!finite(y) || !finite(unit.series[t - 1])) continue;
      out.push({ unit, origin: t, y, x: featureVector(c, unit, t) });
    }
  }
  return out;
}

// Historical mean annual real growth up to the origin (at least 8 years, at most 20).
export function driftRate(series, origin) {
  const g = [];
  for (let y = origin; y > origin - 20; y--) { const v = logGrowth(series, y - 1, y); if (finite(v)) g.push(v); }
  return g.length >= 8 ? mean(g) : 0;
}

const baselines = {
  zero: () => 0,
  drift: (unit, origin, horizon) => driftRate(unit.series, origin) * horizon,
};

// carryHorizon: the longest shorter horizon where the model kept skill. Its prediction
// held flat (no further real change after it) is scored here as a fourth candidate,
// so a path never snaps back to zero just because the long-horizon fit lost skill.
export function evaluate(panel, units, horizon, latestYear, carryHorizon = null) {
  const all = samplesFor(panel, units, horizon, latestYear);
  const carryAll = carryHorizon ? samplesFor(panel, units, carryHorizon, latestYear) : [];
  const origins = [...new Set(all.map(s => s.origin))].filter(y => y >= FIRST_BACKTEST_ORIGIN && y + horizon <= latestYear).sort((a, b) => a - b);
  const records = [];
  for (const origin of origins) {
    // Train only on samples whose target year was observed by the test origin.
    const train = all.filter(s => s.origin + horizon <= origin), test = all.filter(s => s.origin === origin);
    if (train.length < MIN_TRAIN || !test.length) continue;
    const ridge = fitRidge(train);
    const carryTrain = carryAll.filter(s => s.origin + carryHorizon <= origin);
    const carry = carryTrain.length >= MIN_TRAIN ? fitRidge(carryTrain) : null;
    for (const s of test) records.push({ origin, unit: s.unit.id, actual: s.y, zero: 0, drift: baselines.drift(s.unit, origin, horizon), ridge: ridge.predict(s.x), carry: carry ? carry.predict(s.x) : 0 });
  }
  if (!records.length) return null;
  const candidates = ['zero', 'drift', 'ridge', 'carry'];
  const score = set => Object.fromEntries(candidates.map(k => [k, metric(set.map(r => r[k]), set.map(r => r.actual))]));
  const backtestOrigins = [...new Set(records.map(r => r.origin))];
  const cut = backtestOrigins[Math.floor(backtestOrigins.length / 2)];
  const early = records.filter(r => r.origin < cut), late = records.filter(r => r.origin >= cut);
  const split = backtestOrigins.length >= MIN_SPLIT_ORIGINS && early.length >= MIN_SPLIT_RECORDS && late.length >= MIN_SPLIT_RECORDS;
  const selectionSet = split ? early : records, reportSet = split ? late : records;
  const sel = score(selectionSet), rep = score(reportSet);
  // Choose on the early origins; keep the model only if it also beats the best baseline
  // on the later origins it never saw. This can only lower a quoted skill, never raise it.
  const bestBaseline = sel.drift.mae < sel.zero.mae ? 'drift' : 'zero';
  // A model must beat both baselines on the held-out origins, not only the one chosen early.
  const beats = k => sel[k].mae < sel[bestBaseline].mae && rep[k].mae < Math.min(rep.zero.mae, rep.drift.mae) * (1 - MIN_SKILL_MARGIN);
  const modelCandidates = ['ridge', ...(carryHorizon ? ['carry'] : [])].filter(beats).sort((a, b) => sel[a].mae - sel[b].mae);
  const ridgeWins = modelCandidates.length > 0;
  // A drift baseline that loses to no-change on the held-out origins falls back to no-change.
  const selected = ridgeWins ? modelCandidates[0] : bestBaseline === 'drift' && rep.drift.mae >= rep.zero.mae ? 'zero' : bestBaseline;
  const bandResiduals = selectionSet.map(r => r.actual - r[selected]);
  const lo80 = quantile(bandResiduals, 0.1), hi80 = quantile(bandResiduals, 0.9);
  const coverage = mean(reportSet.map(r => (r.actual >= r[selected] + lo80 && r.actual <= r[selected] + hi80 ? 1 : 0)));
  return {
    horizon, selected, carryHorizon: selected === 'carry' ? carryHorizon : null, noSkill: !ridgeWins, split, records, residuals: records.map(r => r.actual - r[selected]),
    scores: rep, selectionScores: sel, coverage, nOrigins: backtestOrigins.length,
    basis: split ? `method chosen on origins ${backtestOrigins[0]}-${cut - 1}, error quoted on held-out origins ${cut}-${backtestOrigins.at(-1)}`
      : `only ${backtestOrigins.length} backtest origins, too few to split; chosen and scored on the same ${records.length} records`,
  };
}

// Final per-horizon predictor fitted on everything observed up to latestYear.
function finalModel(panel, units, horizon, latestYear) {
  const samples = samplesFor(panel, units, horizon, latestYear);
  return samples.length >= MIN_TRAIN ? { model: fitRidge(samples), samples } : null;
}

// Pooled sensitivity of cumulative real growth (x100 log) to a sustained +1pp rate move,
// with a cluster bootstrap over units for its standard error.
export function rateSensitivity(samples, model) {
  const coef = RATE_FEATURES.reduce((s, j) => s + model.rawCoef[j], 0);
  const inter = model.rawCoef[RATE_DEBT_FEATURE] ?? 0;
  const ids = [...new Set(samples.map(s => s.unit.id))];
  const byUnit = new Map(ids.map(id => [id, samples.filter(s => s.unit.id === id)]));
  const rand = mulberry32(20261031), draws = [];
  for (let b = 0; b < BOOTSTRAP_DRAWS; b++) {
    const boot = [];
    for (let i = 0; i < ids.length; i++) boot.push(...byUnit.get(ids[Math.floor(rand() * ids.length)]));
    if (boot.length >= MIN_TRAIN) { const m = fitRidge(boot); draws.push([RATE_FEATURES.reduce((s, j) => s + m.rawCoef[j], 0), m.rawCoef[RATE_DEBT_FEATURE] ?? 0]); }
  }
  // Sensitivity for a country whose household credit is `k` × GDP, with its bootstrap se.
  const at = k => {
    const d = draws.map(([b, i]) => b + i * k), mu = mean(d);
    return { coef: coef + inter * k, se: Math.sqrt(mean(d.map(x => (x - mu) ** 2))) };
  };
  return { base: coef, inter, at };
}

// Linear interpolation of horizon-indexed values onto 1..10.
export function interpolate(points) {
  const hs = Object.keys(points).map(Number).sort((a, b) => a - b);
  return Object.fromEntries(ALL_HORIZONS.map(h => {
    if (finite(points[h])) return [h, points[h]];
    const lo = [...hs].reverse().find(x => x < h), hi = hs.find(x => x > h);
    if (lo == null) return [h, points[hi]];
    if (hi == null) return [h, points[lo]];
    return [h, points[lo] + ((points[hi] - points[lo]) * (h - lo)) / (hi - lo)];
  }));
}

// Residual quantile widths per horizon, forced non-decreasing so the fan never narrows
// with distance (thin long-horizon samples can otherwise produce a pinched band).
export function bandWidths(fits) {
  const raw = {};
  for (const h of FIT_HORIZONS) if (fits[h]) {
    const r = fits[h].residuals;
    raw[h] = { p10: quantile(r, 0.1), p25: quantile(r, 0.25), p75: quantile(r, 0.75), p90: quantile(r, 0.9) };
  }
  const out = {};
  for (const k of ['p10', 'p25', 'p75', 'p90']) {
    const series = interpolate(Object.fromEntries(Object.entries(raw).map(([h, w]) => [h, w[k]])));
    let edge = 0;
    for (const h of ALL_HORIZONS) {
      edge = k === 'p10' || k === 'p25' ? Math.min(edge, Math.min(0, series[h])) : Math.max(edge, Math.max(0, series[h]));
      (out[h] ||= {})[k] = edge;
    }
  }
  return out;
}

// Inflation path for nominal conversion: IMF WEO actuals and forecasts, the last WEO year held flat after.
export function inflationPath(c, forecast, origin) {
  const path = {};
  let last = valueAtOrBefore(c.INFLATION, origin, 3) ?? 2;
  for (const h of ALL_HORIZONS) {
    const y = origin + h;
    const v = finite(c.INFLATION?.[y]) ? c.INFLATION[y] : finite(forecast?.INFLATION?.[y]) ? forecast.INFLATION[y] : last;
    path[h] = v; last = v;
  }
  return path;
}

const toIndex = logPct => 100 * Math.exp(logPct / 100);

function pathRows(country, target, cum, widths, methods) {
  return ALL_HORIZONS.map(h => ({
    country, target, horizon: h,
    p10: round(toIndex(cum[h] + widths[h].p10), 3), p25: round(toIndex(cum[h] + widths[h].p25), 3), median: round(toIndex(cum[h]), 3),
    p75: round(toIndex(cum[h] + widths[h].p75), 3), p90: round(toIndex(cum[h] + widths[h].p90), 3), method: methods[h],
  }));
}

export function trainTarget(panel, units, latestYear) {
  const fits = {}, finals = {}, sensitivity = {};
  let skilled = null; // longest horizon so far whose shipped method is the model (directly)
  for (const h of FIT_HORIZONS) {
    fits[h] = evaluate(panel, units, h, latestYear, skilled);
    if (fits[h]?.selected === 'ridge') skilled = h;
    finals[h] = finalModel(panel, units, h, latestYear);
    if (finals[h]) sensitivity[h] = rateSensitivity(finals[h].samples, finals[h].model);
  }
  return { fits, finals, sensitivity, widths: bandWidths(fits) };
}

function cumulativeFor(panel, unit, trained) {
  const c = panel[unit.iso3], origin = lastYear(unit.series);
  const point = {}, method = {};
  for (const h of FIT_HORIZONS) {
    const fit = trained.fits[h];
    if (!fit) continue;
    const sel = fit.selected;
    const x = featureVector(c, unit, origin);
    point[h] = sel === 'ridge' && trained.finals[h] ? trained.finals[h].model.predict(x)
      : sel === 'carry' && trained.finals[fit.carryHorizon] ? trained.finals[fit.carryHorizon].model.predict(x)
      : sel === 'drift' ? baselines.drift(unit, origin, h) : 0;
    method[h] = sel === 'carry' ? `${fit.carryHorizon}-year model projection held flat after year ${fit.carryHorizon}` : METHOD_NAMES[sel];
  }
  if (!Object.keys(point).length) return null;
  const cum = interpolate(point);
  const methods = Object.fromEntries(ALL_HORIZONS.map(h => [h, method[h] || 'interpolated between fitted horizons']));
  return { origin, cum, methods };
}

export function trainEngine({ panel, forecasts }, options = {}) {
  const latestYear = options.latestYear ?? Math.max(...Object.values(panel).map(c => lastYear(c.PRICE) || 0));
  const units = buildUnits(panel);
  const trained = Object.fromEntries(Object.entries(units).map(([target, list]) => [target, trainTarget(panel, list, latestYear)]));
  const projections = [], contexts = {};

  for (const unit of units.real_price) {
    const c = panel[unit.iso3];
    const price = cumulativeFor(panel, unit, trained.real_price);
    if (!price) continue;
    const infl = inflationPath(c, forecasts[unit.iso3], price.origin);
    let acc = 0; const nominalAdd = {};
    for (const h of ALL_HORIZONS) { acc += 100 * Math.log(1 + infl[h] / 100); nominalAdd[h] = acc; }
    const w = trained.real_price.widths;
    projections.push(...pathRows(unit.iso3, 'real_price', price.cum, w, price.methods));
    projections.push(...pathRows(unit.iso3, 'nominal_price', Object.fromEntries(ALL_HORIZONS.map(h => [h, price.cum[h] + nominalAdd[h]])), w, Object.fromEntries(ALL_HORIZONS.map(h => [h, `${price.methods[h]} plus IMF WEO inflation`]))));
    const ctx = contexts[unit.iso3] = { origin: price.origin, inflation: infl, realPriceCum: price.cum, nominalAdd, priceSource: c.PRICE_SOURCE };

    const rentUnit = units.real_rent.find(u => u.iso3 === unit.iso3);
    const rent = rentUnit && cumulativeFor(panel, rentUnit, trained.real_rent);
    if (rent) {
      // Rent paths start at their own last observed year; the UI labels both origins.
      const rentInfl = inflationPath(c, forecasts[unit.iso3], rent.origin);
      let r = 0; const rentNominalAdd = {};
      for (const h of ALL_HORIZONS) { r += 100 * Math.log(1 + rentInfl[h] / 100); rentNominalAdd[h] = r; }
      const wr = trained.real_rent.widths;
      const rentNominal = Object.fromEntries(ALL_HORIZONS.map(h => [h, rent.cum[h] + rentNominalAdd[h]]));
      projections.push(...pathRows(unit.iso3, 'real_rent', rent.cum, wr, rent.methods));
      projections.push(...pathRows(unit.iso3, 'nominal_rent', rentNominal, wr, Object.fromEntries(ALL_HORIZONS.map(h => [h, `${rent.methods[h]} plus IMF WEO inflation`]))));
      // Price-to-rent: price and rent errors treated as independent.
      const ptrCum = Object.fromEntries(ALL_HORIZONS.map(h => [h, price.cum[h] + nominalAdd[h] - rentNominal[h]]));
      const wptr = Object.fromEntries(ALL_HORIZONS.map(h => [h, Object.fromEntries(['p10', 'p25', 'p75', 'p90'].map(k => { const opp = { p10: 'p90', p25: 'p75', p75: 'p25', p90: 'p10' }[k]; return [k, Math.sign(w[h][k]) * Math.hypot(w[h][k], wr[h][opp])]; }))]));
      projections.push(...pathRows(unit.iso3, 'price_to_rent', ptrCum, wptr, Object.fromEntries(ALL_HORIZONS.map(h => [h, 'ratio of projected nominal price and rent paths']))));
      Object.assign(ctx, { rentOrigin: rent.origin, realRentCum: rent.cum, rentNominalAdd });
    }

    for (const typeUnit of units.type_price.filter(u => u.iso3 === unit.iso3)) {
      const t = cumulativeFor(panel, typeUnit, trained.type_price);
      if (!t) continue;
      projections.push(...pathRows(unit.iso3, `real_price:${typeUnit.type}`, t.cum, trained.type_price.widths, t.methods));
      (ctx.types ||= {})[typeUnit.type] = { origin: t.origin, realCum: t.cum, source: c.TYPE_SOURCE?.[typeUnit.type] };
    }
  }

  const backtests = [], sensitivities = [];
  for (const [target, tr] of Object.entries(trained)) for (const h of FIT_HORIZONS) {
    const f = tr.fits[h];
    if (f) backtests.push({
      target, horizon: h, method: f.selected === 'carry' ? `${f.carryHorizon}-year model held flat` : METHOD_NAMES[f.selected], status: f.noSkill ? 'no model skill, showing baseline' : 'out-of-sample skill',
      mae: round(f.scores[f.selected].mae), rmse: round(f.scores[f.selected].rmse), baseline_mae: round(f.scores.zero.mae), baseline_rmse: round(f.scores.zero.rmse),
      skill_pct: round(100 * (1 - f.scores[f.selected].mae / f.scores.zero.mae), 1), coverage80: round(100 * f.coverage, 1), n_origins: f.nOrigins, n_records: f.records.length, basis: f.basis,
    });
  }
  // Household credit share (× GDP) per country; the pooled table is quoted at the median.
  const creditShare = Object.fromEntries(Object.entries(panel).map(([iso3, c]) => { const y = lastYear(c.HH_CREDIT); return [iso3, y ? c.HH_CREDIT[y] / 100 : null]; }));
  const medianShare = median(Object.values(creditShare).filter(finite)) || 0.5;
  const sensFor = (target, k) => {
    const tr = trained[target];
    // A horizon that ships a shorter model held flat inherits that model's sensitivity.
    const src = h => (tr.fits[h]?.selected === 'carry' ? tr.fits[h].carryHorizon : h);
    const pts = Object.fromEntries(FIT_HORIZONS.filter(h => tr.sensitivity[src(h)]).map(h => [h, tr.sensitivity[src(h)].at(k)]));
    const coefs = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.coef])));
    const ses = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.se])));
    return { coefs, ses, raw: pts };
  };
  const validity = {};
  for (const target of Object.keys(trained)) {
    const priceLike = target !== 'real_rent';
    const { coefs, ses, raw } = sensFor(target, medianShare);
    // Prices must fall when rates rise; a wrong-signed estimate disables the toggle for that target.
    const wrongSign = priceLike && Object.values(raw).some(v => v.coef > 0.05);
    validity[target] = !wrongSign;
    const inter = trained[target].sensitivity[1]?.inter ?? 0;
    for (const h of ALL_HORIZONS) {
      if (!finite(coefs[h])) continue;
      sensitivities.push({ target, horizon: h, coef: round(priceLike ? Math.min(0, coefs[h]) : coefs[h], 4), se: round(ses[h], 4), valid: wrongSign ? 0 : 1,
        note: wrongSign ? 'estimated rate effect on prices had the wrong sign at one or more horizons; toggle disabled'
          : `quoted at the median household credit of ${Math.round(medianShare * 100)}% of GDP; each country's effect scales with its own household credit (interaction ${inter >= 0 ? '+' : ''}${inter.toFixed(2)} per 100% of GDP)${priceLike ? '' : '; rent sign estimated freely'}` });
    }
  }
  // Per-country sensitivities used by the toggle and the live layer.
  for (const [iso3, ctx] of Object.entries(contexts)) {
    const k = finite(creditShare[iso3]) ? creditShare[iso3] : medianShare;
    ctx.rateSens = { householdCreditShare: round(k, 3), imputed: !finite(creditShare[iso3]) };
    for (const target of Object.keys(trained)) {
      const priceLike = target !== 'real_rent';
      const { coefs, ses } = sensFor(target, k);
      ctx.rateSens[target] = Object.fromEntries(ALL_HORIZONS.filter(h => finite(coefs[h])).map(h => [h, { coef: round(priceLike ? Math.min(0, coefs[h]) : coefs[h], 4), se: round(ses[h], 4), valid: validity[target] ? 1 : 0 }]));
    }
  }
  // Backtest residual inputs for the event library (short horizons only).
  const backtestRecords = {};
  for (const target of ['real_price', 'real_rent']) for (const h of [1, 2, 3]) {
    const f = trained[target]?.fits[h];
    if (f) ((backtestRecords[target] ||= {})[h] = f.records.map(r => ({ unit: r.unit, origin: r.origin, actual: r.actual, predicted: r[f.selected] })));
  }
  return { modelVersion: MODEL_VERSION, latestYear, projections, backtests, sensitivities, contexts, backtestRecords, units: Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.length])) };
}

export function validateEngineOutput(out) {
  if (!out.projections.length) throw new Error('No projections produced');
  for (const r of out.projections) {
    if (!['p10', 'p25', 'median', 'p75', 'p90'].every(k => finite(r[k]))) throw new Error(`Non-finite projection ${r.country} ${r.target} h${r.horizon}`);
    if (!(r.p10 <= r.p25 && r.p25 <= r.median && r.median <= r.p75 && r.p75 <= r.p90)) throw new Error(`Unordered band ${r.country} ${r.target} h${r.horizon}`);
  }
  const countries = new Set(out.projections.filter(r => r.target === 'real_price').map(r => r.country));
  if (countries.size < 30) throw new Error(`Only ${countries.size} countries projected`);
  return true;
}

export { median };
