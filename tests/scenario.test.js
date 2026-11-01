import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScenario, combinedShift, adjustStress, nonRateShift, annuity, ZERO, PRESETS } from '../src/lib/scenario.ts';

const band = h => ({ horizon: h, year: 2025 + h, p10: 90, p25: 95, median: 100, p75: 105, p90: 110 });
const sens = {
  rate: { 1: { coef: -0.6, se: 0.1, valid: true }, 10: { coef: -1.3, se: 0.6, valid: true } },
  unemployment: { 1: { coef: -0.6, se: 0.15, valid: true }, 10: { coef: -4.2, se: 1.4, valid: true } },
  wages: { 10: { coef: 0.18, se: 0.09, valid: false } },
};

test('zero scenario leaves bands unchanged', () => {
  const rows = [band(1), band(10)];
  assert.deepEqual(applyScenario(rows, sens, ZERO), rows);
});

test('shifts add across valid drivers and skip invalid ones', () => {
  const { shift, extra } = combinedShift(sens, { rate: 1, unemployment: 2, wages: 3, gdp: 0 }, 10);
  assert.ok(Math.abs(shift - (-1.3 - 8.4)) < 1e-9); // wages invalid: ignored
  assert.ok(Math.abs(extra - Math.hypot(0.6, 2.8)) < 1e-9);
  assert.ok(Math.abs(nonRateShift(sens, { rate: 1, unemployment: 2, wages: 0, gdp: 0 }, 10) - -8.4) < 1e-9);
});

test('applyScenario lowers the median and widens the band for a recession', () => {
  const [out] = applyScenario([band(10)], sens, PRESETS.find(p => p.label === 'Recession').scenario);
  assert.ok(out.median < 100);
  assert.ok(out.p90 - out.p10 > 20);
  assert.ok(out.p10 <= out.p25 && out.p25 <= out.median && out.median <= out.p75 && out.p75 <= out.p90);
});

test('adjustStress moves mortgage burden with rates, prices and income', () => {
  const m = { mortgageToIncome: 30, debtService: 14, debtServiceGap: 0.5, unemploymentChange12m: 0.1, realWageGrowth3y: 1, mortgageRate: 5 };
  const out = adjustStress(m, { rate: 1, unemployment: 2, wages: -1, gdp: 0 }, -5);
  const ratio = annuity(6) / annuity(5);
  assert.ok(Math.abs(out.mortgageToIncome - (30 * ratio * Math.exp(-0.05)) / 0.99) < 1e-9);
  assert.ok(Math.abs(out.debtServiceGap - (0.5 + 14 * (ratio - 1) * 0.5)) < 1e-9);
  assert.equal(out.unemploymentChange12m, 2.1);
  assert.equal(out.realWageGrowth3y, 0);
  assert.equal(out.mortgageRate, 6);
});
