// Row validation and coverage gates for the seed pipeline. Pure, tested on fixtures.

// Plausible ranges. A value outside its range is a unit or source error and is dropped.
export const RANGES = {
  REAL_PRICE: [1, 2000], NOMINAL_PRICE: [0.01, 1e7], OECD_REAL_PRICE: [1, 2000], OECD_NOMINAL_PRICE: [0.01, 1e7],
  RENT: [0.01, 1e5], PTI_AVG: [10, 400], PTR_AVG: [10, 400],
  HH_CREDIT: [0, 200], CREDIT_GAP: [-150, 150], POLICY_RATE: [-2, 1000],
  INFLATION: [-30, 1e6], GDP_GROWTH: [-70, 150],
  POP_GROWTH: [-20, 20], URBAN_GROWTH: [-30, 30], URBAN_SHARE: [0, 100], GDP_PC_GROWTH: [-70, 150], GDP_PC_USD: [50, 300000],
  LENDING_RATE: [-5, 1000], REAL_RATE: [-100, 100], PRIVATE_CREDIT: [0, 400], CPI_INFLATION_WB: [-30, 1e6],
  AVG_RENT_2BR: [50, 20000], AVG_RENT_1BR: [50, 20000], CASE_SHILLER_INDEX: [1, 10000], VACANCY_RATE: [0, 40], HOUSING_STARTS: [0, 5e6], NEW_HOUSING_PRICE: [1, 1000],
  MORTGAGE_RATE: [0, 30], TYPE_PRICE_INDEX: [0.01, 1e6], CITY_PRICE: [0.01, 1e8], SALES_COUNT: [0, 5e6], REGION_PRICE_INDEX: [0.5, 100000], NATIONAL_PRICE_INDEX: [0.5, 100000], HH_INCOME_OECD: [100, 1e10], MEDIAN_PSF: [10, 100000], DLD_PRICE_INDEX: [1, 10000], GROSS_YIELD: [0.5, 30], TYPE_PRICE_LEVEL: [1000, 1e8], AVG_RENT: [50, 50000],
  UNEMPLOYMENT: [0, 60], UNEMPLOYMENT_M: [0, 60], REAL_WAGE: [100, 1e9], DSR_HH: [0, 60], GDP_PC_LCU: [1e-6, 1e12], MEDIAN_HH_INCOME: [1000, 1e9], MEDIAN_PRICE: [1000, 1e8], RENT_CPI: [1, 10000], AVG_PRICE: [1000, 1e8],
};

// Minimum country coverage for a refresh to count as healthy.
export const COVERAGE_GATES = { REAL_PRICE: 40, RENT: 30, PTI_AVG: 20, POLICY_RATE: 30, INFLATION: 150, POP_GROWTH: 150, UNEMPLOYMENT: 100, UNEMPLOYMENT_M: 25, REAL_WAGE: 25, DSR_HH: 10 };

export function validateRows(rows) {
  const valid = [], rejected = [], seen = new Set();
  for (const r of rows) {
    const range = RANGES[r.indicator];
    const reason = !range ? 'unknown indicator'
      : !Number.isFinite(r.value) ? 'non-finite value'
      : r.value < range[0] || r.value > range[1] ? `outside [${range[0]}, ${range[1]}]`
      : !/^\d{4}(-Q[1-4]|-\d{2})?$/.test(r.period) ? 'bad period'
      : !['A', 'Q', 'M'].includes(r.frequency) ? 'bad frequency'
      : null;
    if (reason) { rejected.push({ ...r, reason }); continue; }
    const key = `${r.country}|${r.indicator}|${r.region || ''}|${r.dwelling_type || ''}|${r.period}|${r.frequency}`;
    if (seen.has(key)) continue; // first source wins
    seen.add(key);
    valid.push(r);
  }
  return { rows: valid, rejected };
}

export function typeCoverage(rows) {
  const out = {};
  for (const r of rows) if (r.dwelling_type && !r.region && r.frequency === 'A') (out[r.dwelling_type] ||= new Set()).add(r.country);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

export function coverageReport(rows) {
  const out = {};
  for (const r of rows) {
    if (r.region || r.dwelling_type) continue;
    const c = (out[r.indicator] ||= { set: new Set(), rows: 0, latest: '' });
    c.set.add(r.country); c.rows++;
    if ((r.status || 'actual') === 'actual' && r.period > c.latest) c.latest = r.period;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { countries: v.set.size, list: [...v.set], rows: v.rows, latest: v.latest }]));
}
