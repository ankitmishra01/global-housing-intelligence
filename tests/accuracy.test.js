// Regression tests for errors found in the accuracy audit (docs/ACCURACY_AUDIT.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountryNarrative, plain } from '../lib/engine/narrative.js';
import { cbsRegionNames } from '../lib/sources/national/netherlands.js';
import { bisRegionName, bisUnitLabel } from '../lib/sources/bis.js';
import { householdIncome } from '../lib/engine/affordability.js';

const band = (m, lo, hi) => ({ median: m, p10: lo, p90: hi });
const input = over => ({
  name: 'Netherlands', iso3: 'NLD', tier: 1, region: 'Europe & Central Asia', bandLevel: 80, loanToValue: 80, rentBurden: 30, debtServiceWindow: 15,
  originYear: 2025, rentOriginYear: 2025, latestYear: 2025, stale: false, stale_rent: false,
  price: { h1: band(1, -5, 7), h3: band(8, -8, 25), h5: band(14, -10, 40), h10: band(35.99, 1, 120) },
  tier1: { count: 59, medianPrice10: 35.99, priceRank: 30, priceRankLow: 30, rentCount: 42, medianRent10: 1.03, rentRank: 10 },
  history: { price: { change10: 40, change5: 10, peakYear: 2025, belowPeak: 0, atPeak: true } },
  affordability: {}, stress: null, rates: { policy: 2.25, policyAsOf: '2026-09', mortgage: 3.94, mortgageSource: 'ECB new housing loans rate', mortgageIsProxy: false, spread: 2, delta: -0.27, originYear: 2025, liveShift10: 0.3, sens3: -1.8, sens10: -1.3, sensValid: true },
  skill: { price10: 8.6, price10Method: 'model' }, signals: {}, flags: [], flagIds: [], live: { events: [] }, types: [], cities: null,
  ...over,
});
const text = out => [out.headline, ...out.sections.flatMap(s => s.paragraphs)].map(plain).join(' ');

test('a market that is the median is described as in line with it, not ahead or behind', () => {
  const t = text(buildCountryNarrative(input()));
  assert.match(t, /in line with the median market/);
  assert.doesNotMatch(t, /(ahead of|behind) the median market/);
});

test('ahead/behind still used when clearly different', () => {
  assert.match(text(buildCountryNarrative(input({ price: { ...input().price, h10: band(45, 2, 130) } }))), /ahead of the median market/);
});

test('Dutch province and city with the same name stay distinct', () => {
  const names = cbsRegionNames([{ Key: 'PV26  ', Title: 'Utrecht (PV)' }, { Key: 'GM0344', Title: 'Utrecht (gemeente)' }, { Key: 'PV20  ', Title: 'Groningen (PV)' }]);
  assert.equal(names.PV26, 'Utrecht (province)');
  assert.equal(names.GM0344, 'Utrecht');
  assert.equal(names.PV20, 'Groningen');
});

test('BIS city titles: aggregates labelled, whole-country dropped, remainders named', () => {
  assert.equal(bisRegionName('Australia - Residential property price index, all dwellings, 8 cities'), '8-city aggregate');
  assert.equal(bisRegionName('Germany - Residential property price index, all dwellings, whole country'), null);
  assert.equal(bisRegionName('Italy - Residential property price index, all dwellings. Rome'), 'Rome');
  assert.equal(bisRegionName('Ireland - Residential property price index, all dwellings, excluding Dublin'), 'Ireland excluding Dublin');
  assert.equal(bisRegionName('Croatia - Residential property price index, all dwellings, rest of the country'), 'Rest of Croatia');
  assert.equal(bisRegionName('United Arab Emirates - Residential property prices, all dwellings, Dubai'), 'Dubai');
});

test('BIS unit codes become readable labels', () => {
  assert.equal(bisUnitLabel('779', '6'), 'index, December 2009 = 100');
  assert.equal(bisUnitLabel('AED', '1'), 'AED per square metre');
  assert.equal(bisUnitLabel('GBP', '0'), 'GBP per dwelling');
});

test('national median income basis states what the series measures', () => {
  const c = { MEDIAN_HH_INCOME: { 2024: 86000 } };
  assert.match(householdIncome(c, 'median total income of families and unattached individuals, Statistics Canada, 2024 dollars').basis, /families and unattached individuals.*\(2024\)/);
  assert.match(householdIncome(c).basis, /median household income/);
});

