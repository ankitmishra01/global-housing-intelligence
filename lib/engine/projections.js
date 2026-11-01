// 10-year house price and rent projection engine.
//
// Direct multi-horizon pooled ridge on cumulative real log growth, with rolling-origin
// backtests against two baselines. Measurement, modelling and narration stay separate:
// this module produces every number; the UI renders them; the LLM only explains them.
import { finite, fitRidge, mean, median, metric, mulberry32, quantile, round } from './stats.js';
import { lastYear, logGrowth, valueAtOrBefore } from './panel.js';
import { stressFeatures } from './affordability.js';

export const MODEL_VERSION = 'housing-ridge-2';
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
// Long-run anchor: a unit's mean annual real growth over up to this many years before the
// origin, shrunk toward the pooled mean of all units by n / (n + ANCHOR_SHRINK).
const ANCHOR_YEARS = 30;
const ANCHOR_SHRINK = 10;
// Blend weights on the model (the rest goes to the anchor), chosen on the selection origins.
export const BLEND_WEIGHTS = [1, 0.75, 0.5, 0.25];
// Historical reality anchor: at longer horizons the shipped path is blended with what the most
// similar market-years in history actually went on to do. The pooled model's backtest window
// (origins 1995 to 2015) spans a long fall in real interest rates that rewarded optimistic
// projections; the anchor keeps 10-year paths within the range history has delivered for markets
// in a similar position. Weights are fixed by design, not chosen to maximise backtest skill, and
// the backtest table reports the shipped (blended) error.
export const REALITY_WEIGHTS = { 1: 0, 2: 0, 3: 0, 5: 0.5, 7: 0.6, 10: 0.75 };
export const ANALOG_K = 50;
// Similarity on recent momentum (1 and 3 years), the real policy rate and household credit growth.
export const ANALOG_FEATURES = [0, 1, 4, 6, 8];

// Mean outcome of the ANALOG_K training samples nearest to x on the analogue features
// (standardised; a feature missing on either side is skipped and the distance rescaled).
export function analogue(train, x) {
  const sd = ANALOG_FEATURES.map(j => { const col = train.map(s => s.x[j]).filter(finite); if (col.length < 2) return 0; const m = mean(col); return Math.sqrt(mean(col.map(v => (v - m) ** 2))); });
  const dist = s => {
    let d = 0, k = 0;
    ANALOG_FEATURES.forEach((j, i) => { if (sd[i] > 0 && finite(x[j]) && finite(s.x[j])) { d += ((x[j] - s.x[j]) / sd[i]) ** 2; k++; } });
    return k >= 2 ? Math.sqrt((d * ANALOG_FEATURES.length) / k) : Infinity;
  };
  const near = train.map(s => ({ y: s.y, d: dist(s) })).filter(s => finite(s.d)).sort((a, b) => a.d - b.d).slice(0, ANALOG_K);
  if (near.length < 10) return null;
  const ys = near.map(s => s.y);
  return { value: mean(ys), p10: quantile(ys, 0.1), p90: quantile(ys, 0.9), n: near.length };
}

export const FEATURES = ['own 1y real growth', 'own 3y average real growth', 'price-to-income vs trailing 20 years', 'price-to-rent vs trailing 20 years', 'real policy rate', 'policy rate change', 'household credit change (3y)', 'credit-to-GDP gap', 'population growth', 'real GDP growth', 'cross momentum (rent for prices, prices for rents)', 'house type', 'condo type', 'unemployment change (1y)', 'real wage growth', 'household debt-service gap', 'real policy rate × household credit'];
// The rate toggle moves both the real policy rate and its one-year change by the same amount.
export const RATE_FEATURES = [4, 5];
// Real policy rate × household credit (share of GDP): lets the data decide whether
// more indebted households make prices more rate-sensitive, giving per-country effects.
export const RATE_DEBT_FEATURE = 16;
// Drivers the scenario builder moves, mapped to their feature names.
export const SCENARIO_FEATURES = { unemployment_change: 'unemployment change (1y)', real_wage_growth: 'real wage growth', real_gdp_growth: 'real GDP growth' };

