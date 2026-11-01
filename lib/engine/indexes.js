// Persona indexes: investors, buyers, renters, sellers. Each index is a weighted average
// of the percentile ranks of its components across Tier 1 economies, oriented so 100 is
// most favourable for that persona. Shared by the trainer (stored per run) and the
// browser (recomputed live under the interest-rate toggle).

export const PERSONAS = {
  investor: {
    label: 'Investor', question: 'Is this a good market to hold housing over 10 years?',
    components: [
      { key: 'proj10Price', weight: 0.35, direction: 1, label: '10-year projected real price growth' },
      { key: 'ptrGap', weight: 0.25, direction: -1, label: 'Price-to-rent vs long-run average (lower means better rental yield)' },
      { key: 'flagCount', weight: 0.15, direction: -1, label: 'Number of risk flags' },
      { key: 'hhCredit', weight: 0.1, direction: -1, label: 'Household debt, % of GDP' },
      { key: 'volatility', weight: 0.15, direction: -1, label: 'Real price volatility, last 15 years' },
    ],
  },
  buyer: {
    label: 'Buyer', question: 'Is now a good time to buy a home to live in?',
    components: [
      { key: 'ptiGap', weight: 0.3, direction: -1, label: 'Price-to-income vs long-run average' },
      { key: 'burden3y', weight: 0.25, direction: -1, label: 'Change in mortgage payment burden over 3 years' },
      { key: 'momentum', weight: 0.2, direction: -1, label: 'Last year real price growth (cooling is better)' },
      { key: 'proj3Price', weight: 0.25, direction: 1, label: '3-year projected real price growth after buying' },
    ],
  },
  renter: {
    label: 'Renter', question: 'How favourable is this market for tenants?',
    components: [
      { key: 'proj10Rent', weight: 0.4, direction: -1, label: '10-year projected real rent growth' },
      { key: 'rentVsIncome', weight: 0.3, direction: -1, label: 'Real rent growth minus real income growth, last 5 years' },
      { key: 'ptrGap', weight: 0.3, direction: 1, label: 'Price-to-rent vs long-run average (high means renting is relatively cheap)' },
    ],
  },
  seller: {
    label: 'Seller', question: 'Is now a good time to sell?',
    components: [
      { key: 'valuation', weight: 0.35, direction: 1, label: 'Valuation vs long-run average (price-to-income and price-to-rent)' },
      { key: 'momentum', weight: 0.2, direction: 1, label: 'Last year real price growth' },
      { key: 'proj3Price', weight: 0.3, direction: -1, label: '3-year projected real price growth (weak outlook favours selling now)' },
      { key: 'rateTrend', weight: 0.15, direction: 1, label: 'Policy rate change over 12 months (rising rates favour selling sooner)' },
    ],
  },
};

const finite = v => typeof v === 'number' && Number.isFinite(v);

export function percentileRank(values, v) {
  const a = values.filter(finite);
  if (!a.length || !finite(v)) return null;
  const below = a.filter(x => x < v).length, equal = a.filter(x => x === v).length;
  return (100 * (below + 0.5 * equal)) / a.length;
}

// Monthly payment per unit of loan for an annual rate (%) and term in years.
export function annuityFactor(ratePct, years = 25) {
  const r = ratePct / 1200, n = years * 12;
  return r === 0 ? 1 / n : r / (1 - (1 + r) ** -n);
}

// Live adjustment of components under a rate move of `deltaPp` percentage points.
// sens: { real_price: {3: coef, 10: coef}, real_rent: {10: coef} } in x100 log points per pp.
export function shiftComponents(base, deltaPp, sens, mortgageRate) {
  if (!deltaPp) return { ...base };
  const out = { ...base };
  if (finite(base.proj10Price) && finite(sens?.real_price?.[10])) out.proj10Price = base.proj10Price + sens.real_price[10] * deltaPp;
  if (finite(base.proj3Price) && finite(sens?.real_price?.[3])) out.proj3Price = base.proj3Price + sens.real_price[3] * deltaPp;
  if (finite(base.proj10Rent) && finite(sens?.real_rent?.[10])) out.proj10Rent = base.proj10Rent + sens.real_rent[10] * deltaPp;
  if (finite(base.burden3y) && finite(mortgageRate)) out.burden3y = base.burden3y + 100 * Math.log(annuityFactor(mortgageRate + deltaPp) / annuityFactor(mortgageRate));
  if (finite(base.rateTrend)) out.rateTrend = base.rateTrend + deltaPp;
  return out;
}

// Score one country's components against the distribution of every Tier 1 country.
export function scorePersona(persona, components, distributions) {
  const spec = PERSONAS[persona];
  let total = 0, weight = 0;
  const parts = spec.components.map(c => {
    const pct = percentileRank(distributions[c.key] || [], components[c.key]);
    const oriented = pct == null ? null : c.direction > 0 ? pct : 100 - pct;
    if (oriented != null) { total += oriented * c.weight; weight += c.weight; }
    return { key: c.key, value: finite(components[c.key]) ? +components[c.key].toFixed(2) : null, percentile: oriented == null ? null : +oriented.toFixed(1), weight: c.weight };
  });
  // Less than half the weight available means too little data for a fair score.
  return { score: weight >= 0.5 ? +(total / weight).toFixed(1) : null, components: parts };
}

export function scoreAll(componentsByCountry) {
  const keys = [...new Set(Object.values(PERSONAS).flatMap(p => p.components.map(c => c.key)))];
  const distributions = Object.fromEntries(keys.map(k => [k, Object.values(componentsByCountry).map(c => c[k]).filter(finite)]));
  const rows = [];
  for (const persona of Object.keys(PERSONAS)) {
    const scored = Object.entries(componentsByCountry).map(([country, comps]) => ({ country, persona, ...scorePersona(persona, comps, distributions) })).filter(r => r.score != null);
    scored.sort((a, b) => b.score - a.score).forEach((r, i) => rows.push({ ...r, rank: i + 1 }));
  }
  return { rows, distributions };
}
