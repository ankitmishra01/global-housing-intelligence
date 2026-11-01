// Latest daily central bank policy rates (BIS WS_CBPOL, daily) and weekly national
// mortgage rates (Bank of Canada Valet, FRED MORTGAGE30US).
import { fetchText, fetchJson, num } from '../sources/util.js';
import { parseBisCsv, expandEuroPolicy } from '../sources/bis.js';
import { parseFred } from '../sources/national/united-states.js';

// Latest observation per country from daily BIS rows.
export function latestByCountry(points) {
  const out = {};
  for (const p of points) if (!out[p.iso3] || p.period > out[p.iso3].date) out[p.iso3] = { date: p.period, value: p.value };
  return out;
}

export async function fetchPolicyRates(iso2ToIso3, now = new Date()) {
  const start = new Date(now.getTime() - 45 * 864e5).toISOString().slice(0, 10);
  const csv = await fetchText(`https://stats.bis.org/api/v1/data/WS_CBPOL/D?format=csv&startPeriod=${start}`);
  return latestByCountry(expandEuroPolicy(parseBisCsv(csv, 'REF_AREA', iso2ToIso3)));
}

export function parseValetLatest(json, series = 'V80691335') {
  const obs = (json.observations || []).map(o => ({ date: o.d, value: num(o[series]?.v) })).filter(o => Number.isFinite(o.value));
  return obs.sort((a, b) => a.date.localeCompare(b.date)).at(-1) || null;
}

export async function fetchMortgageRates(now = new Date()) {
  const out = {};
  try {
    const start = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
    const latest = parseValetLatest(await fetchJson(`https://www.bankofcanada.ca/valet/observations/V80691335/json?start_date=${start}`));
    if (latest) out.CAN = { ...latest, source: 'Bank of Canada 5-year conventional mortgage (posted)' };
  } catch { /* national rate is optional */ }
  try {
    const { points } = parseFred(await fetchText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US'), 'MORTGAGE30US');
    const last = points.at(-1);
    if (last) out.USA = { date: last.period, value: last.value, source: 'Freddie Mac 30-year fixed' };
  } catch { /* optional */ }
  return out;
}
