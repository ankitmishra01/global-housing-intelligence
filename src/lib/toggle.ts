// Pure interest-rate toggle math shared by the country page and compare view.
// A rate move of `delta` percentage points shifts each cumulative log path by
// coef_h × delta and widens the band by the coefficient's bootstrap uncertainty.
export type Band = { horizon: number; year: number; p10: number; p25: number; median: number; p75: number; p90: number };
export type SensMap = Record<number, { coef: number; se: number; valid: boolean }>;

const Z80 = 1.2816, Z50 = 0.6745;
const toLog = (index: number) => 100 * Math.log(index / 100);
const toIndex = (log: number) => 100 * Math.exp(log / 100);

export function shiftBand(rows: Band[], sens: SensMap | undefined, delta: number): Band[] {
  if (!delta || !sens) return rows;
  return rows.map((r) => {
    const s = sens[r.horizon];
    if (!s || !s.valid) return r;
    const shift = s.coef * delta, extra = Math.abs(s.se * delta);
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

export function annuity(ratePct: number, years: number) {
  const r = ratePct / 1200, n = years * 12;
  return r === 0 ? 1 / n : r / (1 - (1 + r) ** -n);
}

export function monthlyPayment(price: number, downPct: number, ratePct: number, years: number) {
  return price * (1 - downPct / 100) * annuity(Math.max(0, ratePct), years);
}