export const METHOD_NAMES = { zero: 'no real change baseline', drift: 'historical real trend baseline', anchor: 'long-run growth anchor baseline', ridge: 'pooled ridge regression, direct multi-horizon', blend: 'model blended with the long-run growth anchor', carry: 'shorter-horizon model held flat' };
export const BASELINES = ['zero', 'drift', 'anchor'];
export const MODEL_METHODS = ['ridge', 'blend', 'carry'];

// Human label for a fit's shipped method (blend weight and carry source included).
export function methodLabel(f) {
  if (!f) return '';
  if (f.selected === 'carry') return `${f.carryHorizon}-year model held flat${f.carryWeight != null && f.carryWeight < 1 ? ` (blended ${Math.round(f.carryWeight * 100)}% model)` : ''}`;
  if (f.selected === 'blend') return `${METHOD_NAMES.blend} (${Math.round(f.blendWeight * 100)}% model, ${Math.round((1 - f.blendWeight) * 100)}% anchor)`;
  return METHOD_NAMES[f.selected];
}

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

// Percent gap of a ratio at t vs its mean over the previous `window` years (needs `min` years).
export function trailingGap(series, t, window = 20, min = 10) {
  const now = valueAtOrBefore(series, t, 1);
  if (!finite(now)) return null;
  const past = [];
  for (let y = t - window; y < t; y++) if (finite(series?.[y])) past.push(series[y]);
  return past.length >= min ? 100 * (now / mean(past) - 1) : null;
}

