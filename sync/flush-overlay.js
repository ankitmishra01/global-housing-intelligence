// Flush data/derived/overlay-observations.json into Turso observations: `node sync/flush-overlay.js` prints counts, `--write` upserts the rows then empties the file.
import fs from 'node:fs';
import { connect, upsertRows } from '../lib/db.js';

const PATH = new URL('../data/derived/overlay-observations.json', import.meta.url);
const COLUMNS = ['country', 'indicator', 'region', 'dwelling_type', 'period', 'frequency', 'value', 'status', 'source', 'vintage', 'fetched_at'];

const rows = fs.existsSync(PATH) ? JSON.parse(fs.readFileSync(PATH, 'utf8')) : [];
const counts = new Map();
for (const r of rows) {
  const k = `${r.country} ${r.indicator}`;
  counts.set(k, (counts.get(k) || 0) + 1);
}
console.log(`overlay: ${rows.length} rows`);
for (const [k, n] of [...counts].sort()) console.log(`  ${k}: ${n}`);

if (process.argv.includes('--write') && rows.length) {
  const now = new Date().toISOString();
  const obs = rows.map(r => ({ ...r, region: r.region || '', dwelling_type: r.dwelling_type || '', status: r.status || 'actual', vintage: now.slice(0, 10), fetched_at: now }));
  const db = connect();
  const written = await upsertRows(db, 'observations', COLUMNS, obs);
  fs.writeFileSync(PATH, '[]\n');
  console.log(`wrote ${written} rows to observations; overlay emptied`);
} else if (rows.length) {
  console.log('dry run: pass --write to upsert into Turso');
}

// The run snapshot (data/derived/run-snapshot.json): every run-scoped table of a training run made
// with `train.js --dry-run --snapshot-out` while writes were blocked. With --write it is inserted
// as a normal run (the site then reads it from Turso) and the file is reset to {}.
const SNAP = new URL('../data/derived/run-snapshot.json', import.meta.url);
const snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {};
if (snap.run) {
  console.log(`run snapshot ${snap.run.id}: ${Object.entries(snap.tables).map(([t, l]) => `${t} ${l.length}`).join(', ')}`);
  if (process.argv.includes('--write')) {
    const db = connect();
    await upsertRows(db, 'projection_runs', ['id', 'created_at', 'model_version', 'data_vintage', 'summary'], [snap.run]);
    for (const [table, list] of Object.entries(snap.tables)) if (list.length) await upsertRows(db, table, Object.keys(list[0]), list);
    fs.writeFileSync(SNAP, '{}\n');
    console.log(`wrote run ${snap.run.id}; snapshot reset (run node sync/live.js next so live adjustments key to it)`);
  }
}
// Country notes are loaded with `node sync/notes.js --write`.
