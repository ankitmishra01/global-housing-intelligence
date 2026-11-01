// GDACS disaster alerts. Only sudden-onset, market-moving hazards count: Red alerts of
// any sudden type, and Orange earthquakes, tropical cyclones and floods. Droughts are
// excluded (slow-moving). The alert is attributed to its primary country only, so one
// typhoon track does not flag every country it brushes.
const SUDDEN = new Set(['EQ', 'TC', 'FL', 'VO', 'TS']);
const ORANGE_OK = new Set(['EQ', 'TC', 'FL']);

export function parseGdacs(json) {
  const out = [];
  for (const f of json?.features || []) {
    const p = f.properties || {};
    const type = p.eventtype, level = p.alertlevel;
    if (!SUDDEN.has(type)) continue;
    if (!(level === 'Red' || (level === 'Orange' && ORANGE_OK.has(type)))) continue;
    const iso3 = p.iso3 || p.affectedcountries?.[0]?.iso3;
    if (!iso3 || !/^[A-Z]{3}$/.test(iso3)) continue;
    out.push({ iso3, type, level, name: p.name, date: String(p.fromdate || '').slice(0, 10), id: `${type}${p.eventid}` });
  }
  return out;
}

export async function fetchGdacs(now = new Date()) {
  const from = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const response = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&fromdate=${from}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`GDACS ${response.status}`);
  return parseGdacs(await response.json());
}