export function featureVector(c, unit, t) {
  const s = unit.series;
  const policy = valueAtOrBefore(c.POLICY_RATE, t, 1), policyPrev = valueAtOrBefore(c.POLICY_RATE, t - 1, 1);
  const infl = valueAtOrBefore(c.INFLATION, t, 1);
  const credit = valueAtOrBefore(c.HH_CREDIT, t, 1), creditPrev = valueAtOrBefore(c.HH_CREDIT, t - 3, 1);
  // Valuation gaps vs the country's own trailing 20 years, not the OECD full-sample average:
  // that average uses future years (look-ahead in backtests) and is non-stationary where
  // incomes trend (Korea's ratio fell from 265 to 48 of its average between 1986 and 2025).
  const pti = trailingGap(c.PTI_AVG, t), ptr = trailingGap(c.PTR_AVG, t);
  const m3 = logGrowth(s, t - 3, t);
  return [
    logGrowth(s, t - 1, t),
    finite(m3) ? m3 / 3 : null,
    pti,
    ptr,
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

// Mean annual real growth over up to ANCHOR_YEARS years ending at the origin, with its count.
export function longRunRate(series, origin, years = ANCHOR_YEARS) {
  const g = [];
  for (let y = origin; y > origin - years; y--) { const v = logGrowth(series, y - 1, y); if (finite(v)) g.push(v); }
  return { mean: g.length ? mean(g) : null, n: g.length };
}

// Pooled long-run mean across units at an origin (units with 8+ years), memoised per unit list.
const pooledMemo = new WeakMap();
export function pooledLongRun(units, origin) {
  let byOrigin = pooledMemo.get(units);
  if (!byOrigin) pooledMemo.set(units, (byOrigin = new Map()));
  if (!byOrigin.has(origin)) {
    const means = units.map(u => longRunRate(u.series, origin)).filter(r => r.n >= 8).map(r => r.mean);
    byOrigin.set(origin, means.length ? mean(means) : 0);
  }
  return byOrigin.get(origin);
}

// Shrunk long-run annual growth for one unit at an origin.
export function anchorRate(unit, origin, units) {
  const pooled = pooledLongRun(units, origin);
  const own = longRunRate(unit.series, origin);
  return own.n ? (own.n * own.mean + ANCHOR_SHRINK * pooled) / (own.n + ANCHOR_SHRINK) : pooled;
}

const baselines = {
  zero: () => 0,
  drift: (unit, origin, horizon) => driftRate(unit.series, origin) * horizon,
  anchor: (unit, origin, horizon, units) => anchorRate(unit, origin, units) * horizon,
};

// carry: { horizon, weight } for the longest shorter horizon where a model kept skill. Its
// prediction held flat (no further real change after it) is scored as a candidate, so a path
// never snaps back to a baseline just because the long-horizon fit lost skill.
export function evaluate(panel, units, horizon, latestYear, carry = null, { anchor = true } = {}) {
  const carryHorizon = carry?.horizon ?? null, carryWeight = carry?.weight ?? 1;
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
    const carryModel = carryTrain.length >= MIN_TRAIN ? fitRidge(carryTrain) : null;
    for (const s of test) {
      const a = anchorRate(s.unit, origin, units);
      // Two carry-forward candidates: the source horizon's plain model, and (when the source
      // shipped a blend) the same blend; both held flat after the source horizon.
      const cm = carryModel ? carryModel.predict(s.x) : 0;
      const an = (REALITY_WEIGHTS[horizon] ?? 0) > 0 ? analogue(train, s.x) : null;
      records.push({ origin, unit: s.unit.id, actual: s.y, zero: 0, drift: baselines.drift(s.unit, origin, horizon), anchor: a * horizon, ridge: ridge.predict(s.x), analog: an ? an.value : null,
        carry: cm, carryBlend: carryModel ? carryWeight * cm + (1 - carryWeight) * a * carryHorizon : 0 });
    }
  }
  if (!records.length) return null;
  const candidates = ['zero', 'drift', 'anchor', 'ridge', 'blend', 'carry', 'carryBlend'];
  const score = set => Object.fromEntries(candidates.map(k => [k, metric(set.map(r => r[k]), set.map(r => r.actual))]));
  const backtestOrigins = [...new Set(records.map(r => r.origin))];
  const cut = backtestOrigins[Math.floor(backtestOrigins.length / 2)];
  const early = records.filter(r => r.origin < cut), late = records.filter(r => r.origin >= cut);
  const split = backtestOrigins.length >= MIN_SPLIT_ORIGINS && early.length >= MIN_SPLIT_RECORDS && late.length >= MIN_SPLIT_RECORDS;
  const selectionSet = split ? early : records, reportSet = split ? late : records;
  // Blend weight on the model, chosen on the selection origins only.
  const blendMae = w => metric(selectionSet.map(r => w * r.ridge + (1 - w) * r.anchor), selectionSet.map(r => r.actual)).mae;
  const blendWeight = anchor ? BLEND_WEIGHTS.reduce((best, w) => (blendMae(w) < blendMae(best) ? w : best), BLEND_WEIGHTS[0]) : 1;
  for (const r of records) r.blend = blendWeight * r.ridge + (1 - blendWeight) * r.anchor;
  const sel = score(selectionSet), rep = score(reportSet);
  // Choose on the early origins; keep a model only if it also beats every baseline on the
  // later origins it never saw, by the skill margin. This can only lower a quoted skill.
  const baselineSet = anchor ? BASELINES : ['zero', 'drift'];
  const bestBaseline = baselineSet.reduce((b, k) => (sel[k].mae < sel[b].mae ? k : b), 'zero');
  const minBaseline = Math.min(...baselineSet.map(k => rep[k].mae));
  const beats = k => sel[k].mae < sel[bestBaseline].mae && rep[k].mae < minBaseline * (1 - MIN_SKILL_MARGIN);
  // Direct fits (plain or blended, whichever scores better on selection) come before carry-forward.
  const byScore = (a, b) => sel[a].mae - sel[b].mae;
  const direct = (anchor ? ['ridge', 'blend'] : ['ridge']).filter(beats).sort(byScore);
  const carried = carryHorizon ? ['carry', ...(carryWeight < 1 ? ['carryBlend'] : [])].filter(beats).sort(byScore) : [];
  const modelCandidates = [...direct, ...carried];
  const ridgeWins = modelCandidates.length > 0;
  // A baseline chosen early that loses to no-change on the held-out origins falls back to no-change.
  let selected = ridgeWins ? modelCandidates[0] : bestBaseline !== 'zero' && rep[bestBaseline].mae >= rep.zero.mae ? 'zero' : bestBaseline;
  // Shipped carry weight: 1 for the plain carried model, the source's blend weight otherwise.
  let shippedCarryWeight = 1;
  if (selected === 'carryBlend') { for (const r of records) r.carry = r.carryBlend; sel.carry = sel.carryBlend; rep.carry = rep.carryBlend; selected = 'carry'; shippedCarryWeight = carryWeight; }
  const bandResiduals = selectionSet.map(r => r.actual - r[selected]);
  const lo80 = quantile(bandResiduals, 0.1), hi80 = quantile(bandResiduals, 0.9);
  const coverage = mean(reportSet.map(r => (r.actual >= r[selected] + lo80 && r.actual <= r[selected] + hi80 ? 1 : 0)));
  return {
    cut: split ? cut : null, horizon, selected, blendWeight, carryHorizon: selected === 'carry' ? carryHorizon : null, carryWeight: selected === 'carry' ? shippedCarryWeight : null,
    noSkill: !ridgeWins, split, records, residuals: records.map(r => r.actual - r[selected]),
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

// Cluster bootstrap over units: raw coefficient vectors of ridge refits on resampled units.
// Computed once per (target, horizon) and shared by the rate and feature sensitivities.
export function bootstrapCoefs(samples) {
  const ids = [...new Set(samples.map(s => s.unit.id))];
  const byUnit = new Map(ids.map(id => [id, samples.filter(s => s.unit.id === id)]));
  const rand = mulberry32(20261031), draws = [];
  for (let b = 0; b < BOOTSTRAP_DRAWS; b++) {
    const boot = [];
    for (let i = 0; i < ids.length; i++) boot.push(...byUnit.get(ids[Math.floor(rand() * ids.length)]));
    if (boot.length >= MIN_TRAIN) draws.push(fitRidge(boot).rawCoef);
  }
  return draws;
}

const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

// Pooled effect of +1 unit in the summed features `idx` on cumulative real growth (x100 log),
// with its bootstrap standard error.
export function featureSensitivity(model, draws, idx) {
  const sum = c => idx.reduce((s, j) => s + (c[j] ?? 0), 0);
  return { coef: sum(model.rawCoef), se: draws.length ? sd(draws.map(sum)) : 0 };
}

// Pooled sensitivity of cumulative real growth (x100 log) to a sustained +1pp rate move,
// with a cluster bootstrap over units for its standard error.
export function rateSensitivity(samples, model, boot = bootstrapCoefs(samples)) {
  const coef = RATE_FEATURES.reduce((s, j) => s + model.rawCoef[j], 0);
  const inter = model.rawCoef[RATE_DEBT_FEATURE] ?? 0;
  const draws = boot.map(c => [RATE_FEATURES.reduce((s, j) => s + c[j], 0), c[RATE_DEBT_FEATURE] ?? 0]);
  // Sensitivity for a country whose household credit is `k` × GDP, with its bootstrap se.
  const at = k => {
    const d = draws.map(([b, i]) => b + i * k), mu = mean(d);
    return { coef: coef + inter * k, se: Math.sqrt(mean(d.map(x => (x - mu) ** 2))) };
  };
  const im = mean(draws.map(([, i]) => i));
  const interSe = Math.sqrt(mean(draws.map(([, i]) => (i - im) ** 2)));
  return { base: coef, inter, interSe, at };
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

// The long-run anchor and blend are used where they held up in backtests: prices and rents.
// For dwelling types they displaced a stronger 3-year carry-forward and cut held-out skill at
// 5-10 years (19.1/14.4/7.5% → 8.2/0/0%), so the type model keeps its earlier candidate set.
export const ANCHOR_TARGETS = new Set(['real_price', 'real_rent']);

export function trainTarget(panel, units, latestYear, { anchor = true } = {}) {
  const fits = {}, finals = {}, sensitivity = {}, boots = {};
  let skilled = null; // { horizon, weight }: longest horizon so far shipping a direct model
  for (const h of FIT_HORIZONS) {
    fits[h] = evaluate(panel, units, h, latestYear, skilled, { anchor });
    if (fits[h]?.selected === 'ridge') skilled = { horizon: h, weight: 1 };
    else if (fits[h]?.selected === 'blend') skilled = { horizon: h, weight: fits[h].blendWeight };
    fits[h] && (fits[h].carryFrom = skilled);
    finals[h] = finalModel(panel, units, h, latestYear);
    if (finals[h]) {
      boots[h] = bootstrapCoefs(finals[h].samples);
      sensitivity[h] = rateSensitivity(finals[h].samples, finals[h].model, boots[h]);
    }
  }
  // Path coherence: a baseline horizon sandwiched between model horizons would make the path
  // dip to the baseline and jump back. Use the carry-forward there when it scores no worse than
  // the baseline on the held-out origins (no margin: this only smooths, it never adds claimed skill).
  const isModel = f => f && MODEL_METHODS.includes(f.selected);
  FIT_HORIZONS.forEach((h, i) => {
    const f = fits[h];
    if (!f || isModel(f) || f.carryFrom == null) return;
    const later = FIT_HORIZONS.slice(i + 1).some(k => isModel(fits[k]));
    if (later && f.scores.carry && f.scores.carry.mae <= f.scores[f.selected].mae) {
      f.selected = 'carry'; f.carryHorizon = f.carryFrom.horizon; f.carryWeight = 1; f.smoothed = true;
      f.residuals = f.records.map(r => r.actual - r.carry);
    }
  });
  for (const h of FIT_HORIZONS) if (fits[h]) applyReality(fits[h], REALITY_WEIGHTS[h] ?? 0);
  return { fits, finals, sensitivity, boots, units, widths: bandWidths(fits) };
}

// Blends the selected method with the historical analogue at weight rw and re-derives the
// residuals, coverage and held-out error from the blended (shipped) predictions.
export function applyReality(f, rw) {
  f.realityWeight = rw;
  f.shippedKey = f.selected;
  if (!(rw > 0)) return f;
  for (const r of f.records) r.reality = finite(r.analog) ? (1 - rw) * r[f.selected] + rw * r.analog : r[f.selected];
  const sel = f.cut != null ? f.records.filter(r => r.origin < f.cut) : f.records;
  const rep = f.cut != null ? f.records.filter(r => r.origin >= f.cut) : f.records;
  const res = sel.map(r => r.actual - r.reality);
  const lo = quantile(res, 0.1), hi = quantile(res, 0.9);
  f.coverage = mean(rep.map(r => (r.actual >= r.reality + lo && r.actual <= r.reality + hi ? 1 : 0)));
  f.scores.reality = metric(rep.map(r => r.reality), rep.map(r => r.actual));
  f.residuals = f.records.map(r => r.actual - r.reality);
  f.shippedKey = 'reality';
  return f;
}

function cumulativeFor(panel, unit, trained) {
  const c = panel[unit.iso3], origin = lastYear(unit.series);
  const point = {}, method = {};
  for (const h of FIT_HORIZONS) {
    const fit = trained.fits[h];
    if (!fit) continue;
    const sel = fit.selected;
    const x = featureVector(c, unit, origin);
    const a = anchorRate(unit, origin, trained.units);
    const model = hh => trained.finals[hh]?.model.predict(x);
    point[h] = sel === 'ridge' && trained.finals[h] ? model(h)
      : sel === 'blend' && trained.finals[h] ? fit.blendWeight * model(h) + (1 - fit.blendWeight) * a * h
      : sel === 'carry' && trained.finals[fit.carryHorizon] ? fit.carryWeight * model(fit.carryHorizon) + (1 - fit.carryWeight) * a * fit.carryHorizon
      : sel === 'drift' ? baselines.drift(unit, origin, h)
      : sel === 'anchor' ? a * h : 0;
    method[h] = sel === 'carry' ? `${methodLabel(fit).replace('model held flat', 'model projection held flat')} after year ${fit.carryHorizon}` : methodLabel(fit);
    const rw = fit.realityWeight ?? 0, pool = trained.finals[h]?.samples;
    const an = rw > 0 && pool ? analogue(pool, x) : null;
    if (an) { point[h] = (1 - rw) * point[h] + rw * an.value; method[h] += `, ${Math.round(rw * 100)}% historical analogue`; }
  }
  if (!Object.keys(point).length) return null;
  const cum = interpolate(point);
  const methods = Object.fromEntries(ALL_HORIZONS.map(h => [h, method[h] || 'interpolated between fitted horizons']));
  const drivers = Object.fromEntries(EXPLAIN_HORIZONS.map(h => [h, explainPoint(c, unit, origin, trained, h)]).filter(([, v]) => v));
  return { origin, cum, methods, drivers };
}

// Horizons whose projection is decomposed into drivers for the written analysis.
export const EXPLAIN_HORIZONS = [3, 10];

// Splits the shipped projection at horizon h into its additive parts (log points):
// the training-sample average (intercept), the long-run anchor share (blends and carries),
// and one contribution per feature against the sample mean. The parts sum to the point
// projection exactly, so the prose can say which drivers lift or weigh on the path.
export function explainPoint(c, unit, origin, trained, h) {
  const fit = trained.fits[h];
  if (!fit) return null;
  const sel = fit.selected;
  const mh = sel === 'carry' ? fit.carryHorizon : h;
  const final = trained.finals[mh]?.model;
  if (!MODEL_METHODS.includes(sel) || !final) return { method: sel, total: null };
  const w = sel === 'blend' ? fit.blendWeight : sel === 'carry' ? fit.carryWeight : 1;
  const x = featureVector(c, unit, origin);
  const e = final.explain(x);
  const anchor = w < 1 ? (1 - w) * anchorRate(unit, origin, trained.units) * mh : 0;
  const features = FEATURES.map((name, j) => ({ name, value: finite(x[j]) ? round(x[j], 3) : null, typical: round(e.typical[j], 3), contribution: round(w * e.parts[j], 3) }))
    .filter(f => f.value != null && Math.abs(f.contribution) >= 0.005);
  const base = w * e.intercept;
  // Historical reality anchor: the model part is scaled by (1 - rw) and the analogue takes rw.
  const rw = fit.realityWeight ?? 0, pool = trained.finals[h]?.samples;
  const an = rw > 0 && pool ? analogue(pool, x) : null;
  const k = an ? 1 - rw : 1;
  const modelTotal = base + anchor + w * e.parts.reduce((s, v) => s + v, 0);
  const scaled = features.map(f => ({ ...f, contribution: round(f.contribution * k, 3) }));
  return { method: sel, modelHorizon: mh, weight: w, base: round(base * k, 3), anchor: round(anchor * k, 3), features: scaled,
    reality: an ? { weight: rw, analog: round(an.value, 3), p10: round(an.p10, 3), p90: round(an.p90, 3), n: an.n, share: round(rw * an.value, 3), model: round(modelTotal, 3) } : null,
    total: round(modelTotal * k + (an ? rw * an.value : 0), 3) };
}

export function trainEngine({ panel, forecasts }, options = {}) {
  const latestYear = options.latestYear ?? Math.max(...Object.values(panel).map(c => lastYear(c.PRICE) || 0));
  const units = buildUnits(panel);
  const trained = Object.fromEntries(Object.entries(units).map(([target, list]) => [target, trainTarget(panel, list, latestYear, { anchor: ANCHOR_TARGETS.has(target) })]));
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
    const ctx = contexts[unit.iso3] = { origin: price.origin, inflation: infl, realPriceCum: price.cum, nominalAdd, priceSource: c.PRICE_SOURCE, drivers: price.drivers };

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
      Object.assign(ctx, { rentOrigin: rent.origin, realRentCum: rent.cum, rentNominalAdd, rentDrivers: rent.drivers });
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
      target, horizon: h, method: methodLabel(f) + (f.realityWeight > 0 ? `, ${Math.round(f.realityWeight * 100)}% historical analogue` : ''), status: f.noSkill ? 'no model skill, showing baseline' : 'out-of-sample skill',
      mae: round(f.scores[f.shippedKey ?? f.selected].mae), rmse: round(f.scores[f.shippedKey ?? f.selected].rmse), baseline_mae: round(f.scores.zero.mae), baseline_rmse: round(f.scores.zero.rmse),
      skill_pct: round(100 * (1 - f.scores[f.shippedKey ?? f.selected].mae / f.scores.zero.mae), 1), coverage80: round(100 * f.coverage, 1), n_origins: f.nOrigins, n_records: f.records.length, basis: f.basis,
    });
  }
  // Household credit share (× GDP) per country; the pooled table is quoted at the median.
  const creditShare = Object.fromEntries(Object.entries(panel).map(([iso3, c]) => { const y = lastYear(c.HH_CREDIT); return [iso3, y ? c.HH_CREDIT[y] / 100 : null]; }));
  const medianShare = median(Object.values(creditShare).filter(finite)) || 0.5;
  // Scenario sensitivity is separate from the point forecast: the toggle uses the direct
  // rate estimate at each fitted horizon, whichever method won the backtest there.
  //  - prices: an estimate counts if it has the expected sign (<= 0) and is clear (|coef| >= 1.64 se);
  //    past the last such horizon the effect is held at that level (a sustained rate move shifts
  //    the price level), and a horizon before the first reliable one gets 0;
  //  - rents: the sign is free, but only clear estimates count, held the same way.
  // Which horizons count is decided once, on the precise pooled estimate at the median
  // household credit; countries then differ only where the debt interaction is itself clear
  // (|inter| >= 1.64 se). Testing clarity country by country made high-debt countries flip
  // randomly between horizons, because their scaled estimates extrapolate past the data.
  const pooledPlan = target => {
    const tr = trained[target], priceLike = target !== 'real_rent';
    const plan = {};
    let src = null;
    for (const h of FIT_HORIZONS) {
      const s = tr.sensitivity[h]?.at(medianShare);
      if (!s) continue;
      const clear = s.se > 0 ? Math.abs(s.coef) >= 1.64 * s.se : s.coef !== 0;
      if (clear && (!priceLike || s.coef <= 0)) src = h;
      plan[h] = src;
    }
    return plan;
  };
  const plans = Object.fromEntries(Object.keys(trained).map(t => [t, pooledPlan(t)]));
  // Debt scaling is one decision per target: on only if the interaction is clear at the
  // horizon whose effect carries through to year 10, then applied to every horizon.
  const debtScaling = Object.fromEntries(Object.entries(plans).map(([t, plan]) => {
    const last = Object.values(plan).filter(v => v != null).at(-1);
    const v = last != null ? trained[t].sensitivity[last] : null;
    return [t, !!v && v.interSe > 0 && Math.abs(v.inter) >= 1.64 * v.interSe];
  }));
  const sensFor = (target, k) => {
    const tr = trained[target], plan = plans[target];
    const pts = {};
    for (const h of FIT_HORIZONS) {
      if (!(h in plan)) continue;
      const src = plan[h];
      if (src == null) { pts[h] = { coef: 0, se: tr.sensitivity[h].at(medianShare).se }; continue; }
      const v = tr.sensitivity[src];
      const s = v.at(debtScaling[target] ? k : medianShare);
      pts[h] = { coef: s.coef, se: s.se };
    }
    const coefs = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.coef])));
    const ses = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.se])));
    return { coefs, ses, raw: pts, debtScaled: debtScaling[target] };
  };
  const validity = {};
  for (const target of Object.keys(trained)) {
    const priceLike = target !== 'real_rent';
    const { coefs, ses, raw } = sensFor(target, medianShare);
    // Prices must fall when rates rise; a wrong-signed estimate disables the toggle for that target.
    const wrongSign = priceLike && Object.values(raw).every(v => v.coef === 0);
    validity[target] = !wrongSign;
    for (const h of ALL_HORIZONS) {
      if (!finite(coefs[h])) continue;
      sensitivities.push({ target, horizon: h, coef: round(priceLike ? Math.min(0, coefs[h]) : coefs[h], 4), se: round(ses[h], 4), valid: wrongSign ? 0 : 1,
        note: wrongSign ? 'no horizon gave a clear, correctly signed rate effect on prices; toggle disabled'
          : `${sensFor(target, medianShare).debtScaled ? `quoted at the median household credit of ${Math.round(medianShare * 100)}% of GDP; countries differ where the household-debt interaction is statistically clear` : 'pooled across countries; the household-debt interaction was not statistically clear, so every country gets the same effect'}${priceLike ? '' : '; rent sign estimated freely'}` });
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
  // Driver sensitivities for the scenario builder: pooled, sign free, only clear estimates count,
  // the last clear horizon held forward (same plan as the rate effect, without debt scaling).
  const featureSensitivities = [];
  for (const target of ['real_price', 'real_rent']) {
    const tr = trained[target];
    if (!tr) continue;
    for (const [feature, name] of Object.entries(SCENARIO_FEATURES)) {
      const idx = FEATURES.indexOf(name);
      const pts = {};
      let held = null;
      for (const h of FIT_HORIZONS) {
        if (!tr.finals[h]) continue;
        const s = featureSensitivity(tr.finals[h].model, tr.boots[h] || [], [idx]);
        if (s.se > 0 && Math.abs(s.coef) >= 1.64 * s.se) held = s;
        pts[h] = held ?? { coef: 0, se: s.se };
      }
      const valid = Object.values(pts).some(v => v.coef !== 0);
      const coefs = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.coef])));
      const ses = interpolate(Object.fromEntries(Object.entries(pts).map(([h, v]) => [h, v.se])));
      for (const h of ALL_HORIZONS) if (finite(coefs[h])) featureSensitivities.push({ target, feature, horizon: h, coef: round(coefs[h], 4), se: round(ses[h], 4), valid: valid ? 1 : 0,
        note: valid ? `pooled; per +1 ${feature === 'unemployment_change' ? 'percentage point of unemployment change' : 'percentage point of annual growth'}; model-implied association, only statistically clear horizons count` : 'no horizon gave a statistically clear effect' });
    }
  }
  // Pseudo-out-of-sample track record points (shipped method) for the track-record page.
  const backtestPoints = [];
  for (const target of ['real_price', 'real_rent']) for (const h of [1, 3, 5]) {
    const f = trained[target]?.fits[h];
    if (!f) continue;
    const label = methodLabel(f);
    for (const r of f.records) backtestPoints.push({ country: r.unit, target, horizon: h, origin: r.origin, predicted: round(r[f.shippedKey ?? f.selected], 3), actual: round(r.actual, 3), method: label });
  }
  // Backtest residual inputs for the event library (short horizons only).
  const backtestRecords = {};
  for (const target of ['real_price', 'real_rent']) for (const h of [1, 2, 3]) {
    const f = trained[target]?.fits[h];
    if (f) ((backtestRecords[target] ||= {})[h] = f.records.map(r => ({ unit: r.unit, origin: r.origin, actual: r.actual, predicted: r[f.shippedKey ?? f.selected] })));
  }
  return { modelVersion: MODEL_VERSION, latestYear, projections, backtests, sensitivities, featureSensitivities, backtestPoints, contexts, backtestRecords, units: Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.length])) };
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
