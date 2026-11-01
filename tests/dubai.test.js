import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketMd, parseMarketJson, parseRentsYields } from '../lib/sources/national/dubai.js';
import { detectSalesSlumps } from '../lib/live/detect.js';

test('parseMarketMd reads monthly sales and median AED/sqft', () => {
  const md = '| Month | Sales | Median | IQR |\n|---|---|---|---|\n| 2025-10 | 19,419 | AED 1,688 | 1,378–2,223 |\n| 2026-09 | 11,033 | AED 1,695 | 1,376–2,152 |';
  const rows = parseMarketMd(md);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.filter(r => r.indicator === 'SALES_COUNT').map(r => [r.period, r.value]), [['2025-10', 19419], ['2026-09', 11033]]);
  assert.ok(rows.every(r => r.country === 'ARE' && r.region === 'Dubai'));
});

test('parseMarketJson maps the DLD index quarter', () => {
  const [r] = parseMarketJson({ dldPriceIndex: { quarterStart: '2025-10-01', value: 167.33 } });
  assert.equal(r.period, '2025-Q4');
  assert.equal(r.value, 167.33);
});

test('parseRentsYields converts annual rent to monthly and reads yields', () => {
  const rows = parseRentsYields('- Median annual rent, NEW apartment contracts: AED 75,000 (12M to 26 Oct 2026, n = 1)', '- Citywide gross yield, villas: 4.7% (x)\n- Citywide gross yield, apartments: 6.1% (y)');
  assert.equal(rows.find(r => r.indicator === 'AVG_RENT').value, 6250);
  assert.equal(rows.find(r => r.dwelling_type === 'house').value, 4.7);
});

test('detectSalesSlumps flags a 3-month year-on-year drop beyond the threshold', () => {
  const monthly = {};
  for (let m = 1; m <= 12; m++) monthly[`2025-${String(m).padStart(2, '0')}`] = 20000;
  for (let m = 1; m <= 9; m++) monthly[`2026-${String(m).padStart(2, '0')}`] = m >= 7 ? 12000 : 20000;
  const [e] = detectSalesSlumps({ today: '2026-11-01', sales: { ARE: { region: 'Dubai', monthly } } });
  assert.equal(e.class, 'transaction_slump');
  assert.equal(e.intensity, -40);
  assert.equal(e.evidence.applies, false);
  assert.equal(detectSalesSlumps({ today: '2026-11-01', sales: { ARE: { region: 'Dubai', monthly: { ...monthly, '2026-07': 20000, '2026-08': 20000, '2026-09': 20000 } } } }).length, 0);
});
