import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPanel } from '../lib/engine/panel.js';
import { trainEngine, validateEngineOutput, interpolate, bandWidths, ALL_HORIZONS } from '../lib/engine/projections.js';
import { validateRows, coverageReport } from '../lib/validate.js';
import { syntheticRows } from './synthetic.js';

const rows = syntheticRows();
const built = buildPanel(rows);
const out = trainEngine(built);

test('trainEngine produces validated projections for every synthetic country', () => {
  assert.equal(validateEngineOutput(out), true);
  const countries = new Set(out.projections.filter(p => p.target === 'real_price').map(p => p.country));
  assert.equal(countries.size, 32);
  for (const t of ['real_price', 'nominal_price', 'real_rent', 'nominal_rent', 'price_to_rent', 'real_price:condo']) assert.ok(out.projections.some(p => p.target === t), t);
  assert.equal(out.projections.filter(p => p.country === 'C00' && p.target === 'real_price').length, 10);
});

test('the 80% band widens (never narrows) with the horizon', () => {
  for (const country of ['C00', 'C15', 'C31']) {
    const widths = out.projections.filter(p => p.country === country && p.target === 'real_price').sort((a, b) => a.horizon - b.horizon).map(p => Math.log(p.p90 / p.p10));
    for (let i = 1; i < widths.length; i++) assert.ok(widths[i] >= widths[i - 1] - 1e-4, `${country} h${i + 1}`);
  }
});

test('the price model finds the rate effect: negative, valid, and model skill at short horizons', () => {
  const s = out.sensitivities.filter(r => r.target === 'real_price');
  assert.ok(s.every(r => r.valid === 1));
  assert.ok(s.find(r => r.horizon === 1).coef < 0 && s.find(r => r.horizon === 3).coef < 0);
  const bt = out.backtests.find(b => b.target === 'real_price' && b.horizon === 1);
  assert.equal(bt.status, 'out-of-sample skill');
  assert.ok(bt.skill_pct > 0);
});

test('a pure-noise rent series mostly falls back to a baseline, and any chance win is tiny', () => {
  const rent = out.backtests.filter(b => b.target === 'real_rent');
  assert.ok(rent.filter(b => b.status === 'no model skill, showing baseline').length >= 4);
  // Overlapping long-horizon windows leave few independent origins, so the held-out
  // gate can admit a chance win; it must stay within a few percent of no-change.
  for (const b of rent) assert.ok(b.skill_pct < 6, `h${b.horizon} skill ${b.skill_pct}`);
});

test('nominal price path sits above the real path when inflation is positive', () => {
  const real = out.projections.find(p => p.country === 'C03' && p.target === 'real_price' && p.horizon === 10);
  const nom = out.projections.find(p => p.country === 'C03' && p.target === 'nominal_price' && p.horizon === 10);
  assert.ok(nom.median > real.median);
});

test('interpolate fills horizons 1..10 linearly and holds the ends', () => {
  const r = interpolate({ 2: 2, 5: 5, 10: 10 });
  assert.deepEqual(ALL_HORIZONS.map(h => +r[h].toFixed(6)), [2, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('bandWidths are monotonic even when raw residual quantiles are not', () => {
  const fit = spread => ({ residuals: Array.from({ length: 101 }, (_, i) => (i - 50) * spread) });
  const w = bandWidths({ 1: fit(1), 2: fit(3), 3: fit(2), 5: fit(2), 7: fit(4), 10: fit(1) });
  for (let h = 2; h <= 10; h++) {
    assert.ok(w[h].p90 >= w[h - 1].p90 && w[h].p75 >= w[h - 1].p75);
    assert.ok(w[h].p10 <= w[h - 1].p10 && w[h].p25 <= w[h - 1].p25);
  }
});

test('validateRows rejects bad values and periods and dedupes keys', () => {
  const base = { country: 'CAN', indicator: 'VACANCY_RATE', region: '', period: '2024', frequency: 'A', value: 2, source: 'x' };
  const { rows: ok, rejected } = validateRows([
    base, { ...base, value: 3 }, { ...base, value: 99 }, { ...base, period: '24' }, { ...base, indicator: 'NOPE' }, { ...base, frequency: 'W' }, { ...base, value: NaN },
    { ...base, region: 'Toronto' },
  ]);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].value, 2, 'first source wins');
  assert.deepEqual(rejected.map(r => r.reason), ['outside [0, 40]', 'bad period', 'unknown indicator', 'bad frequency', 'non-finite value']);
});

test('coverageReport counts national, all-dwelling rows only', () => {
  const cov = coverageReport([
    { country: 'CAN', indicator: 'RENT', period: '2024', value: 1 },
    { country: 'USA', indicator: 'RENT', period: '2025', value: 1, status: 'actual' },
    { country: 'GBR', indicator: 'RENT', region: 'Wales', period: '2025', value: 1 },
    { country: 'FRA', indicator: 'RENT', dwelling_type: 'condo', period: '2025', value: 1 },
    { country: 'DEU', indicator: 'RENT', period: '2030', value: 1, status: 'forecast' },
  ]);
  assert.equal(cov.RENT.countries, 3);
  assert.equal(cov.RENT.latest, '2025');
});
