#!/usr/bin/env node
// Country notes: validates the curated, sourced notes in data/country-notes/<ISO3>.json, writes
// the combined file the site falls back to (data/derived/country-notes.json) and, with --write,
// loads them into the Turso table country_notes.
// Run: node sync/notes.js          (validate + combine)
//      node sync/notes.js --write  (also load into Turso)
import fs from 'node:fs';
import path from 'node:path';
import { connect, upsertRows } from '../lib/db.js';

export const TOPICS = ['mortgage_market', 'macroprudential', 'policy', 'supply', 'demand', 'rental', 'data'];
export const EFFECTS = ['supports_prices', 'restrains_prices', 'raises_rate_sensitivity', 'lowers_rate_sensitivity', 'supports_rents', 'restrains_rents', 'context'];
const DIR = new URL('../data/country-notes/', import.meta.url);

// Returns a list of problems with one country's notes file (empty when valid).
export function validateNotes(doc) {
  const errs = [];
  if (!/^[A-Z]{3}$/.test(doc?.iso3 ?? '')) errs.push('iso3 missing or malformed');
  if (!Array.isArray(doc?.notes) || !doc.notes.length) errs.push('no notes');
  for (const [i, n] of (doc?.notes ?? []).entries()) {
    if (!TOPICS.includes(n.topic)) errs.push(`note ${i}: unknown topic ${n.topic}`);
    if (!EFFECTS.includes(n.effect)) errs.push(`note ${i}: unknown effect ${n.effect}`);
    if (typeof n.text !== 'string' || n.text.length < 40) errs.push(`note ${i}: text too short`);
    if (/[–—]/.test(n.text ?? '')) errs.push(`note ${i}: contains a dash`);
    if (!Array.isArray(n.sources) || !n.sources.length || n.sources.some(s => !/^https?:\/\//.test(s.url ?? '') || !s.title)) errs.push(`note ${i}: needs at least one source with title and URL`);
  }
  return errs;
}

export function loadNotes(dir = DIR) {
  const out = {}, problems = {};
  for (const f of fs.readdirSync(dir).filter(f => /^[A-Z]{3}\.json$/.test(f)).sort()) {
    const doc = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    const errs = validateNotes(doc);
    if (errs.length) { problems[f] = errs; continue; }
    out[doc.iso3] = { asOf: doc.asOf, notes: doc.notes.map(n => ({ topic: n.topic, effect: n.effect, text: n.text.trim(), sources: n.sources })) };
  }
  return { notes: out, problems };
}

async function main() {
  const { notes, problems } = loadNotes();
  for (const [f, errs] of Object.entries(problems)) console.error(`  ${f}: ${errs.join('; ')}`);
  const target = path.resolve(new URL('../data/derived/country-notes.json', import.meta.url).pathname);
  fs.writeFileSync(target, JSON.stringify(notes) + '\n');
  console.log(`${Object.keys(notes).length} countries, ${Object.values(notes).reduce((s, c) => s + c.notes.length, 0)} notes -> ${path.relative(process.cwd(), target)}`);
  if (Object.keys(problems).length) process.exitCode = 1;
  if (!process.argv.includes('--write')) return;
  const db = connect();
  await db.execute('CREATE TABLE IF NOT EXISTS country_notes (country TEXT NOT NULL, idx INTEGER NOT NULL, topic TEXT NOT NULL, effect TEXT NOT NULL, text TEXT NOT NULL, sources TEXT NOT NULL, as_of TEXT, PRIMARY KEY (country, idx))');
  await db.execute('DELETE FROM country_notes');
  const rows = Object.entries(notes).flatMap(([country, c]) => c.notes.map((n, idx) => ({ country, idx, topic: n.topic, effect: n.effect, text: n.text, sources: JSON.stringify(n.sources), as_of: c.asOf })));
  await upsertRows(db, 'country_notes', ['country', 'idx', 'topic', 'effect', 'text', 'sources', 'as_of'], rows);
  console.log(`Loaded ${rows.length} notes into Turso`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.stack || error); process.exit(1); });
