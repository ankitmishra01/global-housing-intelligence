import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOecdUnemployment, parseOecdWages, parseBisDsr } from '../lib/sources/stress.js';
import { parseFred } from '../lib/sources/national/united-states.js';
import { affordabilityMetrics, sahmGap, mortgageStressIndex, stressAll, stressFeatures, householdIncome } from '../lib/engine/affordability.js';
import { computeFlags } from '../lib/engine/flags.js';
import { computeSignals, describe } from '../lib/engine/signals.js';

const VALID = new Set(['CAN', 'USA', 'GBR', 'DEU']);
const ISO2 = new Map([['CA', 'CAN'], ['US', 'USA'], ['GB', 'GBR']]);

test('parseOecdUnemployment keeps countries, drops aggregates and bad periods', () => {
  const csv = 'DATAFLOW,REF_AREA,MEASURE,UNIT_MEASURE,TRANSFORMATION,ADJUSTMENT,SEX,AGE,ACTIVITY,FREQ,TIME_PERIOD,OBS_VALUE\n' +
    'X,CAN,UNE_LF_M,PT_LF_SUB,_Z,Y,_T,Y_GE15,_Z,M,2026-01,6.5\nX,OECD,UNE_LF_M,PT_LF_SUB,_Z,Y,_T,Y_GE15,_Z,M,2026-01,4.9\nX,USA,UNE_LF_M,PT_LF_SUB,_Z,Y,_T,Y_GE15,_Z,M,2026-02,\n';
  const rows = parseOecdUnemployment(csv, VALID);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].country, rows[0].period, rows[0].value, rows[0].frequency], ['CAN', '2026-01', 6.5, 'M']);
});

test('parseOecdWages keeps constant-price local-currency wages only', () => {
  const csv = 'DATAFLOW,REF_AREA,MEASURE,UNIT_MEASURE,PAY_PERIOD,PRICE_BASE,AGGREGATION_OPERATION,SEX,TIME_PERIOD,OBS_VALUE\n' +
    'X,CAN,WG,CAD,A,Q,MEAN,_Z,2024,85419.8\nX,CAN,WG,CAD,A,V,MEAN,_Z,2024,90000\nX,CAN,WG,USD_PPP,A,Q,MEAN,_Z,2024,60000\n';
  const rows = parseOecdWages(csv, VALID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 85419.8);
});

test('parseBisDsr keeps households and annualises complete years', () => {
  const lines = ['FREQ,BORROWERS_CTY,DSR_BORROWERS,TIME_PERIOD,OBS_VALUE'];
  for (const q of [1, 2, 3, 4]) lines.push(`Q,CA,H,2024-Q${q},${13 + q * 0.1}`);
  lines.push('Q,CA,H,2025-Q1,14', 'Q,CA,P,2024-Q1,20');
  const rows = parseBisDsr(lines.join('\n'), ISO2);
  assert.equal(rows.filter(r => r.frequency === 'Q').length, 5);
  const annual = rows.filter(r => r.frequency === 'A');
  assert.equal(annual.length, 1);
  assert.equal(annual[0].period, '2024');
  assert.ok(Math.abs(annual[0].value - 13.25) < 1e-9);
});

test('parseFred handles annual series (median household income)', () => {
  const { frequency, points } = parseFred('observation_date,MEHOINUSA646N\n2024-01-01,83160\n2025-01-01,87460\n', 'MEHOINUSA646N');
  assert.equal(frequency, 'A');
  assert.deepEqual(points.map(p => p.period), ['2024', '2025']);
});

