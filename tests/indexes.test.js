import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileRank, scorePersona, scoreAll, shiftComponents, annuityFactor, PERSONAS } from '../lib/engine/indexes.js';
import { computeFlags, quarterlyYoY } from '../lib/engine/flags.js';
import { shiftBand, annuity, monthlyPayment } from '../src/lib/toggle.ts';
import { buildRun, countryComponents } from '../sync/train.js';
import { syntheticRows } from './synthetic.js';

test('persona weights sum to 1', () => {
  for (const [k, p] of Object.entries(PERSONAS)) assert.equal(+p.components.reduce((s, c) => s + c.weight, 0).toFixed(6), 1, k);
});

test('percentileRank uses mid-rank for ties and ignores non-finite values', () => {
  assert.equal(percentileRank([1, 2, 3, 4], 3), 62.5);
  assert.equal(percentileRank([1, 1, 1], 1), 50);
  assert.equal(percentileRank([1, NaN, 3], 3), 75);
  assert.equal(percentileRank([], 1), null);
  assert.equal(percentileRank([1, 2], null), null);
});

test('scorePersona orients components and needs at least half the weight', () => {
  const dist = { proj10Rent: [0, 10, 20, 30], rentVsIncome: [-1, 0, 1, 2], ptrGap: [-20, 0, 20, 40] };
  const cheap = scorePersona('renter', { proj10Rent: 0, rentVsIncome: -1, ptrGap: 40 }, dist);
  const dear = scorePersona('renter', { proj10Rent: 30, rentVsIncome: 2, ptrGap: -20 }, dist);
  assert.ok(cheap.score > 80 && dear.score < 20);
  assert.equal(scorePersona('renter', { ptrGap: 40 }, dist).score, null, 'only 0.3 of the weight available');
  assert.notEqual(scorePersona('renter', { proj10Rent: 0, ptrGap: 40 }, dist).score, null, '0.7 of the weight available');
});

test('scoreAll ranks within each persona', () => {
  const comps = { A: { proj10Price: 30, ptrGap: -10, flagCount: 0, hhCredit: 40, volatility: 2 }, B: { proj10Price: -10, ptrGap: 40, flagCount: 3, hhCredit: 120, volatility: 9 }, C: { proj10Price: 10, ptrGap: 10, flagCount: 1, hhCredit: 80, volatility: 5 } };
  const { rows, distributions } = scoreAll(comps);
  const investor = rows.filter(r => r.persona === 'investor').sort((a, b) => a.rank - b.rank);
  assert.deepEqual(investor.map(r => r.country), ['A', 'C', 'B']);
  assert.deepEqual(distributions.proj10Price, [30, -10, 10]);
});

test('shiftComponents is the identity at 0 and moves rate-sensitive components otherwise', () => {
  const base = { proj10Price: 10, proj3Price: 4, proj10Rent: 5, burden3y: 12, rateTrend: 0.5, ptiGap: 3 };
  const sens = { real_price: { 3: -2, 10: -1 }, real_rent: { 10: 1.5 } };
  assert.deepEqual(shiftComponents(base, 0, sens, 5), base);
  const up = shiftComponents(base, 2, sens, 5);
  assert.equal(up.proj10Price, 8); assert.equal(up.proj3Price, 0); assert.equal(up.proj10Rent, 8); assert.equal(up.rateTrend, 2.5); assert.equal(up.ptiGap, 3);
  assert.ok(up.burden3y > base.burden3y);
  assert.ok(Math.abs(annuityFactor(0, 25) - 1 / 300) < 1e-12);
  assert.ok(annuityFactor(7) > annuityFactor(5));
});

test('toggle math: delta 0 is identity, +2pp lowers the median and widens the band when coef < 0', () => {
  const rows = [{ horizon: 3, year: 2028, p10: 90, p25: 96, median: 102, p75: 108, p90: 115 }];
  const sens = { 3: { coef: -2, se: 0.5, valid: true } };
  assert.deepEqual(shiftBand(rows, sens, 0), rows);
  const [up] = shiftBand(rows, sens, 2);
  assert.ok(up.median < 102);
  assert.ok(Math.log(up.p90 / up.p10) > Math.log(115 / 90));
  assert.deepEqual(shiftBand(rows, { 3: { coef: -2, se: 0.5, valid: false } }, 2), rows, 'invalid sensitivity leaves the path unchanged');
  assert.ok(Math.abs(annuity(0, 25) - 1 / 300) < 1e-12);
  assert.ok(Math.abs(monthlyPayment(500000, 20, 6, 25) - 2577.21) < 0.5);
});

test('computeFlags applies each threshold', () => {
  const c = {
    PTI_AVG: { 2025: 125 }, PTR_AVG: { 2025: 110 }, CREDIT_GAP: { 2025: 12 },
    REAL_RENT: { 2021: 100, 2022: 105, 2023: 110, 2024: 116 }, GDP_PC_GROWTH: { 2022: 1, 2023: 1, 2024: 1 },
  };
  const monthly = { REAL_PRICE_Q: { '2025-Q2': 100, '2026-Q2': 112 } };
  const flags = computeFlags('XXX', c, monthly).map(f => f.flag).sort();
  assert.deepEqual(flags, ['CREDIT_GAP', 'PRICES_HOT', 'PTI_HIGH', 'RENT_OUTPACING']);
  assert.deepEqual(quarterlyYoY({ '2026-Q1': 1 }), null);
});

test('buildRun on synthetic rows produces contexts, components, flags and index scores', () => {
  const run = buildRun(syntheticRows(), new Date('2026-11-01T00:00:00Z'));
  assert.equal(run.id, 'run_202611010000');
  assert.equal(run.contexts.length, 32);
  const ctx = run.contexts.find(c => c.country === 'C00');
  assert.equal(ctx.origin_year, 2025);
  assert.ok(Math.abs(ctx.mortgage_rate - (ctx.policy_rate + 2)) < 1e-9);
  assert.match(ctx.mortgage_rate_source, /assumed spread/);
  const details = JSON.parse(ctx.details);
  assert.ok(Number.isFinite(details.components.proj10Price));
  assert.ok(Number.isFinite(details.components.rateTrend));
  assert.ok(run.indexRows.some(r => r.persona === 'investor'));
  assert.equal(run.dataVintage, '2025');
  assert.equal(typeof countryComponents, 'function');
});

test('probe reads the run date from a run id or an ISO timestamp', async () => {
  const { runDate } = await import('../sync/probe.js');
  assert.equal(runDate({ run: { id: 'run_202611010110' } }).toISOString().slice(0, 10), '2026-11-01');
  assert.equal(runDate({ created_at: '2026-10-03T06:20:00Z' }).toISOString().slice(0, 10), '2026-10-03');
  assert.equal(runDate({}), null);
});
