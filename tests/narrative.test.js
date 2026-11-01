import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountryNarrative, rewriteRateSection, plain } from '../lib/engine/narrative.js';

// ── Fixtures shaped like src/lib/narrative-input.ts output ──────────────────────
const band = (m, lo, hi) => ({ median: m, p10: lo, p90: hi });
const base = over => ({
  name: 'Canada', iso3: 'CAN', tier: 1, region: 'North America',
  bandLevel: 80, loanToValue: 80, rentBurden: 30, debtServiceWindow: 15,
  originYear: 2025, rentOriginYear: 2025, latestYear: 2025, stale: false, stale_rent: false,
  price: { h1: band(0.4, -6, 6.7), h3: band(7.4, -9, 26), h5: band(15.1, -12, 48), h10: band(42.3, 2.0, 138.2) },
  rent: { h1: band(0.2, -2, 2), h3: band(0.9, -5, 7), h5: band(1.2, -7, 12), h10: band(1.7, -11, 28.5) },
  history: { price: { change10: 24.4, change5: -8.7, peakYear: 2022, belowPeak: 18.0, atPeak: false }, rent: { change10: 5.7, change5: 2.1, peakYear: 2025, belowPeak: 0, atPeak: true } },
  tier1: { count: 59, medianPrice10: 36.3, priceRank: 16, priceRankLow: 44, rentCount: 42, medianRent10: 1.0, rentRank: 12 },
  peers: { region: 'North America', count: 1, medianPrice10: 38.7 },
  affordability: { ptiVsHistory: 50.1, priceToIncome: null, mortgageToIncome: null, rentToIncome: 25.5, incomeBasis: 'median household income, national statistics office (2024)', debtService: 14, debtServiceGap: 0.74, unemployment: 6.5, unemploymentAsOf: '2026-09', unemploymentChange12m: -0.6, unemploymentRising: false, realWageGrowth3y: 0.28, wageStagnation: true, hhDebt: 99.98 },
  ptiYear: 2025, ptrVsHistory: 71.3,
  stress: { score: 75.9, rank: 3, count: 32, rankLow: 30, max: 100 },
  rates: { policy: 2.25, policyAsOf: '2026-09', mortgage: 6.19, mortgageSource: 'Bank of Canada 5-year conventional mortgage', mortgageIsProxy: false, spread: 2, delta: -0.4, originYear: 2025, liveShift10: 0.5, sens3: -1.83, sens10: -1.27, rentSens10: -0.4, sensValid: true },
  skill: { price10: 8.6, price10Method: 'model' },
  signals: { buyer: { label: 'Wait', support: ['Mortgage stress is high (76/100)'], oppose: ['Real prices fell 6.7% in the latest year'] }, seller: { label: 'Good time to sell', support: [], oppose: [] }, investor: { label: 'Caution', support: [], oppose: [] }, renter: { label: 'Neutral', support: [], oppose: [] } },
  flags: ['Mortgage stress index 75 or higher', 'Price-to-rent more than 20% above its long-run average'], flagIds: ['MORTGAGE_STRESS', 'PTR_HIGH'],
  live: { events: [] },
  nowcast: { quarter: '2026-Q2', changePct: -5.23 },
  types: [{ type: 'house', label: 'Houses (single-family)', h10: 7.0, last5: -2.4 }, { type: 'townhouse', label: 'Townhouse / terraced / row', h10: 6.9, last5: -0.2 }],
  cities: { count: 9, rent: { min: 1276, minCity: 'Québec', max: 2364, maxCity: 'Vancouver', year: '2025' }, vacancy: { value: 3.3, period: '2025' } },
  ...over,
});

