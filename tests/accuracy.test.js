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
