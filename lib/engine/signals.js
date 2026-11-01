// Market-level signals per persona, built from the persona index scores, the mortgage
// stress index and the risk flags. These describe the market, not anyone's personal
// situation, and every page that shows them says so.

export const SIGNAL_DISCLAIMER = 'Market-level signal from public data and statistical projections. Not personal financial advice.';

export const SIGNAL_LABELS = {
  buyer: { 1: 'Favourable', 0: 'Neutral', '-1': 'Wait' },
  seller: { 1: 'Good time to sell', 0: 'Neutral', '-1': 'Hold' },
  investor: { 1: 'Attractive', 0: 'Neutral', '-1': 'Caution' },
  renter: { 1: 'Tenant-friendly', 0: 'Neutral', '-1': 'Landlord market' },
};

const finite = v => typeof v === 'number' && Number.isFinite(v);
const p0 = v => Math.abs(v).toFixed(0);
const p1 = v => Math.abs(v).toFixed(1);

// Components stored as log points (100 × log change); the prose quotes percentage changes.
const LOG_KEYS = new Set(['proj10Price', 'proj3Price', 'proj10Rent', 'momentum', 'burden3y']);
const toPct = v => 100 * (Math.exp(v / 100) - 1);

// Plain-English sentence for one component value. `favourable` (percentile >= 50, already
// oriented for the persona) adds a comparison when the raw reading alone would mislead, e.g.
// a 21% rise in mortgage payments that is still smaller than in most markets.
export function describe(key, raw, favourable = null) {
  if (!finite(raw)) return null;
  const v = LOG_KEYS.has(key) ? toPct(raw) : raw;
  const base = describeValue(key, v);
  if (base == null || favourable == null) return base;
  if (key === 'burden3y' && v > 0 && favourable) return `${base}, a smaller rise than in most markets`;
  if (key === 'burden3y' && v < 0 && !favourable) return `${base}, less relief than in most markets`;
  if ((key === 'proj10Price' || key === 'proj3Price') && v > 0 && favourable === false) return `${base}, less than in most markets`;
  return base;
}

function describeValue(key, v) {
  switch (key) {
    case 'ptiGap': return v >= 0 ? `Prices are ${p0(v)}% above their long-run income ratio` : `Prices are ${p0(v)}% below their long-run income ratio`;
    case 'ptrGap': return v >= 0 ? `Prices are ${p0(v)}% above their long-run rent ratio` : `Prices are ${p0(v)}% below their long-run rent ratio`;
    case 'valuation': return v >= 0 ? `Valuations are ${p0(v)}% above their long-run average` : `Valuations are ${p0(v)}% below their long-run average`;
    case 'proj10Price': return `Real prices projected ${v >= 0 ? 'up' : 'down'} ${p0(v)}% over 10 years`;
    case 'proj3Price': return `Real prices projected ${v >= 0 ? 'up' : 'down'} ${p1(v)}% over 3 years`;
    case 'proj10Rent': return `Real rents projected ${v >= 0 ? 'up' : 'down'} ${p1(v)}% over 10 years`;
    case 'momentum': return `Real prices ${v >= 0 ? 'rose' : 'fell'} ${p1(v)}% in the latest year`;
    case 'burden3y': return `Mortgage payments on a typical home are ${v >= 0 ? 'up' : 'down'} ${p0(v)}% over 3 years`;
    case 'rentVsIncome': return v >= 0 ? `Rents have outgrown incomes by ${p1(v)}pp a year` : `Incomes have outgrown rents by ${p1(v)}pp a year`;
    case 'rateTrend': return v === 0 ? 'Policy rate unchanged over 12 months' : `Policy rate ${v > 0 ? 'up' : 'down'} ${p1(v)}pp over 12 months`;
    case 'flagCount': return v === 0 ? 'No risk flags' : `${v} risk flag${v > 1 ? 's' : ''}`;
    case 'hhDebt': return `Household debt is ${p0(v)}% of GDP`;
    case 'volatility': return `Real prices swing about ${p1(v)}% a year`;
    default: return null;
  }
}

const levelOf = score => (!finite(score) ? 0 : score >= 65 ? 1 : score <= 40 ? -1 : 0);
const clamp = l => Math.max(-1, Math.min(1, l));

// scores: { investor, buyer, renter, seller } (0-100)
// components: { persona: [{ key, value, percentile }] } (percentile already oriented: high = favourable)
// flags: array of flag ids; stress: { score } optional
export function computeSignals({ scores = {}, components = {}, flags = [], stress = null }) {
  const stressed = flags.includes('MORTGAGE_STRESS') || flags.includes('UNEMPLOYMENT_RISING');
  const out = {};
  for (const persona of Object.keys(SIGNAL_LABELS)) {
    const base = levelOf(scores[persona]);
    let level = base;
    const extra = [];
    if (stressed && (persona === 'buyer' || persona === 'investor')) { level = clamp(level - 1); extra.push(stressReason(flags, stress)); }
    if (stressed && persona === 'seller') { level = clamp(level + 1); extra.push(stressReason(flags, stress)); }

    const parts = (components[persona] || []).filter(c => finite(c.percentile) && describe(c.key, c.value));
    const byFavour = [...parts].sort((a, b) => b.percentile - a.percentile);
    const say = c => describe(c.key, c.value, c.percentile >= 50);
    const favourable = byFavour.map(say);
    const unfavourable = [...byFavour].reverse().map(say);
    // Reasons that back the verdict come first; the strongest counterpoint is listed against it.
    let support = level >= 0 ? favourable.slice(0, 2) : unfavourable.slice(0, 2);
    let oppose = level >= 0 ? unfavourable.slice(0, 1) : favourable.slice(0, 1);
    if (extra.length) {
      if ((persona === 'seller' && level >= 0) || (persona !== 'seller' && level < 0)) support = [extra[0], ...support].slice(0, 2);
      else oppose = [extra[0]];
    }
    out[persona] = { persona, level, label: SIGNAL_LABELS[persona][level], score: finite(scores[persona]) ? scores[persona] : null, adjusted: level !== base, support, oppose };
  }
  return out;
}

function stressReason(flags, stress) {
  const bits = [];
  if (flags.includes('UNEMPLOYMENT_RISING')) bits.push('unemployment is rising fast');
  if (flags.includes('MORTGAGE_STRESS')) bits.push(`mortgage stress is high${stress && finite(stress.score) ? ` (${stress.score.toFixed(0)}/100)` : ''}`);
  const s = bits.join(' and ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
