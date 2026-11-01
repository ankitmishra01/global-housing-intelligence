// Latest daily central bank policy rates (BIS WS_CBPOL, daily) and national mortgage rates:
// Bank of Canada Valet (weekly), FRED MORTGAGE30US (weekly), ECB MIR (monthly, euro members)
// and the Bank of England quoted 2-year fixed rate (monthly).
import { fetchText, fetchJson, num } from '../sources/util.js';
import { parseBisCsv, expandEuroPolicy, addUsdPegProxies } from '../sources/bis.js';
import { parseFred } from '../sources/national/united-states.js';
import { parseEcbMir, parseBoe, ECB_SOURCE, BOE_SOURCE } from '../sources/mortgage.js';

// ECB MIR reporting countries (ISO2 → ISO3).
const ECB_AREAS = new Map(Object.entries({ AT: 'AUT', BE: 'BEL', BG: 'BGR', CY: 'CYP', DE: 'DEU', EE: 'EST', ES: 'ESP', FI: 'FIN', FR: 'FRA', GR: 'GRC', HR: 'HRV', IE: 'IRL', IT: 'ITA', LT: 'LTU', LU: 'LUX', LV: 'LVA', MT: 'MLT', NL: 'NLD', PT: 'PRT', SI: 'SVN', SK: 'SVK' }));

// Latest observation per country from daily BIS rows.
export function latestByCountry(points) {
  const out = {};
  for (const p of points) if (!out[p.iso3] || p.period > out[p.iso3].date) out[p.iso3] = { date: p.period, value: p.value };
  return out;
}

export async function fetchPolicyRates(iso2ToIso3, now = new Date()) {
  const start = new Date(now.getTime() - 45 * 864e5).toISOString().slice(0, 10);
  const csv = await fetchText(`https://stats.bis.org/api/v1/data/WS_CBPOL/D?format=csv&startPeriod=${start}`);
  return latestByCountry(addUsdPegProxies(expandEuroPolicy(parseBisCsv(csv, 'REF_AREA', iso2ToIso3))));
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
  const latest = rows => { const out_ = {}; for (const r of rows) if (!out_[r.country] || r.period > out_[r.country].period) out_[r.country] = r; return out_; };
  try {
    const start = new Date(now.getTime() - 200 * 864e5).toISOString().slice(0, 7);
    const ecb = parseEcbMir(await fetchText(`https://data-api.ecb.europa.eu/service/data/MIR/M..B.A2C.A.R.A.2250.EUR.N?format=csvdata&detail=dataonly&startPeriod=${start}`), ECB_AREAS);
    for (const [iso3, r] of Object.entries(latest(ecb))) out[iso3] = { date: r.period, value: r.value, source: ECB_SOURCE };
  } catch { /* optional */ }
  try {
    const from = new Date(now.getTime() - 200 * 864e5);
    const datefrom = `01/${from.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}/${from.getUTCFullYear()}`;
    const boe = parseBoe(await fetchText(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${datefrom}&Dateto=now&SeriesCodes=IUMBV34&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`));
    const r = latest(boe).GBR;
    if (r) out.GBR = { date: r.period, value: r.value, source: BOE_SOURCE };
  } catch { /* optional */ }
  return out;
}
