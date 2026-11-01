import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseGdeltDay, COL } from '../lib/live/gdelt.js';
import { unzipEntry } from '../lib/sources/national/canada.js';
import { FIPS_TO_ISO3, fipsToIso3 } from '../lib/live/fips.js';
import { conflictStats, detectEvents, RULES } from '../lib/live/detect.js';
import { parseGdacs } from '../lib/live/gdacs.js';
import { currencyMoves } from '../lib/live/fx.js';
import { rateShift, eventShift, countryShifts, familyOf, EVENT_CAP } from '../lib/live/shifts.js';
import { latestByCountry, parseValetLatest } from '../lib/live/rates.js';

// One GDELT 1.0 row with 58 columns; only the fields the parser reads are filled.
function gdeltRow({ root, mentions, geo }) {
  const f = Array(58).fill('');
  f[COL.root] = root; f[COL.mentions] = String(mentions); f[COL.geo] = geo;
  return f.join('\t');
}

function zipOf(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(centralPart.length, 12); eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

test('parseGdeltDay sums conflict and all mentions per ISO3 from a zipped TSV', () => {
  const tsv = [
    gdeltRow({ root: '19', mentions: 10, geo: 'UP' }),
    gdeltRow({ root: '04', mentions: 30, geo: 'UP' }),
    gdeltRow({ root: '18', mentions: 5, geo: 'AE' }),
    gdeltRow({ root: '20', mentions: 7, geo: 'XX' }), // unknown FIPS ignored
    'short\trow',
  ].join('\n');
  const text = unzipEntry(zipOf('20261030.export.CSV', tsv), '.CSV');
  const day = parseGdeltDay(text);
  assert.deepEqual(day.UKR, { conflict: 10, all: 40 });
  assert.deepEqual(day.ARE, { conflict: 5, all: 5 });
  assert.equal(Object.keys(day).length, 2);
});

test('FIPS map: spot checks of codes that differ from ISO', () => {
  assert.equal(fipsToIso3('UP'), 'UKR');
  assert.equal(fipsToIso3('RS'), 'RUS');
  assert.equal(fipsToIso3('IS'), 'ISR');
  assert.equal(fipsToIso3('UK'), 'GBR');
  assert.equal(fipsToIso3('GM'), 'DEU');
  assert.equal(fipsToIso3('SZ'), 'CHE');
  assert.equal(fipsToIso3('KS'), 'KOR');
  assert.equal(fipsToIso3('AE'), 'ARE');
  assert.equal(fipsToIso3('ZZ'), null);
  assert.ok(Object.keys(FIPS_TO_ISO3).length > 200);
});

// 60 quiet days at ~4% conflict share, then a recent window at the given share.
function history(recentShare, { all = 10000, days = 60, recent = 7, baseShare = 0.04 } = {}) {
  const out = [];
  for (let i = 0; i < days + recent; i++) {
    const d = new Date(Date.UTC(2026, 7, 1) + i * 864e5).toISOString().slice(0, 10);
    const jitter = (i % 5) * 0.004 - 0.008;
    const share = i >= days ? recentShare : baseShare + jitter;
    out.push({ date: d, conflict: Math.round(share * all), all });
  }
  return out;
}

test('conflictStats: z-score vs own baseline, mentions over the recent 7 days', () => {
  const s = conflictStats(history(0.2));
  assert.ok(s.z > 10);
  assert.equal(s.mentions7, 7 * 2000);
  assert.equal(conflictStats(history(0.04).slice(-10)), null, 'too little history');
});

const regions = { UKR: 'Europe', RUS: 'Europe', POL: 'Europe', CAN: 'North America', ARE: 'Middle East', ISR: 'Middle East', AUS: 'East Asia' };
const quiet = () => history(0.04);

test('detectEvents: escalation applies, ongoing war shown without shift, quiet countries untouched', () => {
  const histories = {
    UKR: history(0.25), // spike vs its own baseline → escalation
    CAN: quiet(), AUS: quiet(), POL: quiet(), ARE: quiet(),
    ISR: history(0.2, { baseShare: 0.2 }), // persistently high → ongoing
    RUS: quiet(), USA: quiet(), GBR: quiet(),
  };
  const events = detectEvents({ today: '2026-10-17', histories, regions });
  const ukr = events.find(e => e.country === 'UKR');
  assert.equal(ukr.class, 'armed_conflict');
  assert.equal(ukr.evidence.mode, 'escalation');
  assert.equal(ukr.evidence.applies, true);
  const isr = events.find(e => e.country === 'ISR');
  assert.equal(isr.evidence.mode, 'ongoing');
  assert.equal(isr.evidence.applies, false);
  assert.ok(!events.some(e => ['CAN', 'AUS'].includes(e.country)));
});

test('detectEvents: floor blocks tiny-volume spikes', () => {
  const events = detectEvents({ today: '2026-10-17', histories: { UKR: history(0.25, { all: 300 }), CAN: quiet(), AUS: quiet() }, regions });
  assert.equal(events.length, 0);
});

test('detectEvents: regional spillover needs a conflict in the same region and an own spike', () => {
  const histories = {
    ISR: history(0.3), // escalation in the Middle East
    ARE: history(0.07, { all: 20000 }), // own share up from ~4% → z ≥ 1.5, mentions above the regional floor
    CAN: history(0.07, { all: 20000 }), // same spike but different region → nothing
    AUS: quiet(), POL: quiet(),
  };
  const events = detectEvents({ today: '2026-10-17', histories, regions });
  const are = events.find(e => e.country === 'ARE');
  assert.equal(are?.class, 'regional_conflict');
  assert.deepEqual(are.evidence.conflictCountries, ['ISR']);
  assert.ok(!events.some(e => e.country === 'CAN'));
});

test('detectEvents: disasters within 60 days and currency drops ≥ 15%; onset stays stable; expiry', () => {
  const disasters = [{ iso3: 'JPN', type: 'EQ', level: 'Red', name: 'Earthquake', date: '2026-10-01', id: 'EQ1' }, { iso3: 'CHL', type: 'EQ', level: 'Red', name: 'Old', date: '2026-06-01', id: 'EQ0' }];
  const fxMoves = { TUR: { currency: 'TRY', changePct: -22 }, CAN: { currency: 'CAD', changePct: -3 } };
  const previous = [
    { id: 'TUR:currency_crisis:2026-09-01', country: 'TUR', class: 'currency_crisis', status: 'active', onset: '2026-09-01', last_seen: '2026-10-16', evidence: {} },
    { id: 'MEX:currency_crisis:2026-08-01', country: 'MEX', class: 'currency_crisis', status: 'active', onset: '2026-08-01', last_seen: '2026-09-01', evidence: {} },
  ];
  const events = detectEvents({ today: '2026-10-17', histories: {}, regions, disasters, fxMoves, previous });
  assert.equal(events.find(e => e.country === 'JPN').class, 'natural_disaster');
  assert.ok(!events.some(e => e.country === 'CHL'));
  const tur = events.find(e => e.country === 'TUR');
  assert.equal(tur.onset, '2026-09-01');
  assert.equal(tur.id, 'TUR:currency_crisis:2026-09-01');
  assert.ok(!events.some(e => e.country === 'CAN'));
  assert.equal(events.find(e => e.country === 'MEX').status, 'expired');
  assert.equal(RULES.currencyDrop, -15);
});

test('parseGdacs keeps sudden red/orange hazards on the primary country and drops droughts', () => {
  const json = { features: [
    { properties: { eventtype: 'DR', alertlevel: 'Red', iso3: 'ESP', eventid: 1, fromdate: '2026-10-01' } },
    { properties: { eventtype: 'TC', alertlevel: 'Red', iso3: 'GUM', affectedcountries: [{ iso3: 'GUM' }, { iso3: 'JPN' }], eventid: 2, name: 'TC', fromdate: '2026-10-14T12:00:00' } },
    { properties: { eventtype: 'VO', alertlevel: 'Orange', iso3: 'ISL', eventid: 3, fromdate: '2026-10-02' } },
    { properties: { eventtype: 'EQ', alertlevel: 'Orange', iso3: 'TUR', eventid: 4, fromdate: '2026-10-03' } },
  ] };
  const out = parseGdacs(json);
  assert.deepEqual(out.map(d => d.iso3), ['GUM', 'TUR']);
  assert.equal(out[0].date, '2026-10-14');
});

test('currencyMoves: weaker local currency is a negative change; euro maps to members', () => {
  const moves = currencyMoves({ TRY: 48, EUR: 0.9 }, { TRY: 40, EUR: 0.9 });
  assert.ok(Math.abs(moves.TUR.changePct - (100 * (40 / 48 - 1))) < 1e-9);
  assert.equal(moves.DEU.changePct, 0);
  assert.ok(moves.FRA && moves.HRV);
});

test('rates: latest daily rate per country; Valet latest observation', () => {
  const latest = latestByCountry([{ iso3: 'CAN', period: '2026-10-01', value: 2.5 }, { iso3: 'CAN', period: '2026-10-26', value: 2.25 }]);
  assert.deepEqual(latest.CAN, { date: '2026-10-26', value: 2.25 });
  assert.deepEqual(parseValetLatest({ observations: [{ d: '2026-10-21', V80691335: { v: '6.09' } }, { d: '2026-10-28', V80691335: { v: '6.19' } }] }), { date: '2026-10-28', value: 6.19 });
});

const sens = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap(h => [
  { target: 'real_price', horizon: h, coef: -2, se: 0.5, valid: 1 },
  { target: 'real_rent', horizon: h, coef: 1, se: 0.2, valid: 1 },
  { target: 'type_price', horizon: h, coef: -3, se: 0.4, valid: 1 },
]);
const library = [1, 2, 3].flatMap(h => [
  { class: 'armed_conflict', target: 'real_price', horizon: h, effect: -5 * h, se: 2, n_episodes: 7 },
  { class: 'armed_conflict', target: 'real_rent', horizon: h, effect: -1 * h, se: 1, n_episodes: 7 },
  { class: 'currency_crisis', target: 'real_price', horizon: h, effect: -12 * h, se: 3, n_episodes: 5 },
]);

test('rateShift: coefficient × delta; invalid sensitivity gives zero', () => {
  const r = rateShift(0.5, sens, 'real_price');
  assert.equal(r[3].shift, -1);
  assert.equal(r[3].se, 0.25);
  const off = rateShift(1, sens.map(s => ({ ...s, valid: 0 })), 'real_price');
  assert.equal(off[5].shift, 0);
});

test('eventShift: effects held at the 3-year level beyond h3, summed and capped', () => {
  const one = eventShift([{ class: 'armed_conflict' }], library, 'real_price');
  assert.equal(one[1].shift, -5);
  assert.equal(one[3].shift, -15);
  assert.equal(one[10].shift, -15);
  const two = eventShift([{ class: 'armed_conflict' }, { class: 'currency_crisis' }], library, 'real_price');
  assert.equal(two[10].shift, -EVENT_CAP); // −15 − 36 = −51, capped
  assert.ok(Math.abs(two[3].se - Math.hypot(2, 3)) < 1e-9);
});

test('countryShifts: families, types use type_price coefs, price_to_rent = price − rent', () => {
  assert.deepEqual(familyOf('real_price:condo'), { rate: 'type_price', event: 'real_price' });
  const out = countryShifts({ targets: ['real_price', 'nominal_price', 'real_rent', 'nominal_rent', 'price_to_rent', 'real_price:condo'], delta: 1, sens, events: [{ class: 'armed_conflict' }], library });
  assert.equal(out.real_price[1].shift, -2 - 5);
  assert.equal(out['real_price:condo'][1].shift, -3 - 5);
  assert.equal(out.real_rent[1].shift, 1 - 1);
  assert.equal(out.price_to_rent[10].shift, out.nominal_price[10].shift - out.nominal_rent[10].shift);
  const none = countryShifts({ targets: ['real_price'], delta: 0, sens, events: [], library });
  assert.equal(none.real_price[10].shift, 0);
});
