// Affordability ratios and the mortgage stress index.
//
// Ratios use local-currency levels from national agencies where they exist. When a
// country has no household income series, GDP per head × 2.5 stands in for household
// income and the `basis` string says so; the two are never mixed silently.
import { finite, mean } from './stats.js';
import { lastYear, logGrowth } from './panel.js';
import { annuityFactor, percentileRank } from './indexes.js';

export const HOUSEHOLD_PROXY_MULTIPLIER = 2.5;
export const LTV = 0.8;
export const TERM_YEARS = 25;
export const MORTGAGE_SPREAD = 2.0;

const latest = series => { const y = lastYear(series); return y ? { year: y, value: series[y] } : null; };

function sortedMonthly(series) {
  return Object.keys(series || {}).filter(k => /^\d{4}-\d{2}$/.test(k) && finite(series[k])).sort().map(k => ({ period: k, value: series[k] }));
}

// Sahm-style trigger on monthly unemployment: the 3-month average minus the lowest
// 3-month average of the previous 12 months, in percentage points.
export function sahmGap(monthlySeries) {
  const m = sortedMonthly(monthlySeries);
  if (m.length < 15) return null;
  const avg3 = m.map((_, i) => (i >= 2 ? (m[i].value + m[i - 1].value + m[i - 2].value) / 3 : null));
  const last = avg3.length - 1;
  const prior = avg3.slice(last - 12, last).filter(finite);
  if (!prior.length || !finite(avg3[last])) return null;
  return { gap: avg3[last] - Math.min(...prior), asOf: m[last].period };
}

function monthlyChange12(monthlySeries) {
  const m = sortedMonthly(monthlySeries);
  if (m.length < 13) return null;
  const last = m.at(-1), [y, mo] = last.period.split('-');
  const prev = m.find(p => p.period === `${Number(y) - 1}-${mo}`);
  return prev ? { change: last.value - prev.value, latest: last.value, asOf: last.period } : null;
}

// Latest full-year income in local currency, with its basis.
export function householdIncome(c) {
  const median = latest(c.MEDIAN_HH_INCOME);
  if (median) return { value: median.value, year: median.year, basis: 'median household income (national statistics office)' };
  const gdp = latest(c.GDP_PC_LCU);
  if (gdp) return { value: gdp.value * HOUSEHOLD_PROXY_MULTIPLIER, year: gdp.year, basis: `GDP per head × ${HOUSEHOLD_PROXY_MULTIPLIER} (household income proxy)` };
  return null;
}

// national: optional { price, priceBasis, rent, rentBasis } from city/type rows the panel drops.
export function affordabilityMetrics(c = {}, monthly = {}, national = {}) {
  const out = {};
  const income = householdIncome(c);
  const avg = latest(c.AVG_PRICE), med = latest(c.MEDIAN_PRICE);
  const price = finite(national.price) ? { value: national.price, basis: national.priceBasis || 'national price level' }
    : avg ? { value: avg.value, basis: `average price, ${avg.year}` }
    : med ? { value: med.value, basis: `median sales price, ${med.year}` } : null;
  const rentLevel = finite(national.rent) ? { value: national.rent, basis: national.rentBasis || 'national rent level' }
    : latest(c.AVG_RENT) ? { value: latest(c.AVG_RENT).value, basis: `typical market rent, ${latest(c.AVG_RENT).year}` } : null;

  const mortgage = monthly.MORTGAGE_RATE ? sortedMonthly(monthly.MORTGAGE_RATE).at(-1) : null;
  const policy = monthly.POLICY_RATE ? sortedMonthly(monthly.POLICY_RATE).at(-1) : null;
  const rate = mortgage ? { value: mortgage.value, basis: 'national mortgage rate' } : policy ? { value: Math.max(0.1, policy.value + MORTGAGE_SPREAD), basis: `policy rate + ${MORTGAGE_SPREAD.toFixed(1)}pp` } : null;
  out.mortgageRate = rate?.value ?? null;

  if (price && income) {
    out.priceToIncome = price.value / income.value;
    out.priceToIncomeBasis = `${price.basis} ÷ ${income.basis}`;
  }
  if (price && income && rate) {
    const annualPayment = price.value * LTV * annuityFactor(rate.value, TERM_YEARS) * 12;
    out.mortgageToIncome = (100 * annualPayment) / income.value;
    out.mortgageToIncomeBasis = `${Math.round(LTV * 100)}% loan over ${TERM_YEARS} years at ${rate.value.toFixed(2)}% (${rate.basis}); ${income.basis}`;
  }
  if (rentLevel && income) {
    out.rentToIncome = (100 * rentLevel.value * 12) / income.value;
    out.rentToIncomeBasis = `${rentLevel.basis} × 12 ÷ ${income.basis}`;
  }
  if (income) out.incomeBasis = income.basis;

  const pti = latest(c.PTI_AVG);
  out.ptiVsHistory = pti ? pti.value - 100 : null;

  // Debt service: latest quarter where available, gap vs the 15-year average of annual values.
  const dsrQ = monthly.DSR_HH_Q ? Object.keys(monthly.DSR_HH_Q).sort().at(-1) : null;
  const dsrNow = dsrQ ? monthly.DSR_HH_Q[dsrQ] : latest(c.DSR_HH)?.value ?? null;
  const dy = lastYear(c.DSR_HH);
  const hist = dy ? Object.entries(c.DSR_HH).filter(([y]) => Number(y) > dy - 15 && Number(y) <= dy).map(([, v]) => v) : [];
  out.debtService = dsrNow;
  out.debtServiceGap = finite(dsrNow) && hist.length >= 5 ? dsrNow - mean(hist) : null;
  out.debtServiceAsOf = dsrQ || (dy ? String(dy) : null);

  // Unemployment: monthly harmonised where available (Sahm trigger), else IMF annual.
  const sahm = sahmGap(monthly.UNEMPLOYMENT_M);
  const ch12 = monthlyChange12(monthly.UNEMPLOYMENT_M);
  const ua = latest(c.UNEMPLOYMENT);
  out.unemployment = ch12?.latest ?? ua?.value ?? null;
  out.unemploymentAsOf = ch12?.asOf ?? (ua ? String(ua.year) : null);
  if (ch12) out.unemploymentChange12m = ch12.change;
  else if (ua && finite(c.UNEMPLOYMENT[ua.year - 1])) out.unemploymentChange12m = ua.value - c.UNEMPLOYMENT[ua.year - 1];
  else out.unemploymentChange12m = null;
  out.sahmGap = sahm?.gap ?? null;
  out.unemploymentRising = sahm ? sahm.gap >= 0.5 : finite(out.unemploymentChange12m) ? out.unemploymentChange12m >= 1.0 : false;
  out.unemploymentBasis = sahm ? 'monthly harmonised rate, Sahm-style 3-month trigger (≥ 0.5pp)' : 'annual rate, rise of 1pp or more in a year';

  // Real wages (OECD, constant prices).
  const wy = lastYear(c.REAL_WAGE);
  if (wy) {
    const g = [0, 1, 2].map(k => logGrowth(c.REAL_WAGE, wy - k - 1, wy - k)).filter(finite);
    out.realWageGrowth = logGrowth(c.REAL_WAGE, wy - 1, wy);
    out.realWageGrowth3y = g.length === 3 ? mean(g) : null;
    out.wageStagnation = finite(out.realWageGrowth3y) ? out.realWageGrowth3y <= 0.5 : false;
    out.realWageAsOf = String(wy);
  } else { out.realWageGrowth = null; out.realWageGrowth3y = null; out.wageStagnation = false; }

  out.hhDebt = latest(c.HH_CREDIT)?.value ?? null;
  return out;
}