test('true median of an even count averages the two middle values', () => {
  const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

test('accuracy checks flag title-fragment region names and raw unit codes', async () => {
  const { createClient } = await import('@libsql/client');
  const { accuracyChecks } = await import('../sync/quality.js');
  const db = createClient({ url: 'file::memory:' });
  await db.execute("CREATE TABLE observations (country TEXT, indicator TEXT, region TEXT, dwelling_type TEXT, period TEXT, frequency TEXT, value REAL, status TEXT, source TEXT)");
  await db.execute("INSERT INTO observations VALUES ('DEU','CITY_PRICE','whole country','','2025','A',100,'actual','BIS detailed residential property prices (965)')");
  const fakeFetch = async () => { throw new Error('offline'); };
  const checks = await accuracyChecks(db, { fetchFn: fakeFetch });
  const by = Object.fromEntries(checks.map(c => [c.id, c]));
  assert.equal(by['accuracy.region_names'].severity, 'fail');
  assert.equal(by['accuracy.unit_labels'].severity, 'warn');
  assert.equal(by['accuracy.source_sample'].severity, 'info');
});

// ── Second audit (projection drivers, phases, nominal outlook, rates, cities, signals) ──
import { pricePhases, driverShares, latestRateMove, nominalOutlook, placesOnly } from '../lib/engine/narrative.js';
import { computeSignals, describe } from '../lib/engine/signals.js';

const allText = out => out.sections.flatMap(s => s.paragraphs).map(plain).join(' ');

test('price phases: legs and changes recomputed on a boom, bust and recovery', () => {
  // 100 → 150 (2010) → 120 (2014) → 132 (2020): +50%, -20%, then +10%.
  const real = { 2000: 100, 2004: 120, 2008: 140, 2010: 150, 2012: 130, 2014: 120, 2016: 125, 2018: 128, 2020: 132 };
  const nominal = { 2000: 100, 2010: 180, 2014: 175, 2020: 210 };
  const legs = pricePhases(real, nominal, 2020);
  assert.deepEqual(legs.map(l => [l.from, l.to]), [[2000, 2010], [2010, 2014], [2014, 2020]]);
  assert.deepEqual(legs.map(l => Math.round(l.real * 10) / 10), [50, -20, 10]);
  assert.equal(Math.round(legs[1].nominal * 100) / 100, -2.78);
});

test('price phases: a last leg shorter than the threshold runs to the origin', () => {
  const legs = pricePhases({ 2015: 100, 2016: 110, 2017: 120, 2018: 118, 2019: 115, 2020: 116 }, null, 2020);
  assert.deepEqual(legs.map(l => [l.from, l.to]), [[2015, 2017], [2017, 2020]]);
  assert.ok(Math.abs(legs[1].real - (100 * (116 / 120 - 1))) < 1e-9);
});

test('price phases: years with gaps and years after the origin are ignored', () => {
  const legs = pricePhases({ 2000: 100, 2003: 115, 2006: 130, 2009: 110, 2012: 112, 2030: 999 }, null, 2012);
  assert.deepEqual(legs.map(l => [l.from, l.to]), [[2000, 2006], [2006, 2009], [2009, 2012]]);
});

test('phase prose: "because consumer prices rose faster" only where nominal rose and real fell; doubling words', () => {
  const n = (phases) => allText(buildCountryNarrative(input({ history: { price: {}, phases } })));
  const t = n([{ from: 2007, to: 2012, real: -12, nominal: 4 }, { from: 2012, to: 2020, real: -5, nominal: -2 }]);
  assert.equal((t.match(/because consumer prices rose faster/g) || []).length, 1);
  assert.match(t, /fell 12\.0% between 2007 and 2012 even though nominal prices rose 4\.0%/);
  assert.doesNotMatch(n([{ from: 2000, to: 2025, real: 106.7, nominal: 138 }]), /nearly doubled/);
  assert.match(n([{ from: 2000, to: 2025, real: 95, nominal: 120 }]), /nearly doubled/);
});

test('nominal outlook is the real path compounded with every year of inflation', () => {
  const infl = { 1: 3, 2: 2.5, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2 };
  const out = nominalOutlook(20, infl);
  const expected = 100 * (1.2 * [3, 2.5, 2, 2, 2, 2, 2, 2, 2, 2].reduce((a, v) => a * (1 + v / 100), 1) - 1);
  assert.ok(Math.abs(out.price10 - expected) < 1e-9);
  assert.ok(Math.abs(out.inflAvg - 2.15) < 1e-9);
  assert.match(allText(buildCountryNarrative(input({ nominal: out }))), new RegExp(`inflation averaging ${out.inflAvg.toFixed(1)}% a year .*about ${expected.toFixed(1)}% higher by 2035`));
});

test('driver shares add up to the model projection and the prose quotes them', () => {
  const stored = { method: 'ridge', weight: 1, base: 17.6, anchor: 0, total: 32.26, features: [
    { name: 'household credit change (3y)', value: -6.975, typical: 3.899, contribution: 13.279 },
    { name: 'own 1y real growth', value: 14.3, typical: 1.656, contribution: -1.235 },
    { name: 'household debt-service gap', value: -0.317, typical: 0.794, contribution: -2.578 },
    { name: 'real GDP growth', value: 2.3, typical: 2.9, contribution: 5.194 },
  ] };
  const d = driverShares(stored);
  assert.ok(Math.abs(d.totalPct - 100 * (Math.exp(0.3226) - 1)) < 1e-9);
  assert.ok(Math.abs(d.base + d.anchor + d.features.reduce((a, f) => a + f.contribution, 0) - d.totalPct) < 1e-6);
  const t = allText(buildCountryNarrative(input({ drivers: { h10: d, h3: null, rent10: null, modelPrice10: d.totalPct, liveGap10: 0 } })));
  assert.match(t, new RegExp(`real prices up ${d.totalPct.toFixed(1)}% over ten years`));
  assert.match(t, new RegExp(`gained ${d.base.toFixed(1)}% in real terms over a decade`));
  assert.match(t, new RegExp(`own conditions add ${(d.totalPct - d.base).toFixed(1)} points`));
  const credit = d.features.find(f => f.name.startsWith('household credit'));
  assert.match(t, new RegExp(`household credit down 7\\.0 points of GDP over the three years to 2025, against up 3\\.9 points in the typical market, which adds about ${credit.contribution.toFixed(1)} points`));
  // Momentum is stored in log points: 14.3 log points is a 15.4% rise, quoted for the origin year.
  assert.match(t, /real price growth of 15\.4% in 2025/i);
});

test('latest rate move: live reading newer than the monthly series, and the month it took effect', () => {
  const monthly = [{ period: '2026-07', value: 12 }, { period: '2026-08', value: 12 }, { period: '2026-09', value: 12 }];
  assert.deepEqual(latestRateMove({ liveNewer: true, liveRate: 12.25, liveDate: '2026-10-23', monthlyRate: 12, monthlyAsOf: '2026-09', monthly }), { size: 0.25, from: 12, since: '2026-10' });
  // More than a month after the monthly series the move month is unknown.
  assert.equal(latestRateMove({ liveNewer: true, liveRate: 12.25, liveDate: '2026-11-23', monthlyRate: 12, monthlyAsOf: '2026-09', monthly }).since, '');
  // No live change: the last monthly step, dated by the month the new level first appears.
  const steps = [{ period: '2026-08', value: 2.25 }, { period: '2026-09', value: 2.5 }, { period: '2026-10', value: 2.5 }];
  assert.deepEqual(latestRateMove({ liveNewer: true, liveRate: 2.5, liveDate: '2026-10-27', monthlyRate: 2.5, monthlyAsOf: '2026-09', monthly: steps }), { size: 0.25, from: 2.25, since: '2026-09' });
  assert.equal(latestRateMove({ liveNewer: false, liveRate: null, liveDate: null, monthlyRate: 6.5, monthlyAsOf: '2026-09', monthly: [{ period: '2026-09', value: 6.5 }] }), null);
});

test('rate prose: central bank names, the UAE proxy and "even after" only against the net move', () => {
  const rates = (iso3, lastMove, delta) => buildCountryNarrative(input({ iso3, rates: { ...input().rates, lastMove, delta } })).sections.find(s => s.id === 'rates').paragraphs[0];
  assert.match(plain(rates('IDN', { size: 0.25, from: 5.5, since: '2026-06' }, 0.48)), /^Bank Indonesia raised/);
  assert.match(plain(rates('ARE', { size: 0.25, from: 3.625, since: '2026-09' }, -1.23)), /^The Federal Reserve, whose rate the dirham peg follows, raised.*Even after that increase, the rate sits 1\.23 points below/);
  assert.doesNotMatch(plain(rates('DEU', { size: 0.25, from: 2.25, since: '2026-09' }, 0.27)), /Even after/);
});

test('city comparisons leave out aggregates, remainders and duplicate spellings', () => {
  const names = placesOnly(['Berlin', '127-city aggregate', '10-city aggregate (discontinued)', 'Province : agglomérations de moins de 10 000 habitants', 'Île-de-France, hors Paris', 'Trøndelag exluding Trondheim', 'Oslo including Baerum', 'Oslo including Bærum', 'Castilla - La Mancha'].map(name => ({ name }))).map(x => x.name);
  assert.deepEqual(names, ['Berlin', 'Oslo including Baerum', 'Castilla-La Mancha']);
});

test('signals: momentum is already a percent, qualifiers follow the raw ranking for every persona', () => {
  assert.equal(describe('momentum', 12.78), 'Real prices rose 12.8% in the latest year');
  assert.equal(describe('proj3Price', 18.82), 'Real prices projected up 20.7% over 3 years');
  const comps = pct => ({ seller: [{ key: 'proj3Price', value: 18.82, percentile: pct }], buyer: [{ key: 'proj3Price', value: 18.82, percentile: 100 - pct }] });
  // Strong projected growth: low (oriented) percentile for sellers, high for buyers. Never "less than in most markets".
  const strong = computeSignals({ scores: { seller: 50, buyer: 50 }, components: comps(2) });
  assert.doesNotMatch([...strong.seller.support, ...strong.seller.oppose, ...strong.buyer.support, ...strong.buyer.oppose].join(' '), /less than in most markets/);
  const weak = computeSignals({ scores: { seller: 50, buyer: 50 }, components: comps(98) });
  assert.match([...weak.seller.support, ...weak.seller.oppose].join(' '), /less than in most markets/);
  assert.match([...weak.buyer.support, ...weak.buyer.oppose].join(' '), /less than in most markets/);
  // Exactly at the median there is no "most markets" comparison.
  const mid = computeSignals({ scores: { buyer: 50 }, components: { buyer: [{ key: 'burden3y', value: 30, percentile: 50 }] } });
  assert.doesNotMatch(mid.buyer.support.concat(mid.buyer.oppose).join(' '), /most markets/);
});
