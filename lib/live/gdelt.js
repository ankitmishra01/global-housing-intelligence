// GDELT 1.0 daily event files: per-country conflict intensity.
// Column layout verified against a real file (58 tab-separated columns):
//   28 EventRootCode · 31 NumMentions · 51 ActionGeo_CountryCode (FIPS 10-4)
import { unzipEntry } from '../sources/national/canada.js';
import { fipsToIso3 } from './fips.js';

export const COL = { root: 28, mentions: 31, geo: 51 };
// CAMEO root codes: 18 assault, 19 fight, 20 unconventional mass violence.
export const CONFLICT_ROOTS = new Set(['18', '19', '20']);

export const gdeltUrl = date => `http://data.gdeltproject.org/events/${date.replaceAll('-', '')}.export.CSV.zip`;

// Returns { [iso3]: { conflict, all } } summed NumMentions for one day's file.
export function parseGdeltDay(tsv) {
  const out = {};
  let start = 0;
  while (start < tsv.length) {
    let end = tsv.indexOf('\n', start);
    if (end === -1) end = tsv.length;
    const line = tsv.slice(start, end);
    start = end + 1;
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 52) continue;
    const iso3 = fipsToIso3(f[COL.geo]);
    if (!iso3) continue;
    const mentions = Number(f[COL.mentions]) || 0;
    const c = (out[iso3] ||= { conflict: 0, all: 0 });
    c.all += mentions;
    if (CONFLICT_ROOTS.has(f[COL.root])) c.conflict += mentions;
  }
  return out;
}

export async function fetchGdeltDay(date) {
  const response = await fetch(gdeltUrl(date), { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GDELT ${date}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return parseGdeltDay(unzipEntry(buffer, '.CSV'));
}
