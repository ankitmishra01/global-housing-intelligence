import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPanel, trailingYear } from '../lib/engine/panel.js';
import { evaluate, anchorRate, longRunRate, buildUnits, trainEngine, BLEND_WEIGHTS, methodLabel } from '../lib/engine/projections.js';
import { runsToPrune, scoreVintages, latestQuarterVsOrigin } from '../sync/train.js';
import { mulberry32 } from '../lib/engine/stats.js';
import { syntheticRows } from './synthetic.js';

// Series that grow at their own persistent long-run rate plus noise: the anchor should help.
function anchorRows({ countries = 30, from = 1965, to = 2025, seed = 11 } = {}) {
  const rand = mulberry32(seed);
  const normal = () => { const u = Math.max(rand(), 1e-12), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rows = [];
  const push = (country, indicator, period, value, frequency = 'A') => rows.push({ country, indicator, region: '', dwelling_type: '', period: String(period), frequency, value, status: 'actual', source: 'synthetic' });
  for (let i = 0; i < countries; i++) {
    const iso3 = `A${String(i).padStart(2, '0')}`;
    const trend = -1 + (4 * i) / countries; // -1% to +3% a year, country specific and persistent
    let price = 100;
    for (let y = from; y <= to; y++) {
      push(iso3, 'INFLATION', y, 2);
      push(iso3, 'POLICY_RATE', y, 4);
      push(iso3, 'REAL_PRICE', y, price);
      push(iso3, 'NOMINAL_PRICE', y, price);
      price *= Math.exp((trend + 3 * normal()) / 100);
    }
  }
  return rows;
}

test('longRunRate and anchorRate shrink a short history toward the pooled mean', () => {
  const units = [
    { id: 'A', series: Object.fromEntries(Array.from({ length: 31 }, (_, k) => [1995 + k, 100 * Math.exp((2 * k) / 100)])) },
    { id: 'B', series: Object.fromEntries(Array.from({ length: 31 }, (_, k) => [1995 + k, 100])) },
    { id: 'C', series: { 2023: 100, 2024: 110, 2025: 121 } },
  ];
  assert.ok(Math.abs(longRunRate(units[0].series, 2025).mean - 2) < 1e-9);
  const pooled = 1; // mean of A (2) and B (0); C has under 8 years and is excluded from the pool
  const a = anchorRate(units[2], 2025, units);
  const own = longRunRate(units[2].series, 2025);
  assert.ok(Math.abs(a - (own.n * own.mean + 10 * pooled) / (own.n + 10)) < 1e-9);
  assert.ok(a < own.mean && a > pooled);
});

test('evaluate scores the anchor and a blend with a weight from the allowed set', () => {
  const { panel } = buildPanel(anchorRows());
  const units = buildUnits(panel).real_price;
  const f = evaluate(panel, units, 5, 2025);
  assert.ok(BLEND_WEIGHTS.includes(f.blendWeight));
  assert.ok(f.scores.anchor && f.scores.blend);
  // With persistent country trends, the anchor beats no change on held-out origins.
  assert.ok(f.scores.anchor.mae < f.scores.zero.mae);
  assert.ok(['ridge', 'blend', 'carry', 'anchor', 'drift', 'zero'].includes(f.selected));
  assert.ok(methodLabel(f).length > 0);
});

test('anchor off keeps the earlier candidate set (no blend, anchor not a baseline)', () => {
  const { panel } = buildPanel(anchorRows());
  const units = buildUnits(panel).real_price;
  const f = evaluate(panel, units, 5, 2025, null, { anchor: false });
  assert.equal(f.blendWeight, 1);
  assert.notEqual(f.selected, 'anchor');
  assert.notEqual(f.selected, 'blend');
});

test('trailingYear averages the four quarters ending at the chosen quarter', () => {
  const q = { '2024-Q3': 1, '2024-Q4': 2, '2025-Q1': 3, '2025-Q2': 4, '2025-Q3': 5, '2025-Q4': 6, '2026-Q1': 7, '2026-Q2': 8 };
  const ttm = trailingYear(q, 2);
  assert.equal(ttm[2025], (1 + 2 + 3 + 4) / 4);
  assert.equal(ttm[2026], (5 + 6 + 7 + 8) / 4);
  assert.equal(trailingYear(q, 4)[2025], (3 + 4 + 5 + 6) / 4);
  assert.equal(trailingYear(q, 4)[2024], undefined); // incomplete
});

test('buildPanel ttm option re-annualises BIS prices and labels the origin', () => {
  const rows = syntheticRows({ countries: 4, from: 2010, to: 2025 });
  for (const c of ['C00', 'C01', 'C02', 'C03']) for (let y = 2010; y <= 2026; y++) for (let q = 1; q <= 4; q++) {
    if (y === 2026 && q > 2) continue;
    rows.push({ country: c, indicator: 'REAL_PRICE', region: '', dwelling_type: '', period: `${y}-Q${q}`, frequency: 'Q', value: 100 + y - 2010 + q / 10, status: 'actual', source: 'BIS' });
  }
  const { panel } = buildPanel(rows, { ttm: true });
  assert.deepEqual(panel.C00.TTM, { quarter: 2, latest: '2026-Q2' });
  assert.ok(Number.isFinite(panel.C00.PRICE[2026]));
  const cal = buildPanel(rows, { ttm: false }).panel;
  assert.equal(cal.C00.TTM, undefined);
});

test('latestQuarterVsOrigin rebases the latest quarter to the origin-year average', () => {
  const q = { '2025-Q1': 100, '2025-Q2': 100, '2025-Q3': 100, '2025-Q4': 100, '2026-Q1': 102, '2026-Q2': 103 };
  assert.deepEqual(latestQuarterVsOrigin(q, 2025, 'BIS'), { quarter: '2026-Q2', index: 103, changePct: 3 });
  assert.equal(latestQuarterVsOrigin(q, 2025, 'OECD'), null);
  assert.equal(latestQuarterVsOrigin(q, 2026, 'BIS'), null);
});

test('scoreVintages scores past projections once the target year is observed', () => {
  const panel = { CAN: { PRICE: { 2023: 100, 2024: 104, 2025: 103 } } };
  const projections = [
    { run_id: 'r1', country: 'CAN', target: 'real_price', year: 2024, horizon: 1, median: 102, p10: 98, p90: 106 },
    { run_id: 'r1', country: 'CAN', target: 'real_price', year: 2027, horizon: 4, median: 110, p10: 95, p90: 125 },
  ];
  const [s, ...rest] = scoreVintages({ projections, contexts: [{ run_id: 'r1', country: 'CAN', details: '{}' }], panel, scoredAt: 'now' });
  assert.equal(rest.length, 0);
  assert.equal(s.actual, 104);
  assert.equal(s.error, 2);
  assert.equal(s.in80, 1);
});

test('runsToPrune keeps the latest runs and the last run of every month', () => {
  const runs = [];
  for (let d = 1; d <= 20; d++) runs.push({ id: `nov${d}`, created_at: `2026-11-${String(d).padStart(2, '0')}T00:00:00Z` });
  runs.push({ id: 'oct-a', created_at: '2026-10-05T00:00:00Z' }, { id: 'oct-b', created_at: '2026-10-28T00:00:00Z' });
  const prune = runsToPrune(runs);
  assert.ok(!prune.includes('oct-b'));   // last of October, kept forever
  assert.ok(prune.includes('oct-a'));
  assert.ok(!prune.includes('nov20') && !prune.includes('nov11'));
  assert.ok(prune.includes('nov10'));
  assert.equal(prune.length, 11);
});

test('trainEngine emits feature sensitivities and backtest points', () => {
  const out = trainEngine(buildPanel(syntheticRows()));
  assert.ok(out.featureSensitivities.length > 0);
  assert.deepEqual([...new Set(out.featureSensitivities.map(r => r.feature))].sort(), ['real_gdp_growth', 'real_wage_growth', 'unemployment_change']);
  // Features absent from the synthetic panel can never be "clear": they must be zero and invalid.
  assert.ok(out.featureSensitivities.filter(r => r.feature === 'unemployment_change').every(r => r.coef === 0 && r.valid === 0));
  assert.ok(out.backtestPoints.length > 0);
  assert.ok(out.backtestPoints.every(p => [1, 3, 5].includes(p.horizon) && Number.isFinite(p.predicted)));
});

test('partial-year nowcast fills unpublished quarters with the latest one', async () => {
  const { partialYearNowcast } = await import('../lib/engine/projections.js');
  const q = { '2025-Q1': 100, '2025-Q2': 100, '2025-Q3': 100, '2025-Q4': 100, '2026-Q1': 102, '2026-Q2': 104 };
  const nc = partialYearNowcast(q, 2025);
  assert.equal(nc.quartersKnown, 2);
  assert.ok(Math.abs(nc.cum - 100 * Math.log(103.5 / 100)) < 1e-9);
  assert.equal(partialYearNowcast({ ...q, '2025-Q4': undefined }, 2025), null);
  assert.equal(partialYearNowcast({ '2025-Q1': 1, '2025-Q2': 1, '2025-Q3': 1, '2025-Q4': 1 }, 2025), null);
});