const monthlyFrom = (start, values) => Object.fromEntries(values.map((v, i) => {
  const d = new Date(Date.UTC(start, i, 1));
  return [`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, v];
}));

test('Sahm trigger fires on a 0.5pp rise in the 3-month average and not on a flat series', () => {
  const flat = monthlyFrom(2024, Array(24).fill(5));
  assert.equal(sahmGap(flat).gap, 0);
  const rising = monthlyFrom(2024, [...Array(18).fill(5), 5.2, 5.4, 5.6, 5.8, 6, 6.2]);
  assert.ok(sahmGap(rising).gap >= 0.5);
  assert.equal(sahmGap(monthlyFrom(2024, [5, 5, 5])), null);
  const m = affordabilityMetrics({}, { UNEMPLOYMENT_M: rising });
  assert.equal(m.unemploymentRising, true);
  assert.ok(m.unemploymentChange12m > 0.9);
});

test('wage stagnation when 3-year real wage growth averages 0.5% or less', () => {
  const stagnant = affordabilityMetrics({ REAL_WAGE: { 2021: 100, 2022: 100.2, 2023: 100.1, 2024: 100.3 } });
  assert.equal(stagnant.wageStagnation, true);
  const growing = affordabilityMetrics({ REAL_WAGE: { 2021: 100, 2022: 102, 2023: 104, 2024: 106 } });
  assert.equal(growing.wageStagnation, false);
  assert.ok(growing.realWageGrowth3y > 1.9);
});

test('price-to-income labels its basis and falls back to a GDP proxy', () => {
  const withMedian = affordabilityMetrics({ MEDIAN_PRICE: { 2025: 400000 }, MEDIAN_HH_INCOME: { 2025: 80000 } }, { MORTGAGE_RATE: { '2026-10': 6 } });
  assert.equal(withMedian.priceToIncome, 5);
  assert.match(withMedian.priceToIncomeBasis, /median household income/);
  assert.ok(withMedian.mortgageToIncome > 30 && withMedian.mortgageToIncome < 32);
  const proxy = affordabilityMetrics({ AVG_PRICE: { 2025: 300000 }, GDP_PC_LCU: { 2025: 40000 } }, { POLICY_RATE: { '2026-09': 4 } });
  assert.equal(proxy.priceToIncome, 3);
  assert.match(proxy.priceToIncomeBasis, /GDP per head × 2.5/);
  assert.match(proxy.mortgageToIncomeBasis, /policy rate \+ 2.0pp/);
  assert.equal(householdIncome({}), null);
});

test('debt service gap is measured against the 15-year average', () => {
  const dsr = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [2015 + i, 10]));
  dsr[2025] = 13;
  const m = affordabilityMetrics({ DSR_HH: dsr });
  assert.ok(m.debtServiceGap > 2.5);
});

test('stress index needs at least half its weight and ranks stressed countries higher', () => {
  const metrics = {
    AAA: { mortgageToIncome: 50, debtServiceGap: 3, unemploymentChange12m: 1.2, realWageGrowth3y: -0.5, hhDebt: 100 },
    BBB: { mortgageToIncome: 20, debtServiceGap: -1, unemploymentChange12m: -0.3, realWageGrowth3y: 2, hhDebt: 40 },
    CCC: { ptiVsHistory: 10, unemploymentChange12m: 0.1, realWageGrowth3y: 1, hhDebt: 60 },
    DDD: { hhDebt: 80 },
  };
  const { rows } = stressAll(metrics);
  assert.equal(rows[0].country, 'AAA');
  assert.ok(!rows.some(r => r.country === 'DDD'), 'only 15% of weight available');
  const ccc = rows.find(r => r.country === 'CCC');
  assert.equal(ccc.components.find(c => c.key === 'affordability').basis, 'ptiVsHistory');
  assert.equal(mortgageStressIndex({}, {}).score, null);
});

test('stress flags fire at their thresholds and computeFlags stays backward compatible', () => {
  assert.deepEqual(computeFlags('XXX', {}, {}), []);
  const flags = computeFlags('XXX', {}, {}, { unemploymentRising: true, sahmGap: 0.6, unemploymentAsOf: '2026-09', wageStagnation: true, realWageGrowth3y: 0.2, realWageAsOf: '2024', stressScore: 80, debtServiceGap: 2.4, debtServiceAsOf: '2026-Q1' });
  assert.deepEqual(flags.map(f => f.flag).sort(), ['DEBT_SERVICE_HIGH', 'MORTGAGE_STRESS', 'UNEMPLOYMENT_RISING', 'WAGE_STAGNATION']);
  const none = computeFlags('XXX', {}, {}, { unemploymentRising: false, wageStagnation: false, stressScore: 74.9, debtServiceGap: 1.9 });
  assert.equal(none.length, 0);
});

test('signals: thresholds, stress downgrade for buyers/investors, seller urgency', () => {
  const components = {
    buyer: [{ key: 'ptiGap', value: -10, percentile: 80 }, { key: 'momentum', value: -2, percentile: 70 }, { key: 'burden3y', value: 30, percentile: 10 }],
    seller: [{ key: 'valuation', value: 40, percentile: 90 }],
  };
  const calm = computeSignals({ scores: { buyer: 70, investor: 50, renter: 30, seller: 50 }, components, flags: [] });
  assert.equal(calm.buyer.label, 'Favourable');
  assert.equal(calm.investor.label, 'Neutral');
  assert.equal(calm.renter.label, 'Landlord market');
  assert.equal(calm.buyer.support.length, 2);
  assert.match(calm.buyer.support[0], /below their long-run income ratio/);
  assert.match(calm.buyer.oppose[0], /Mortgage payments/);
  const stressed = computeSignals({ scores: { buyer: 70, investor: 50, renter: 50, seller: 50 }, components, flags: ['UNEMPLOYMENT_RISING'] });
  assert.equal(stressed.buyer.label, 'Neutral');
  assert.equal(stressed.buyer.adjusted, true);
  assert.equal(stressed.investor.label, 'Caution');
  assert.equal(stressed.seller.label, 'Good time to sell');
  assert.match(stressed.seller.support[0], /Unemployment is rising fast/);
  assert.equal(describe('flagCount', 0), 'No risk flags');
});

test('stressFeatures returns unemployment change, wage growth and DSR gap at t', () => {
  const c = { UNEMPLOYMENT: { 2023: 5, 2024: 6 }, REAL_WAGE: { 2023: 100, 2024: 101 }, DSR_HH: { 2015: 10, 2016: 10, 2017: 10, 2018: 10, 2019: 10, 2024: 12 } };
  const [u, w, d] = stressFeatures(c, 2024);
  assert.equal(u, 1);
  assert.ok(Math.abs(w - 100 * Math.log(1.01)) < 1e-9);
  assert.equal(d, 2);
});
