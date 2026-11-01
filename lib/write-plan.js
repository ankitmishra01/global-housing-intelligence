// Write planning for the observations table: only rows that are new or changed are written,
// and only rows withdrawn from a refreshed series are deleted. A full rewrite of ~475,000 rows
// each refresh costs close to a million row writes against the database plan's monthly quota.
const KEY_COLS = ['country', 'indicator', 'region', 'dwelling_type', 'period', 'frequency'];
export const obsKey = r => KEY_COLS.map(c => r[c] ?? '').join('|');
const seriesKey = r => `${r.country}|${r.indicator}|${r.frequency}`;
const same = (a, b) => a === b || (Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

// existing: rows already stored (key columns + value, status, source).
// incoming: this run's rows. Series (country × indicator × frequency) present in incoming are
// treated as refreshed; series a failed source did not return are left untouched.
export function planObservationWrites(existing, incoming) {
  const stored = new Map(existing.map(r => [obsKey(r), r]));
  const refreshed = new Set(incoming.map(seriesKey));
  const incomingKeys = new Set();
  const upserts = [];
  for (const r of incoming) {
    const k = obsKey(r);
    incomingKeys.add(k);
    const old = stored.get(k);
    if (!old || !same(Number(old.value), Number(r.value)) || old.status !== r.status || old.source !== r.source) upserts.push(r);
  }
  const deletes = existing.filter(r => refreshed.has(seriesKey(r)) && !incomingKeys.has(obsKey(r)));
  return { upserts, deletes, unchanged: incoming.length - upserts.length };
}
