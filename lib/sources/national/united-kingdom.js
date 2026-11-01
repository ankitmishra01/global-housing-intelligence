// United Kingdom: HM Land Registry UK House Price Index, average price (GBP) for the UK
// and the four nations.
import { annualAverage, fetchText, num, parseCsv } from '../util.js';

const REGIONS = { 'united-kingdom': '', england: 'England', scotland: 'Scotland', wales: 'Wales', 'northern-ireland': 'Northern Ireland' };
// Cities and local authorities (Land Registry location slugs, each verified to resolve).
// City rows keep monthly data from CITY_MONTHLY_FROM; annual averages keep the full history.
export const UK_CITIES = {
  london: 'London', 'inner-london': 'Inner London', 'outer-london': 'Outer London', camden: 'Camden', 'kensington-and-chelsea': 'Kensington and Chelsea',
  manchester: 'Manchester', birmingham: 'Birmingham', leeds: 'Leeds', liverpool: 'Liverpool', 'city-of-bristol': 'Bristol', sheffield: 'Sheffield',
  'newcastle-upon-tyne': 'Newcastle upon Tyne', 'city-of-nottingham': 'Nottingham', leicester: 'Leicester', bradford: 'Bradford', coventry: 'Coventry',
  southampton: 'Southampton', portsmouth: 'Portsmouth', 'brighton-and-hove': 'Brighton and Hove', oxford: 'Oxford', cambridge: 'Cambridge', york: 'York',
  'milton-keynes': 'Milton Keynes', reading: 'Reading', 'city-of-plymouth': 'Plymouth', 'city-of-derby': 'Derby', wolverhampton: 'Wolverhampton',
  salford: 'Salford', 'stoke-on-trent': 'Stoke-on-Trent', sunderland: 'Sunderland',
  'city-of-edinburgh': 'Edinburgh', 'city-of-glasgow': 'Glasgow', 'city-of-aberdeen': 'Aberdeen', 'city-of-dundee': 'Dundee',
  cardiff: 'Cardiff', swansea: 'Swansea', newport: 'Newport', belfast: 'Belfast',
};
export const CITY_MONTHLY_FROM = '2016-01';
const SOURCE = 'HM Land Registry UK House Price Index';

export const UK_INDICATORS = [
  { key: 'TYPE_PRICE_LEVEL', label: 'Average price by dwelling type', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
  { key: 'AVG_PRICE', label: 'Average house price', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
];


// Land Registry sales volumes for the latest months are incomplete (registration lag), so the
// newest SALES_LAG_MONTHS are dropped rather than read as a slump.
export const SALES_LAG_MONTHS = 3;

// The service sometimes answers with Welsh column names ("Pris cyfartalog ..."), so the five
// price columns are read by position: all types, detached, semi-detached, terraced, flats.
const TYPE_ORDER = ['', 'detached', 'semi_detached', 'townhouse', 'condo'];
export function parseUkHpi(csv, region) {
  const [header, ...rows] = parseCsv(csv);
  const at = name => header.indexOf(name);
  const period = at('Period'), volume = at('Sales volume');
  const priced = header.findIndex(h => /^(Average price|Pris cyfartalog)/.test(h));
  const first = priced > -1 ? priced : at('Reporting period') + 1;
  if (period < 0 || first < 1) return [];
  const out = [];
  for (const r of rows) {
    if (!/^\d{4}-\d{2}$/.test(r[period])) continue;
    const v = num(r[volume]);
    if (Number.isFinite(v)) out.push({ country: 'GBR', indicator: 'SALES_COUNT', region, dwelling_type: '', period: r[period], frequency: 'M', value: v, source: `${SOURCE}, sales volume` });
    TYPE_ORDER.forEach((type, i) => {
      const value = num(r[first + i]);
      if (Number.isFinite(value)) out.push({ country: 'GBR', indicator: type ? 'TYPE_PRICE_LEVEL' : 'AVG_PRICE', region, dwelling_type: type, period: r[period], frequency: 'M', value, source: SOURCE });
    });
  }
  return out;
}

export async function fetchUnitedKingdom({ log = () => {} } = {}) {
  const rows = [];
  const places = [...Object.entries(REGIONS).map(([slug, region]) => [slug, region, false]), ...Object.entries(UK_CITIES).map(([slug, region]) => [slug, region, true])];
  for (const [slug, region, isCity] of places) {
    try {
    const location = encodeURIComponent(`http://landregistry.data.gov.uk/id/region/${slug}`);
    const csv = await fetchText(`https://landregistry.data.gov.uk/app/ukhpi/download/new.csv?from=1995-01-01&location=${location}&thm%5B%5D=property_type&in%5B%5D=avg`, { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } });
    const parsed = parseUkHpi(csv, region).map(r => ({ ...r, source: `${r.source} (Open Government Licence; contains HM Land Registry data © Crown copyright)` }));
    const salesMonths = [...new Set(parsed.filter(r => r.indicator === 'SALES_COUNT').map(r => r.period))].sort();
    const settled = new Set(salesMonths.slice(0, -SALES_LAG_MONTHS));
    const sales = parsed.filter(r => r.indicator === 'SALES_COUNT' && settled.has(r.period));
    const monthly = parsed.filter(r => r.indicator !== 'SALES_COUNT');
    const keep = r => !isCity || r.period >= CITY_MONTHLY_FROM;
    rows.push(...monthly.filter(keep), ...sales.filter(keep));
    if (sales.length) rows.push(...annualAverage(sales).map(a => ({ ...sales[0], period: a.period, frequency: 'A', value: a.value * 12 })));
    for (const type of TYPE_ORDER) {
      const series = monthly.filter(r => r.dwelling_type === type);
      if (series.length) rows.push(...annualAverage(series).map(a => ({ ...series[0], period: a.period, frequency: 'A', value: a.value })));
    }
    } catch (error) { log(`  GBR ${region || 'national'} failed: ${error.message}`); }
  }
  return rows;
}
