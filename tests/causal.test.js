import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causalRateEffect, localProjection, monthlyToQuarterly, quarterKey } from '../lib/engine/causal.js';
import { parseShocks } from '../lib/sources/shocks.js';
import { mulberry32 } from '../lib/engine/stats.js';

// Panel of 6 units over 200 quarters. A unit shock lowers the log price level by 2 (×100)
// permanently and raises the policy rate by 1pp on impact, decaying at 0.8 a quarter.
function synthetic() {
  const rand = mulberry32(7), gauss = () => { let u = 0; for (let i = 0; i < 12; i++) u += rand(); return u - 6; };
  const shocks = {}, prices = {}, rates = {};
  const keys = Array.from({ length: 200 }, (_, i) => quarterKey(1975 + Math.floor(i / 4), (i % 4) + 1));
  keys.forEach(k => { shocks[k] = gauss(); });
  for (let u = 0; u < 6; u++) {
    let y = 100 * Math.log(100), r = 3;
    prices[`U${u}`] = {}; rates[`U${u}`] = {};
    keys.forEach(k => {
      y += -2 * shocks[k] + 0.3 * gauss() + 0.2;
      r = 3 + 0.8 * (r - 3) + 1 * shocks[k] + 0.05 * gauss();
      prices[`U${u}`][k] = Math.exp(y / 100);
      rates[`U${u}`][k] = r;
    });
  }
  return { shocks, prices, rates };
}

test('local projection recovers a known permanent response', () => {
  const { shocks, prices } = synthetic();
  const lp = localProjection(prices, shocks, [0, 4, 8], { transform: 'log' });
  for (const h of [0, 4, 8]) {
    // Later shocks add noise to longer horizons; the estimate should sit within 3 standard errors.
    assert.ok(lp[h].se > 0 && lp[h].se < 0.6, `h${h} se ${lp[h].se}`);
    assert.ok(Math.abs(lp[h].coef + 2) < 3 * lp[h].se + 0.05, `h${h} coef ${lp[h].coef} ± ${lp[h].se}`);
  }
});

test('causalRateEffect scales by the peak policy-rate response', () => {
  const { shocks, prices, rates } = synthetic();
  const est = causalRateEffect({ prices, rates, shocks });
  assert.equal(est.ratePeak.quarter, 0);
  assert.ok(Math.abs(est.ratePeak.coef - 1) < 0.05);
  assert.ok(Math.abs(est.perPp[1].coef + 2) < 0.2, `per pp ${est.perPp[1].coef}`);
});

test('monthlyToQuarterly needs two months and parseShocks sums by quarter', () => {
  assert.deepEqual(monthlyToQuarterly({ '2025-01': 2, '2025-02': 4, '2025-04': 9 }), { '2025-Q1': 3 });
  const q = parseShocks('year,month,MP_median\n2025,1,0.1\n2025,3,-0.05\n2025,4,0.2\n');
  assert.ok(Math.abs(q['2025-Q1'] - 0.05) < 1e-12);
  assert.equal(q['2025-Q2'], 0.2);
});
