// Pure scenario math for the scenario builder. A scenario is a set of sustained moves:
// the policy rate (pp), unemployment (pp change), real wage growth (pp per year vs baseline)
// and real GDP growth (pp per year vs baseline). Each shifts the cumulative real log path
// (x100) at horizon h by coef_h × delta, using only statistically clear (valid) coefficients
// from the backtested model. These are model-implied associations, not causal forecasts.
// No path aliases here so node:test can import this file directly.

export type Band = { horizon: number; year: number; p10: number; p25: number; median: number; p75: number; p90: number };
export type Coef = { coef: number; se: number; valid: boolean };
export type CoefMap = Record<number, Coef>;
export type Scenario = { rate: number; unemployment: number; wages: number; gdp: number };
export type DriverKey = keyof Scenario;
// Per driver, per horizon coefficients for one target (real_price or real_rent).
export type TargetSens = Partial<Record<DriverKey, CoefMap>>;

export const ZERO: Scenario = { rate: 0, unemployment: 0, wages: 0, gdp: 0 };

export const PRESETS: { label: string; scenario: Scenario }[] = [
  { label: "Soft landing", scenario: { rate: -1, unemployment: 0.5, wages: 0, gdp: -0.5 } },
  { label: "Recession", scenario: { rate: -2, unemployment: 3, wages: -1, gdp: -2.5 } },
  { label: "Higher for longer", scenario: { rate: 1.5, unemployment: 1, wages: -0.5, gdp: -0.5 } },
  { label: "Boom", scenario: { rate: 1, unemployment: -0.5, wages: 1, gdp: 1.5 } },
  { label: "Reset", scenario: ZERO },
];

export const DRIVER_LABELS: Record<DriverKey, string> = {
  rate: "Policy rate",
  unemployment: "Unemployment",
  wages: "Real wage growth",
  gdp: "Real GDP growth",
};

const Z80 = 1.2816, Z50 = 0.6745;
const toLog = (index: number) => 100 * Math.log(index / 100);
const toIndex = (log: number) => 100 * Math.exp(log / 100);

// Combined shift and extra standard error at one horizon (errors added in quadrature).
export function combinedShift(sens: TargetSens, s: Scenario, h: number): { shift: number; extra: number } {
  let shift = 0, variance = 0;
  for (const key of Object.keys(s) as DriverKey[]) {
    const d = s[key];
    const c = sens[key]?.[h];
    if (!d || !c || !c.valid || !Number.isFinite(c.coef)) continue;
    shift += c.coef * d;
    variance += (c.se * d) ** 2;
  }
  return { shift, extra: Math.sqrt(variance) };
}

export function applyScenario(rows: Band[], sens: TargetSens, s: Scenario): Band[] {
  return rows.map((r) => {
    const { shift, extra } = combinedShift(sens, s, r.horizon);
    if (!shift && !extra) return r;
    return {
      ...r,
      p10: toIndex(toLog(r.p10) + shift - Z80 * extra),
      p25: toIndex(toLog(r.p25) + shift - Z50 * extra),
      median: toIndex(toLog(r.median) + shift),
      p75: toIndex(toLog(r.p75) + shift + Z50 * extra),
      p90: toIndex(toLog(r.p90) + shift + Z80 * extra),
    };
  });
}

// Shift excluding the rate driver (the rate part of the index components is handled by
// shiftComponents in lib/engine/indexes.js, which also moves the mortgage burden).
export function nonRateShift(sens: TargetSens, s: Scenario, h: number) {
  return combinedShift(sens, { ...s, rate: 0 }, h).shift;
}

export function annuity(ratePct: number, years = 25) {
  const r = Math.max(0, ratePct) / 1200, n = years * 12;
  return r === 0 ? 1 / n : r / (1 - (1 + r) ** -n);
}

export type StressMetrics = {
  mortgageToIncome?: number | null; ptiVsHistory?: number | null; debtService?: number | null; debtServiceGap?: number | null;
  unemploymentChange12m?: number | null; realWageGrowth3y?: number | null; hhDebt?: number | null; mortgageRate?: number | null;
};

// Stress inputs one year into the scenario. Documented assumptions:
//  - a new mortgage's payment scales with the price path at 1 year and the annuity at the new rate;
//  - income grows by the extra real wage growth for one year;
//  - half of household debt reprices within a year, so debt service moves by half the payment ratio;
//  - unemployment change and 3-year wage growth move one-for-one with the sliders;
//  - household debt is unchanged.
export function adjustStress(m: StressMetrics, s: Scenario, priceShift1: number): StressMetrics {
  const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  const rate = fin(m.mortgageRate) ? m.mortgageRate : null;
  const payRatio = rate != null ? annuity(rate + s.rate) / annuity(rate) : 1;
  const income = 1 + s.wages / 100;
  const price = Math.exp(priceShift1 / 100);
  const out: StressMetrics = { ...m };
  if (fin(m.mortgageToIncome)) out.mortgageToIncome = (m.mortgageToIncome * payRatio * price) / income;
  if (fin(m.ptiVsHistory)) out.ptiVsHistory = ((100 + m.ptiVsHistory) * price) / income - 100;
  if (fin(m.debtServiceGap) && fin(m.debtService)) out.debtServiceGap = m.debtServiceGap + m.debtService * (payRatio - 1) * 0.5;
  if (fin(m.unemploymentChange12m)) out.unemploymentChange12m = m.unemploymentChange12m + s.unemployment;
  if (fin(m.realWageGrowth3y)) out.realWageGrowth3y = m.realWageGrowth3y + s.wages;
  if (fin(m.mortgageRate)) out.mortgageRate = m.mortgageRate + s.rate;
  return out;
}

export function isZero(s: Scenario) {
  return !s.rate && !s.unemployment && !s.wages && !s.gdp;
}