const hot = base();
const cheap = base({
  name: 'Germany', iso3: 'DEU', region: 'Europe & Central Asia',
  price: { h1: band(1.2, -4, 6), h3: band(10.3, -6, 28), h5: band(18.0, -9, 50), h10: band(42.7, 2.4, 138.7) },
  rent: { h1: band(0.1, -2, 2), h3: band(0.3, -5, 6), h5: band(0.4, -7, 11), h10: band(0.6, -11, 27) },
  affordability: { ptiVsHistory: -13.4, rentToIncome: null, incomeBasis: 'OECD household disposable income per household (2023)', debtService: 5.4, debtServiceGap: -0.8, unemployment: 4.0, unemploymentAsOf: '2026-08', unemploymentChange12m: 0.2, unemploymentRising: false, realWageGrowth3y: 1.44, wageStagnation: false, hhDebt: 48.5 },
  ptrVsHistory: 12.3, stress: { score: 38.1, rank: 26, count: 32, rankLow: 7, max: 100 },
  tier1: { count: 59, medianPrice10: 36.3, priceRank: 14, priceRankLow: 46, rentCount: 42, medianRent10: 1.0, rentRank: 30 },
  peers: { region: 'Europe & Central Asia', count: 33, medianPrice10: 36.3 },
  signals: { buyer: { label: 'Favourable', support: ['Prices are 13% below their long-run income ratio'], oppose: [] }, seller: { label: 'Hold', support: [], oppose: [] } },
  flags: [], flagIds: [], nowcast: { quarter: '2026-Q2', changePct: -1.8 },
  rates: { policy: 2.5, policyAsOf: '2026-09', mortgage: 4.01, mortgageSource: 'ECB new housing loans rate', mortgageIsProxy: false, spread: 2, delta: 0.27, originYear: 2025, liveShift10: -0.3, sens3: -1.83, sens10: -1.27, rentSens10: 0.9, sensValid: true },
});
const stale = base({
  name: 'United Arab Emirates', iso3: 'ARE', region: 'Middle East, North Africa, Afghanistan & Pakistan',
  originYear: 2023, stale: true, rent: null, rentOriginYear: null,
  price: { h1: band(-4.7, -14, 5), h3: band(-9.9, -22, 9), h5: band(-6, -25, 20), h10: band(-0.3, -32.3, 76.2) },
  history: { price: { change10: 3.1, change5: 18.2, peakYear: 2014, belowPeak: 9.5, atPeak: false }, rent: null },
  tier1: { count: 59, medianPrice10: 36.3, priceRank: 59, priceRankLow: 1, rentCount: 42, medianRent10: 1.0, rentRank: null },
  peers: { region: 'Middle East, North Africa, Afghanistan & Pakistan', count: 4, medianPrice10: 33.0 },
  affordability: {}, ptrVsHistory: null, stress: null, types: [], cities: { count: 2, rent: null, vacancy: null }, nowcast: null,
  rates: { policy: 3.875, policyAsOf: '2026-09', mortgage: 5.875, mortgageSource: 'policy rate + 2.0pp assumed spread', mortgageIsProxy: true, spread: 2, delta: -1.23, originYear: 2023, liveShift10: 1.6, sens3: -1.83, sens10: -1.27, rentSens10: 0.9, sensValid: true },
  flags: [], flagIds: [],
});
const slump = base({
  name: 'United Arab Emirates', iso3: 'ARE', originYear: 2023, stale: true, rent: null, affordability: {}, stress: null, types: [], cities: null, nowcast: null, flags: [], flagIds: [],
  live: { events: [{ class: 'transaction_slump', label: 'Sales slump', onset: '2026-09-01', intensity: -36.6, applies: true, effect3: -12.7, episodes: 8, clear: true, region: 'Dubai' }] },
});
const tier2 = {
  name: 'Niger', tier: 2,
  drivers: [
    { key: 'POP_GROWTH', label: 'Population growth', value: 3.2, display: '3.2%', period: '2025' },
    { key: 'URBAN_GROWTH', label: 'Urban growth', value: 5.0, display: '5.0%', period: '2025' },
    { key: 'INFLATION', label: 'Inflation', value: 4.7, display: '4.7%', period: '2025' },
    { key: 'LENDING_RATE', label: 'Lending rate', value: 5.3, display: '5.3%', period: '2016' },
    { key: 'PRIVATE_CREDIT', label: 'Private credit', value: 10.2, display: '10% GDP', period: '2025' },
  ],
};

// ── Checks ──────────────────────────────────────────────────────────────────────
const allText = out => [out.headline, ...out.kpis.flatMap(k => [k.label, k.value, k.period]), ...out.sections.flatMap(s => [s.title, ...s.paragraphs])].map(plain);
const sentences = p => plain(p).split(/(?<=[.!?:])\s+(?=[A-Z“])/).filter(Boolean);

