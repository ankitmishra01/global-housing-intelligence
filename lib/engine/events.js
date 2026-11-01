// Historical event library: how far real house prices and rents moved against the
// model after past shocks of each class. Used by the live layer to size the adjustment
// for an event detected today. Pure; records come from the projection backtests.
import { finite, mean } from './stats.js';

export const EVENT_CLASSES = {
  armed_conflict: { label: 'Armed conflict', description: 'War or sustained armed violence on the country\'s own territory.' },
  regional_conflict: { label: 'Regional conflict or unrest', description: 'War in a neighbouring country, or severe domestic unrest, without war at home.' },
  natural_disaster: { label: 'Natural disaster', description: 'Major earthquake, flood or cyclone with national economic impact.' },
  currency_crisis: { label: 'Currency or financial crisis', description: 'Sharp currency collapse, sovereign or banking crisis.' },
};

// Onset year = the year the shock hit. Episodes whose country lacks a price series at
// the needed years are skipped automatically.
export const EPISODES = [
  { country: 'KOR', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'THA', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis (baht devaluation)' },
  { country: 'MYS', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'IDN', year: 1998, class: 'currency_crisis', label: 'Asian financial crisis (rupiah collapse)' },
  { country: 'HKG', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'RUS', year: 1998, class: 'currency_crisis', label: 'Russian default and rouble devaluation' },
  { country: 'TUR', year: 2001, class: 'currency_crisis', label: 'Turkish banking and lira crisis' },
  { country: 'ISL', year: 2008, class: 'currency_crisis', label: 'Icelandic banking collapse' },
  { country: 'IRL', year: 2008, class: 'currency_crisis', label: 'Irish banking crisis' },
  { country: 'GRC', year: 2010, class: 'currency_crisis', label: 'Greek sovereign debt crisis' },
  { country: 'PRT', year: 2011, class: 'currency_crisis', label: 'Portuguese sovereign debt crisis' },
  { country: 'ESP', year: 2012, class: 'currency_crisis', label: 'Spanish banking and debt crisis' },
  { country: 'CYP', year: 2013, class: 'currency_crisis', label: 'Cypriot banking crisis and bail-in' },
  { country: 'RUS', year: 2014, class: 'currency_crisis', label: 'Rouble crisis and sanctions after Crimea' },
  { country: 'BRA', year: 2015, class: 'currency_crisis', label: 'Brazilian recession and real depreciation' },
  { country: 'TUR', year: 2018, class: 'currency_crisis', label: 'Turkish lira crisis' },
  { country: 'TUR', year: 2021, class: 'currency_crisis', label: 'Turkish lira collapse' },
  { country: 'ARE', year: 2009, class: 'currency_crisis', label: 'Dubai World debt crisis' },
  { country: 'ARG', year: 2018, class: 'currency_crisis', label: 'Argentine peso crisis' },
  { country: 'ISR', year: 2006, class: 'armed_conflict', label: 'Second Lebanon War' },
  { country: 'ISR', year: 2014, class: 'armed_conflict', label: 'Gaza war' },
  { country: 'ISR', year: 2023, class: 'armed_conflict', label: 'Israel–Hamas war' },
  { country: 'RUS', year: 2022, class: 'armed_conflict', label: 'Invasion of Ukraine and sanctions' },
  { country: 'UKR', year: 2014, class: 'armed_conflict', label: 'War in eastern Ukraine' },
  { country: 'UKR', year: 2022, class: 'armed_conflict', label: 'Full-scale Russian invasion' },
  { country: 'COL', year: 1999, class: 'armed_conflict', label: 'Peak of armed conflict and recession' },
  { country: 'HKG', year: 2019, class: 'regional_conflict', label: 'Hong Kong protests' },
  { country: 'THA', year: 2014, class: 'regional_conflict', label: 'Thai political crisis and coup' },
  { country: 'POL', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'HUN', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'ROU', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'SVK', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'EST', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'LVA', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'LTU', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'FIN', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'JPN', year: 2011, class: 'natural_disaster', label: 'Tōhoku earthquake and tsunami' },
  { country: 'NZL', year: 2011, class: 'natural_disaster', label: 'Christchurch earthquake' },
  { country: 'CHL', year: 2010, class: 'natural_disaster', label: 'Maule earthquake' },
  { country: 'THA', year: 2011, class: 'natural_disaster', label: 'Thailand floods' },
  { country: 'MEX', year: 2017, class: 'natural_disaster', label: 'Puebla earthquake' },
  { country: 'ITA', year: 2009, class: 'natural_disaster', label: "L'Aquila earthquake" },
  { country: 'ITA', year: 2016, class: 'natural_disaster', label: 'Central Italy earthquakes' },
  { country: 'TUR', year: 2023, class: 'natural_disaster', label: 'Kahramanmaraş earthquakes' },
  { country: 'MAR', year: 2023, class: 'natural_disaster', label: 'Al Haouz earthquake' },
  { country: 'PHL', year: 2013, class: 'natural_disaster', label: 'Typhoon Haiyan' },
];

export const EVENT_TARGETS = ['real_price', 'real_rent'];
export const EVENT_HORIZONS = [1, 2, 3];

const sd = xs => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

// records: { real_price: { 1: [{unit, origin, actual, predicted}], ... }, real_rent: {...} }
// Residual for an episode = actual − shipped prediction from the forecast made at onset − 1.
export function estimateEventLibrary({ records, episodes = EPISODES, classes = Object.keys(EVENT_CLASSES) }) {
  const rows = [];
  for (const target of EVENT_TARGETS) for (const h of EVENT_HORIZONS) {
    const list = records?.[target]?.[h] || [];
    if (!list.length) continue;
    const index = new Map(list.map(r => [`${r.unit}|${r.origin}`, r]));
    const pooledSd = sd(list.map(r => r.actual - r.predicted).filter(finite)) || 1;
    const hits = episodes.map(e => {
      const r = index.get(`${e.country}|${e.year - 1}`);
      return r && finite(r.actual) && finite(r.predicted) ? { ...e, residual: +(r.actual - r.predicted).toFixed(3) } : null;
    }).filter(Boolean);
    const allResiduals = hits.map(x => x.residual);
    for (const cls of classes) {
      const own = hits.filter(x => x.class === cls);
      const pooled = own.length < 2;
      const used = pooled ? hits : own;
      const n = used.length;
      if (!n) continue;
      const res = pooled ? allResiduals : own.map(x => x.residual);
      const effect = mean(res) * (n / (n + 2));
      const se = n > 1 ? sd(res) / Math.sqrt(n) : pooledSd;
      rows.push({
        class: cls, target, horizon: h, effect: +effect.toFixed(3), se: +se.toFixed(3), n_episodes: own.length, pooled,
        episodes: JSON.stringify(own.map(({ country, year, label, residual }) => ({ country, year, label, residual }))
          .concat(pooled ? [{ note: `fewer than 2 episodes of this class with data; using the pooled mean of ${n} episodes across all classes` }] : [])),
      });
    }
  }
  return rows;
}
