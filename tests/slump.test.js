import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesSeries, salesYoY, findSalesSlumpEpisodes, estimateSlumpLibrary, slumpIsClear, SLUMP_CLASS } from '../lib/engine/events.js';
import { detectSalesSlumps } from '../lib/live/detect.js';

const monthly = (from, to, f) => {
  const out = [];
  for (let y = from; y <= to; y++) for (let m = 1; m <= 12; m++) out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: f(y, m) });
  return out;
};
const rows = (country, region, freq, pts) => pts.map(p => ({ country, region, frequency: freq, period: p.period, value: p.value }));

test('salesSeries prefers national monthly rows over regional or quarterly', () => {
  const r = [
    ...rows('GBR', 'England', 'M', monthly(1995, 2000, () => 900)),
    ...rows('GBR', '', 'M', monthly(2005, 2006, () => 1000)),
    ...rows('IRL', '', 'Q', [{ period: '2020-Q1', value: 10 }]),
    ...rows('ARE', 'Dubai', 'M', monthly(2025, 2025, () => 5)),
  ];
  const s = salesSeries(r);
  assert.equal(s.GBR.region, '');
  assert.equal(s.IRL.freq, 'Q');
  assert.equal(s.ARE.region, 'Dubai');
});

test('salesYoY uses 3 consecutive months, or the quarter for quarterly series', () => {
  const m = salesYoY({ freq: 'M', points: Object.fromEntries(monthly(2019, 2020, (y) => (y === 2020 ? 70 : 100)).map(p => [p.period, p.value])) });
  assert.equal(m[0].period, '2020-03'); // first window with a full prior-year window
  assert.ok(Math.abs(m.at(-1).yoyPct + 30) < 1e-9);
  const q = salesYoY({ freq: 'Q', points: { '2019-Q1': 100, '2020-Q1': 60 } });
  assert.deepEqual(q.map(x => [x.period, Math.round(x.yoyPct)]), [['2020-Q1', -40]]);
});

test('findSalesSlumpEpisodes takes the first breach and enforces a 24-month gap', () => {
  const pts = monthly(2000, 2006, (y, m) => (y === 2002 || (y === 2003 && m <= 6) ? 60 : y === 2005 && m >= 6 ? 60 : 100));
  const eps = findSalesSlumpEpisodes(salesSeries(rows('NLD', '', 'M', pts)));
  assert.deepEqual(eps.map(e => e.period), ['2002-02', '2005-08']); // 2005-07 is flat vs two years earlier (base-effect guard)
  assert.ok(eps.every(e => e.class === SLUMP_CLASS && e.depth <= -25));
});

test('calibration: a known post-slump underperformance gives a clear negative effect', () => {
  // Three countries, each with a 2008 slump; the model over-predicted the following years by ~8/h points.
  const countries = ['GBR', 'NLD', 'IRL'];
  const salesRows = countries.flatMap(c => rows(c, '', 'M', monthly(2005, 2010, (y) => (y === 2008 ? 60 : 100))));
  const records = { real_price: {}, real_rent: {} };
  for (const h of [1, 2, 3]) {
    records.real_price[h] = [];
    records.real_rent[h] = [];
    for (const c of countries) for (let origin = 2000; origin <= 2010; origin++) {
      const shock = origin === 2007 ? -8 * h + (c === 'IRL' ? -1 : c === 'GBR' ? 1 : 0) : 0;
      records.real_price[h].push({ unit: c, origin, actual: 2 + shock, predicted: 2 });
      records.real_rent[h].push({ unit: c, origin, actual: 1, predicted: 1 + (c === 'GBR' ? 0.1 : -0.1) });
    }
  }
  const { rows: lib, episodes } = estimateSlumpLibrary({ records, salesRows });
  assert.equal(episodes.length, 3);
  const h3 = lib.find(r => r.target === 'real_price' && r.horizon === 3);
  assert.ok(h3.effect < -10 && h3.n_episodes === 3);
  assert.equal(h3.effect.toFixed(1), (-24 * 3 / 5).toFixed(1)); // mean −24, shrunk by n/(n+2)
  assert.ok(slumpIsClear(lib, 'real_price'));
  assert.ok(!slumpIsClear(lib, 'real_rent'));
});

test('detectSalesSlumps: quarterly series, staleness and the applies flag', () => {
  const q = { IRL: { region: '', freq: 'Q', points: { '2025-Q1': 100, '2025-Q2': 100, '2025-Q3': 100, '2025-Q4': 100, '2026-Q1': 100, '2026-Q2': 60 } } };
  const [e] = detectSalesSlumps({ today: '2026-11-01', sales: q, applies: true });
  assert.equal(e.onset, '2026-04-01');
  assert.equal(e.evidence.applies, true);
  assert.equal(detectSalesSlumps({ today: '2028-01-01', sales: q }).length, 0); // stale
});

test('base-effect guard rejects the reversal of a one-off spike', () => {
  // 2021 spike (deadline pull-forward), 2022 back to normal: −50% yoy but flat vs two years earlier.
  const pts = monthly(2019, 2022, (y) => (y === 2021 ? 200 : 100));
  assert.equal(findSalesSlumpEpisodes(salesSeries(rows('GBR', '', 'M', pts))).length, 0);
  // A genuine fall: down vs one and two years earlier.
  const real = monthly(2019, 2022, (y) => (y === 2022 ? 60 : 100));
  assert.equal(findSalesSlumpEpisodes(salesSeries(rows('GBR', '', 'M', real))).length, 1);
});
