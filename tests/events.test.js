import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEventLibrary, EVENT_CLASSES, EPISODES } from '../lib/engine/events.js';

// Synthetic backtest records: 10 units × origins 1996-2020, residual noise ±1,
// plus an injected −15 point drop after each listed episode.
function records(episodes, drop = -15) {
  const out = { real_price: {}, real_rent: {} };
  for (const target of ['real_price', 'real_rent']) for (const h of [1, 2, 3]) {
    const list = [];
    for (let u = 0; u < 10; u++) for (let origin = 1996; origin <= 2020; origin++) {
      const unit = `U${u}`;
      const noise = ((u * 7 + origin * 3 + h) % 5) - 2;
      const hit = episodes.some(e => e.country === unit && e.year - 1 === origin);
      list.push({ unit, origin, predicted: 0, actual: noise * 0.5 + (hit && target === 'real_price' ? drop * h : 0) });
    }
    out[target][h] = list;
  }
  return out;
}

const eps = [
  { country: 'U1', year: 2005, class: 'armed_conflict', label: 'a' },
  { country: 'U2', year: 2010, class: 'armed_conflict', label: 'b' },
  { country: 'U3', year: 2015, class: 'armed_conflict', label: 'c' },
  { country: 'U4', year: 2012, class: 'natural_disaster', label: 'd' },
  { country: 'NOPE', year: 2012, class: 'natural_disaster', label: 'no data' },
];

test('injected drop yields a negative, shrunk effect', () => {
  const rows = estimateEventLibrary({ records: records(eps), episodes: eps, classes: ['armed_conflict'] });
  const r1 = rows.find(r => r.class === 'armed_conflict' && r.target === 'real_price' && r.horizon === 1);
  assert.equal(r1.n_episodes, 3);
  assert.ok(r1.effect < -7 && r1.effect > -15, `effect ${r1.effect} should be shrunk by 3/5 toward 0`);
  assert.ok(Math.abs(r1.effect - (-15 * 3 / 5)) < 1);
  const r3 = rows.find(r => r.class === 'armed_conflict' && r.target === 'real_price' && r.horizon === 3);
  assert.ok(r3.effect < r1.effect, 'longer horizon accumulates the larger injected drop');
  const rent = rows.find(r => r.class === 'armed_conflict' && r.target === 'real_rent' && r.horizon === 1);
  assert.ok(Math.abs(rent.effect) < 1.5, 'no injected rent effect');
});

test('classes with fewer than 2 episodes fall back to the pooled mean', () => {
  const rows = estimateEventLibrary({ records: records(eps), episodes: eps, classes: ['natural_disaster', 'currency_crisis'] });
  const nd = rows.find(r => r.class === 'natural_disaster' && r.target === 'real_price' && r.horizon === 1);
  assert.equal(nd.pooled, true);
  assert.equal(nd.n_episodes, 1, 'only the episode with data counts; NOPE is skipped');
  assert.ok(nd.effect < 0, 'pooled mean of all 4 episodes is negative');
  const cc = rows.find(r => r.class === 'currency_crisis' && r.target === 'real_price' && r.horizon === 1);
  assert.equal(cc.pooled, true);
  assert.equal(cc.n_episodes, 0);
  assert.match(cc.episodes, /pooled mean of 4 episodes/);
});

test('episodes for countries without records are skipped', () => {
  const rows = estimateEventLibrary({ records: records([]), episodes: [{ country: 'XXX', year: 2010, class: 'armed_conflict', label: 'x' }], classes: ['armed_conflict'] });
  assert.equal(rows.length, 0);
});

test('curated episodes reference known classes', () => {
  for (const e of EPISODES) {
    assert.ok(EVENT_CLASSES[e.class], `${e.country} ${e.year} has unknown class ${e.class}`);
    assert.match(e.country, /^[A-Z]{3}$/);
    assert.ok(e.year > 1996 && e.year <= 2026);
  }
});
