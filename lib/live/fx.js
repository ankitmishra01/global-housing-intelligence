// Exchange rates vs USD (Frankfurter, ECB reference rates) for currency-crisis detection.
import { fetchJson } from '../sources/util.js';
import { EURO_AREA } from '../registry.js';

export const CURRENCY_COUNTRIES = {
  AUD: ['AUS'], BGN: ['BGR'], BRL: ['BRA'], CAD: ['CAN'], CHF: ['CHE', 'LIE'], CNY: ['CHN'], CZK: ['CZE'], DKK: ['DNK'],
  GBP: ['GBR'], HKD: ['HKG'], HUF: ['HUN'], IDR: ['IDN'], ILS: ['ISR'], INR: ['IND'], ISK: ['ISL'], JPY: ['JPN'],
  KRW: ['KOR'], MXN: ['MEX'], MYR: ['MYS'], NOK: ['NOR'], NZD: ['NZL'], PHP: ['PHL'], PLN: ['POL'], RON: ['ROU'],
  SEK: ['SWE'], SGD: ['SGP'], THB: ['THA'], TRY: ['TUR'], ZAR: ['ZAF'],
  EUR: Object.keys(EURO_AREA),
};

// USD per unit falling = local currency weakening. rates are units of currency per USD.
// Returns { [iso3]: { now, then, changePct } } where changePct < 0 means the local currency lost value.
export function currencyMoves(nowRates, thenRates) {
  const out = {};
  for (const [ccy, countries] of Object.entries(CURRENCY_COUNTRIES)) {
    const a = nowRates?.[ccy], b = thenRates?.[ccy];
    if (!a || !b) continue;
    const changePct = 100 * (b / a - 1);
    for (const iso3 of countries) out[iso3] = { currency: ccy, now: a, then: b, changePct };
  }
  return out;
}

export async function fetchFx(now = new Date()) {
  const then = new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10);
  const [latest, past] = await Promise.all([
    fetchJson('https://api.frankfurter.dev/v1/latest?base=USD'),
    fetchJson(`https://api.frankfurter.dev/v1/${then}?base=USD`),
  ]);
  return { date: latest.date, moves: currencyMoves(latest.rates, past.rates), rates: latest.rates };
}
