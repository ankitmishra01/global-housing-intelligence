// World Bank WDI: housing drivers for every economy (the Tier 2 baseline).
import { fetchJson } from './util.js';

const SOURCE = 'World Bank WDI';

export const WB_SERIES = {
  POP_GROWTH: { code: 'SP.POP.GROW', label: 'Population growth', unit: '% per year' },
  URBAN_GROWTH: { code: 'SP.URB.GROW', label: 'Urban population growth', unit: '% per year' },
  URBAN_SHARE: { code: 'SP.URB.TOTL.IN.ZS', label: 'Urban population share', unit: '% of population' },
  GDP_PC_GROWTH: { code: 'NY.GDP.PCAP.KD.ZG', label: 'Real GDP per capita growth', unit: '% per year' },
  GDP_PC_USD: { code: 'NY.GDP.PCAP.CD', label: 'GDP per capita', unit: 'current USD' },
  LENDING_RATE: { code: 'FR.INR.LEND', label: 'Bank lending rate', unit: '%' },
  REAL_RATE: { code: 'FR.INR.RINR', label: 'Real interest rate', unit: '%' },
  PRIVATE_CREDIT: { code: 'FS.AST.PRVT.GD.ZS', label: 'Domestic credit to private sector', unit: '% of GDP' },
  CPI_INFLATION_WB: { code: 'FP.CPI.TOTL.ZG', label: 'Consumer price inflation (World Bank)', unit: '% per year' },
};

export const WB_INDICATORS = Object.entries(WB_SERIES).map(([key, s]) => ({ key, label: s.label, unit: s.unit, source: SOURCE, frequency: 'A' }));

export function parseWorldBank(payload, indicator, validIso3) {
  const rows = [];
  for (const r of payload?.[1] || []) {
    if (r.value == null || !validIso3.has(r.countryiso3code)) continue;
    rows.push({ country: r.countryiso3code, indicator, period: String(r.date), frequency: 'A', value: Number(r.value), source: SOURCE });
  }
  return rows;
}

export async function fetchWorldBank(validIso3) {
  const out = [];
  for (const [key, s] of Object.entries(WB_SERIES)) {
    const payload = await fetchJson(`https://api.worldbank.org/v2/country/all/indicator/${s.code}?format=json&per_page=20000&date=1970:2030`);
    out.push(...parseWorldBank(payload, key, validIso3));
  }
  return out;
}
