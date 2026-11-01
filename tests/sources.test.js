import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parseCsv, csvObjects, annualAverage } from '../lib/sources/util.js';
import { parseBisCsv, expandEuroPolicy, parseBisDwellingTypes } from '../lib/sources/bis.js';
import { parseOecdCsv } from '../lib/sources/oecd.js';
import { parseImf } from '../lib/sources/imf.js';
import { parseWorldBank } from '../lib/sources/worldbank.js';
import { parseCanadaRents, parseCanadaVacancy, parseCanadaStarts, parseCanadaNhpi, unzipEntry } from '../lib/sources/national/canada.js';
import { parseFred } from '../lib/sources/national/united-states.js';
import { parseUkHpi } from '../lib/sources/national/united-kingdom.js';
import { parseAbs } from '../lib/sources/national/australia.js';
import { parseZillowNational } from '../lib/sources/national/zillow.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ISO2 = new Map([['CA', 'CAN'], ['DE', 'DEU'], ['US', 'USA'], ['GB', 'GBR'], ['FR', 'FRA']]);

test('parseCsv handles quotes, embedded commas, newlines and a BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line\nbreak"\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line\nbreak'], ['1', '2', '3']]);
  assert.deepEqual(csvObjects('k,v\n1,2'), [{ k: '1', v: '2' }]);
});

test('annualAverage keeps complete years only', () => {
  const q = [
    ...['Q1', 'Q2', 'Q3', 'Q4'].map((p, i) => ({ period: `2024-${p}`, value: 100 + i })),
    { period: '2025-Q1', value: 200 }, { period: '2025-Q2', value: 210 },
  ];
  assert.deepEqual(annualAverage(q), [{ period: '2024', value: 101.5 }]);
  const m = Array.from({ length: 12 }, (_, i) => ({ period: `2023-${String(i + 1).padStart(2, '0')}`, value: i + 1 }));
  m.push({ period: '2024-01', value: 99 });
  assert.deepEqual(annualAverage(m), [{ period: '2023', value: 6.5 }]);
  assert.deepEqual(annualAverage([{ period: '2020', value: 3 }]), [{ period: '2020', value: 3 }]);
});

test('parseBisCsv maps ISO2, drops aggregates and blanks', () => {
  const out = parseBisCsv(fixture('bis_spp.csv'), 'REF_AREA', ISO2);
  assert.deepEqual(out, [{ iso3: 'CAN', period: '2023-Q1', value: 159.7751 }, { iso3: 'CAN', period: '2023-Q2', value: 165.3041 }]);
});

test('expandEuroPolicy gives euro members the ECB rate from their joining year', () => {
  const pts = [
    { iso3: 'XM', period: '1998-12', value: 3 }, { iso3: 'XM', period: '1999-01', value: 3 },
    { iso3: 'DEU', period: '1998-12', value: 3.3 }, { iso3: 'DEU', period: '1999-01', value: 9 },
    { iso3: 'USA', period: '1999-01', value: 4.75 },
  ];
  const out = expandEuroPolicy(pts);
  const deu = out.filter(p => p.iso3 === 'DEU').sort((a, b) => a.period.localeCompare(b.period));
  assert.deepEqual(deu.map(p => [p.period, p.value]), [['1998-12', 3.3], ['1999-01', 3]]);
  assert.ok(out.some(p => p.iso3 === 'USA'));
  assert.ok(!out.some(p => p.iso3 === 'XM'));
  assert.ok(!out.some(p => p.iso3 === 'HRV' && p.period.startsWith('1999')), 'Croatia joined in 2023');
});

test('parseBisDwellingTypes keeps the longest series per country and type', () => {
  const header = 'FREQ,REF_AREA,COVERED_AREA,RE_TYPE,RE_VINTAGE,COMPILING_ORG,PRICED_UNIT,ADJUST_CODED,TIME_PERIOD,OBS_VALUE';
  const rows = [];
  for (let y = 2010; y <= 2020; y++) rows.push(`A,FR,0,8,0,1,0,0,${y},${100 + y - 2010}`);
  for (let y = 2015; y <= 2020; y++) rows.push(`A,FR,0,8,0,2,0,0,${y},${500 + y}`);
  for (let y = 2015; y <= 2020; y++) rows.push(`A,FR,2,8,0,1,0,0,${y},1`); // regional coverage, ignored
  rows.push('A,FR,0,9,0,1,0,0,2020,5'); // multi-dwelling buildings, not mapped
  const out = parseBisDwellingTypes([header, ...rows].join('\n'), ISO2);
  assert.equal(out.length, 11);
  assert.ok(out.every(r => r.country === 'FRA' && r.dwelling_type === 'condo' && r.indicator === 'TYPE_PRICE_INDEX'));
  assert.equal(out.find(r => r.period === '2020').value, 110);
});

test('parseOecdCsv maps measures and filters unknown areas and measures', () => {
  const out = parseOecdCsv(fixture('oecd_house.csv'), new Set(['CAN']));
  assert.deepEqual(out.map(r => [r.indicator, r.period, r.value]), [['RENT', '2025', 137.07], ['PTR_AVG', '2025', 171.29], ['OECD_REAL_PRICE', '2024', 151.95]]);
});

test('parseImf marks the current year onward as forecast', () => {
  const payload = { values: { PCPIPCH: { CAN: { 2024: 2.4, 2025: 2.0, 2026: 1.9, 2030: 2 }, WEOWORLD: { 2025: 4 } } } };
  const out = parseImf(payload, 'PCPIPCH', 'INFLATION', new Set(['CAN']), 2026);
  assert.deepEqual(out.map(r => [r.period, r.status]), [['2024', 'actual'], ['2025', 'actual'], ['2026', 'forecast'], ['2030', 'forecast']]);
});

