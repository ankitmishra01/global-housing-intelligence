// OECD Analytical House Prices (SDMX, OECD.ECO.MPD DSD_AN_HOUSE_PRICES), annual.
import { csvObjects, fetchText, num } from './util.js';

const URL = 'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/.A.RPI+HPI_YDH_AVG+HPI_RPI_AVG+RHP+HPI.?startPeriod=1970&format=csv';
const SOURCE = 'OECD Analytical House Prices';

const MEASURES = {
  RPI: 'RENT',
  HPI_YDH_AVG: 'PTI_AVG',
  HPI_RPI_AVG: 'PTR_AVG',
  RHP: 'OECD_REAL_PRICE',
  HPI: 'OECD_NOMINAL_PRICE',
};

export const OECD_INDICATORS = [
  { key: 'RENT', label: 'Rent price index', unit: 'index, 2015 = 100', source: SOURCE, frequency: 'A' },
  { key: 'PTI_AVG', label: 'Price-to-income ratio vs long-run average', unit: '% of long-run average', source: SOURCE, frequency: 'A' },
  { key: 'PTR_AVG', label: 'Price-to-rent ratio vs long-run average', unit: '% of long-run average', source: SOURCE, frequency: 'A' },
  { key: 'OECD_REAL_PRICE', label: 'Real house price index (OECD)', unit: 'index, 2015 = 100', source: SOURCE, frequency: 'A' },
  { key: 'OECD_NOMINAL_PRICE', label: 'Nominal house price index (OECD)', unit: 'index, 2015 = 100', source: SOURCE, frequency: 'A' },
];

export function parseOecdCsv(text, validIso3) {
  const rows = [];
  for (const r of csvObjects(text)) {
    const indicator = MEASURES[r.MEASURE];
    const value = num(r.OBS_VALUE);
    if (!indicator || !Number.isFinite(value) || !validIso3.has(r.REF_AREA)) continue;
    rows.push({ country: r.REF_AREA, indicator, period: String(r.TIME_PERIOD), frequency: 'A', value, source: SOURCE });
  }
  return rows;
}

export async function fetchOecd(validIso3) {
  return parseOecdCsv(await fetchText(URL, { timeoutMs: 180_000, retries: 5, backoffMs: 15_000 }), validIso3);
}
