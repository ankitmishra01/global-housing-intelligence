import test from 'node:test';
import assert from 'node:assert/strict';
import { annualGaps, bigJumps, growthCorrelation, monthsOld, bandIntegrity, bandNarrowing, tierMismatches } from '../sync/quality.js';
import { annualAverage } from '../lib/sources/util.js';
import { deriveSeries } from '../lib/engine/panel.js';
import { fitRidge } from '../lib/engine/stats.js';
import { trailingGap } from '../lib/engine/projections.js';

test('annualGaps finds missing years inside the span only', () => {
  assert.deepEqual(annualGaps({ 2000: 1, 2001: 1, 2004: 1 }), [2002, 2003]);
  assert.deepEqual(annualGaps({ 2000: 1 }), []);
});

test('bigJumps flags moves beyond the limit', () => {
  const j = bigJumps({ 2000: 100, 2001: 140, 2002: 141 });
  assert.equal(j.length, 1);
  assert.equal(j[0].year, 2001);
});

test('growthCorrelation is 1 for proportional series and null when overlap is short', () => {
  const a = {}, b = {};
  for (let y = 2000; y <= 2015; y++) { a[y] = 100 * 1.03 ** (y - 2000) * (1 + (y % 3) / 50); b[y] = 2 * a[y]; }
  assert.ok(growthCorrelation(a, b).r > 0.999);
  assert.equal(growthCorrelation({ 2000: 1, 2001: 2 }, { 2000: 1, 2001: 2 }), null);
});

test('monthsOld handles annual, quarterly, monthly and daily periods', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(monthsOld('2025', now), 11);
  assert.equal(monthsOld('2026-Q2', now), 5);
  assert.equal(monthsOld('2026-09', now), 2);
  assert.equal(monthsOld('2026-10-30', now), 1);
});

test('bandIntegrity catches unordered and non-finite rows', () => {
  const rows = [
    { country: 'A', target: 'real_price', horizon: 1, p10: 90, p25: 95, median: 100, p75: 105, p90: 110 },
    { country: 'B', target: 'real_price', horizon: 1, p10: 90, p25: 99, median: 98, p75: 105, p90: 110 },
    { country: 'C', target: 'real_price', horizon: 1, p10: NaN, p25: 95, median: 100, p75: 105, p90: 110 },
  ];
  assert.deepEqual(bandIntegrity(rows).map(r => r.reason), ['unordered', 'non-finite']);
});

test('bandNarrowing flags a band that shrinks with horizon', () => {
  const rows = [
    { country: 'A', target: 'real_price', horizon: 1, p10: 90, median: 100, p90: 110 },
    { country: 'A', target: 'real_price', horizon: 2, p10: 95, median: 100, p90: 105 },
  ];
  assert.equal(bandNarrowing(rows).length, 1);
});

test('tierMismatches enforces Tier 1 iff 8+ annual price points', () => {
  const countries = [{ iso3: 'A', tier: 1 }, { iso3: 'B', tier: 2 }, { iso3: 'C', tier: 1 }];
  assert.deepEqual(tierMismatches(countries, { A: 20, B: 10, C: 3 }).map(m => m.iso3), ['B', 'C']);
});

test('annualAverage keeps a completed year with one missing month, never the current year', () => {
  const pts = [];
  for (let m = 1; m <= 12; m++) if (m !== 10) pts.push({ period: `2025-${String(m).padStart(2, '0')}`, value: 1 });
  const thisYear = new Date().getUTCFullYear();
  for (let m = 1; m <= 11; m++) pts.push({ period: `${thisYear}-${String(m).padStart(2, '0')}`, value: 1 });
  const years = annualAverage(pts).map(p => p.period);
  assert.ok(years.includes('2025'));
  assert.ok(!years.includes(String(thisYear)));
});

test('derived real rents drop hyperinflation years', () => {
  const c = { RENT: { 1996: 100, 1997: 600, 1998: 900 }, INFLATION: { 1996: 100, 1997: 1000, 1998: 20 } };
  deriveSeries(c);
  assert.ok(Number.isFinite(c.REAL_RENT[1998]));
  assert.equal(c.REAL_RENT[1997], undefined);
  assert.equal(c.REAL_RENT[1996], undefined);
});

test('fitRidge winsorizes extreme prediction inputs', () => {
  const samples = [];
  for (let i = 0; i < 200; i++) { const x = (i % 20) - 10; samples.push({ x: [x], y: 2 * x }); }
  const m = fitRidge(samples, 0.001);
  // Far outside the training range the prediction is capped near the 97.5th percentile.
  assert.ok(m.predict([1000]) < 25);
});

test('trailingGap compares with the previous 20 years only', () => {
  const s = {};
  for (let y = 1990; y <= 2025; y++) s[y] = y < 2025 ? 100 : 120;
  assert.equal(Math.round(trailingGap(s, 2025)), 20);
  assert.equal(trailingGap({ 2024: 1, 2025: 1 }, 2025), null);
});
