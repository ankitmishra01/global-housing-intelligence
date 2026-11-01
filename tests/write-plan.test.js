import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planObservationWrites } from '../lib/write-plan.js';

const row = (o) => ({ country: 'CAN', indicator: 'X', region: '', dwelling_type: '', frequency: 'A', status: 'actual', source: 'S', ...o });

test('only new or changed rows are written, and withdrawn points of refreshed series are deleted', () => {
  const existing = [row({ period: '2023', value: 1 }), row({ period: '2024', value: 2 }), row({ period: '2022', value: 9 }), row({ indicator: 'Y', period: '2024', value: 5 })];
  const incoming = [row({ period: '2023', value: 1 }), row({ period: '2024', value: 2.5 }), row({ period: '2025', value: 3 })];
  const plan = planObservationWrites(existing, incoming);
  assert.deepEqual(plan.upserts.map(r => r.period), ['2024', '2025']);
  assert.deepEqual(plan.deletes.map(r => r.period), ['2022']);
  assert.equal(plan.unchanged, 1);
});

test('a series the run did not return keeps its rows, and a source change counts as a change', () => {
  const existing = [row({ indicator: 'Y', period: '2024', value: 5 }), row({ period: '2024', value: 2 })];
  const plan = planObservationWrites(existing, [row({ period: '2024', value: 2, source: 'T' })]);
  assert.equal(plan.deletes.length, 0);
  assert.equal(plan.upserts.length, 1);
});