export const STRESS_COMPONENTS = [
  { key: 'affordability', weight: 0.3, direction: 1, label: 'Mortgage payment as % of income (or price-to-income vs history)' },
  { key: 'debtServiceGap', weight: 0.2, direction: 1, label: 'Household debt service vs its 15-year average' },
  { key: 'unemploymentChange12m', weight: 0.2, direction: 1, label: 'Change in unemployment over 12 months' },
  { key: 'realWageGrowth3y', weight: 0.15, direction: -1, label: 'Real wage growth, 3-year average (lower = more stress)' },
  { key: 'hhDebt', weight: 0.15, direction: 1, label: 'Household debt, % of GDP' },
];

// 0-100, higher = more mortgage stress. Percentile ranks across all countries with data;
// affordability uses mortgage-to-income where it exists, else the OECD price-to-income gap,
// each ranked within its own distribution.
export function mortgageStressIndex(metrics, distributions) {
  let total = 0, weight = 0;
  const components = STRESS_COMPONENTS.map(spec => {
    let value = metrics[spec.key], dist = distributions[spec.key], basis = spec.key;
    if (spec.key === 'affordability') {
      if (finite(metrics.mortgageToIncome)) { value = metrics.mortgageToIncome; dist = distributions.mortgageToIncome; basis = 'mortgageToIncome'; }
      else { value = metrics.ptiVsHistory; dist = distributions.ptiVsHistory; basis = 'ptiVsHistory'; }
    }
    const pct = percentileRank(dist || [], value);
    const oriented = pct == null ? null : spec.direction > 0 ? pct : 100 - pct;
    if (oriented != null) { total += oriented * spec.weight; weight += spec.weight; }
    return { key: spec.key, basis, value: finite(value) ? +value.toFixed(2) : null, percentile: oriented == null ? null : +oriented.toFixed(1), weight: spec.weight };
  });
  return { score: weight >= 0.5 ? +(total / weight).toFixed(1) : null, components };
}

export function stressAll(metricsByCountry) {
  const keys = ['mortgageToIncome', 'ptiVsHistory', 'debtServiceGap', 'unemploymentChange12m', 'realWageGrowth3y', 'hhDebt'];
  const distributions = Object.fromEntries(keys.map(k => [k, Object.values(metricsByCountry).map(m => m[k]).filter(finite)]));
  const rows = Object.entries(metricsByCountry).map(([country, m]) => ({ country, ...mortgageStressIndex(m, distributions) })).filter(r => r.score != null);
  rows.sort((a, b) => b.score - a.score).forEach((r, i) => { r.rank = i + 1; });
  return { rows, distributions };
}

// Candidate ridge features for the projection engine (not wired in yet):
// [unemployment change over the year to t, real wage growth in t, debt service gap at t].
export function stressFeatures(c, t) {
  const u = finite(c.UNEMPLOYMENT?.[t]) && finite(c.UNEMPLOYMENT?.[t - 1]) ? c.UNEMPLOYMENT[t] - c.UNEMPLOYMENT[t - 1] : null;
  const w = logGrowth(c.REAL_WAGE, t - 1, t);
  const hist = Object.entries(c.DSR_HH || {}).filter(([y]) => Number(y) >= t - 15 && Number(y) < t).map(([, v]) => v);
  const d = finite(c.DSR_HH?.[t]) && hist.length >= 5 ? c.DSR_HH[t] - mean(hist) : null;
  return [u, w, d];
}