// Every number in the prose must be (a rounding of) a number in the input, a year, or 0..10.
function unverifiedNumbers(text, input) {
  const known = new Set();
  const walk = v => {
    if (typeof v === 'number' && Number.isFinite(v)) for (const d of [0, 1, 2]) known.add(Math.abs(v).toFixed(d));
    else if (typeof v === 'string') for (const m of v.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []) for (const d of [0, 1, 2]) known.add(Number(m).toFixed(d));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  const bad = [];
  for (const m of text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    if (Number.isInteger(n) && ((n >= 1900 && n <= 2100) || n <= 10)) continue;
    const decimals = (m.split('.')[1] ?? '').length;
    if (known.has(n.toFixed(decimals))) continue;
    bad.push(m);
  }
  return bad;
}

const cases = { hot, cheap, stale, slump, tier2 };
for (const [name, input] of Object.entries(cases)) {
  test(`narrative (${name}): no dashes, no undefined/NaN, numbers traceable`, () => {
    const out = buildCountryNarrative(input);
    assert.ok(out.headline.length > 10);
    for (const t of allText(out)) {
      assert.ok(!/[—–]/.test(t), `dash in: ${t}`);
      assert.ok(!/ - /.test(t), `spaced hyphen in: ${t}`);
      assert.ok(!/undefined|NaN|null|Infinity/.test(t), `bad token in: ${t}`);
    }
    const prose = out.sections.flatMap(s => s.paragraphs).map(plain).join(' ');
    assert.deepEqual(unverifiedNumbers(prose + ' ' + plain(out.headline), input), [], `unverified numbers in ${name}`);
  });

  test(`narrative (${name}): paragraphs have 2 to 6 sentences and outlook closes prescriptively`, () => {
    const out = buildCountryNarrative(input);
    for (const s of out.sections) for (const p of s.paragraphs) {
      const n = sentences(p).length;
      assert.ok(n >= 2 && n <= 6, `${s.id}: ${n} sentences: ${p}`);
    }
    const outlook = out.sections.find(s => s.id === 'outlook');
    assert.ok(outlook, 'has outlook');
    const last = sentences(outlook.paragraphs.at(-1)).at(-1);
    assert.match(last, /needs to|should|will need to/, `outlook close: ${last}`);
  });
}

test('mixed-signal markets use the "However" pivot and the conditional "Unless" risk', () => {
  for (const input of [hot, cheap, stale]) {
    const text = buildCountryNarrative(input).sections.flatMap(s => s.paragraphs).join(' ');
    assert.match(text, /However,/);
    assert.match(text, /Unless /);
  }
});

test('headline reflects conditions', () => {
  assert.match(buildCountryNarrative(hot).headline, /^Canada: prices sit 50\.1% above their income history/);
  assert.match(buildCountryNarrative(stale).headline, /ends? in 2023|official prices end in 2023/);
  assert.match(buildCountryNarrative(slump).headline, /36\.6% drop in registered sales/);
  assert.match(buildCountryNarrative(tier2).headline, /no official house price index/);
});

test('slump with a clear historical effect says the adjustment is included', () => {
  const live = buildCountryNarrative(slump).sections.find(s => s.id === 'live');
  assert.match(plain(live.paragraphs[0]), /8 past episodes/);
  assert.match(plain(live.paragraphs[0]), /included above/);
});

test('rank reads from the bottom for weak markets and never exceeds the count', () => {
  const text = plain(buildCountryNarrative(stale).sections[0].paragraphs[0]);
  assert.match(text, /the lowest of 59 markets/);
});

test('rewriteRateSection rewrites the rate paragraph for a toggled path', () => {
  assert.equal(rewriteRateSection(hot, 0, {}), null);
  const out = rewriteRateSection(hot, 1, { price10: 40.4, price3: 5.5, basePrice10: 42.3, basePrice3: 7.4, rent10: 1.3, baseRent10: 1.7 });
  const t = plain(out.join(' '));
  assert.match(t, /3\.25%/);
  assert.match(t, /40\.4%/);
  assert.ok(!/[—–]| - /.test(t));
});