test('parseWorldBank keeps registry economies and skips nulls', () => {
  const payload = [{}, [
    { countryiso3code: 'CAN', date: '2024', value: 1.2 },
    { countryiso3code: 'WLD', date: '2024', value: 0.9 },
    { countryiso3code: 'CAN', date: '2023', value: null },
  ]];
  assert.deepEqual(parseWorldBank(payload, 'POP_GROWTH', new Set(['CAN'])).map(r => [r.country, r.period, r.value]), [['CAN', '2024', 1.2]]);
});

test('Canada parsers: two-bedroom rents, vacancy, complete-year starts, NHPI', () => {
  const rents = [
    'REF_DATE,GEO,Type of structure,Type of unit,VALUE',
    '2024,"Toronto, Ontario",Row and apartment structures of three units and over,Two bedroom units,2100',
    '2024,"Toronto, Ontario",Row and apartment structures of three units and over,One bedroom units,1800',
    '2024,"Kentville, Nova Scotia",Row and apartment structures of three units and over,Two bedroom units,1200',
    '1987,"Toronto, Ontario",Row and apartment structures of three units and over,Two bedroom units,',
  ].join('\n');
  assert.deepEqual(parseCanadaRents(rents).map(r => [r.indicator, r.region, r.period, r.value]), [['AVG_RENT_2BR', 'Toronto', '2024', 2100], ['AVG_RENT_1BR', 'Toronto', '2024', 1800], ['AVG_RENT_2BR', 'Kentville', '2024', 1200]]);

  const vac = ['REF_DATE,GEO,VALUE', '2024,Census metropolitan areas,2.2', '2024,"Vancouver, British Columbia",1.6', '2024,"Barrie, Ontario",3'].join('\n');
  assert.deepEqual(parseCanadaVacancy(vac).map(r => [r.region, r.value]), [['', 2.2], ['Vancouver', 1.6], ['Barrie', 3]]);

  const starts = ['REF_DATE,GEO,Housing estimates,Type of unit,Seasonal adjustment,VALUE'];
  for (let m = 1; m <= 12; m++) starts.push(`2024-${String(m).padStart(2, '0')},Canada,Housing starts,Total units,Unadjusted,1000`);
  starts.push('2025-01,Canada,Housing starts,Total units,Unadjusted,900');
  starts.push('2024-01,Canada,Housing completions,Total units,Unadjusted,5');
  assert.deepEqual(parseCanadaStarts(starts.join('\n')).map(r => [r.period, r.value]), [['2024', 12000]]);

  const nhpi = ['REF_DATE,GEO,New housing price indexes,VALUE', '2026-09,Canada,Total (house and land),124.1', '2026-09,Canada,Land only,90'].join('\n');
  assert.deepEqual(parseCanadaNhpi(nhpi).map(r => [r.period, r.value]), [['2026-09', 124.1]]);
});

// Build a single-entry deflate zip in memory to exercise the minimal reader.
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('unzipEntry reads the data CSV and skips the metadata file', () => {
  const zip = makeZip([['34100127_MetaData.csv', 'meta'], ['34100127.csv', 'REF_DATE,VALUE\n2024,2.2\n']]);
  assert.equal(unzipEntry(zip, '34100127.csv'), 'REF_DATE,VALUE\n2024,2.2\n');
  assert.throws(() => unzipEntry(Buffer.from('nope'), 'x.csv'));
});

test('parseFred: quarterly periods and weekly to monthly means', () => {
  const weekly = parseFred(fixture('fred_mortgage.csv'), 'MORTGAGE30US');
  assert.equal(weekly.frequency, 'M');
  assert.deepEqual(weekly.points.map(p => [p.period, +p.value.toFixed(3)]), [['2026-09', 6.85], ['2026-10', 7.3]]);
  const q = parseFred('observation_date,MSPUS\n2026-04-01,413500\n2026-07-01,393300\n', 'MSPUS');
  assert.deepEqual(q.points, [{ period: '2026-Q2', value: 413500 }, { period: '2026-Q3', value: 393300 }]);
});

test('parseUkHpi maps Land Registry columns to dwelling types', () => {
  const out = parseUkHpi(fixture('ukhpi.csv'), '');
  const byType = Object.fromEntries(out.map(r => [r.dwelling_type, [r.indicator, r.value]]));
  assert.deepEqual(byType, {
    '': ['AVG_PRICE', 266796], detached: ['TYPE_PRICE_LEVEL', 434485], semi_detached: ['TYPE_PRICE_LEVEL', 268157],
    townhouse: ['TYPE_PRICE_LEVEL', 224227], condo: ['TYPE_PRICE_LEVEL', 196942],
  });
});

test('parseAbs keeps mean price rows, scales by unit multiplier and names states', () => {
  const csv = [
    'MEASURE,REGION,TIME_PERIOD,OBS_VALUE,UNIT_MULT',
    '5,AUS,2025-Q2,1002.3,3',
    '5,2,2025-Q2,900,3',
    '1,AUS,2025-Q2,11000000,6',
  ].join('\n');
  assert.deepEqual(parseAbs(csv).map(r => [r.region, r.value]), [['', 1002300], ['Victoria', 900000]]);
});

test('parseZillowNational reads the country row only and skips blanks', () => {
  assert.deepEqual(parseZillowNational(fixture('zillow.csv')), [{ period: '2025-10', value: 350000.5 }, { period: '2025-11', value: 351000 }]);
});
