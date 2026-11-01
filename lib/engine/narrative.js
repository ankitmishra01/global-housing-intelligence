// Country narrative: the written analysis that sits beside each chart on a country page.
//
// Voice: Ankit Mishra's Forbes / OECD / IMF register. A data-anchored opening, "However" to
// pivot from strength to complication, "Moreover" to add evidence, conditional risk framing
// ("Unless X, the market will struggle to Y"), a prescriptive close. Precise numbers always
// set against the median market, regional peers and the country's own history. Flowing
// paragraphs, no bullets, no dashes. Every figure comes from the input; nothing is invented.
//
// Key figures are wrapped in **double asterisks** so the UI can render them in bold.

const finite = v => typeof v === 'number' && Number.isFinite(v);
const b = s => `**${s}**`;
const f1 = v => Math.abs(v).toFixed(1);
const f2 = v => Math.abs(v).toFixed(2);
const pctAbs = v => `${f1(v)}%`;
const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const rise = (v, up = 'rise', down = 'fall') => (v >= 0 ? up : down);
// "a projected rise of 36.3%" / "a projected fall of 2.1%"
const projected = v => `a projected ${v >= 0 ? 'rise' : 'fall'} of ${pctAbs(v)}`;
// "the 16th highest of 59", or "the 3rd lowest of 59" for the bottom half.
// lowRank (rank from the bottom) is supplied by the input builder so no figure is derived here.
const rankPhrase = (rank, count, lowRank, dir = 'highest') => {
  const low = dir === 'highest' ? 'lowest' : 'highest';
  const [r, d] = rank > Math.ceil(count / 2) && finite(lowRank) ? [lowRank, low] : [rank, dir];
  return (r === 1 ? `the ${d}` : `the ${ordinal(r)} ${d}`) + ` of ${count}`;
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = n => (n <= 10 ? WORDS[n] : String(n));
const list = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
// World Bank regions in prose.
const REGION_PROSE = {
  'Middle East, North Africa, Afghanistan & Pakistan': 'the Middle East and North Africa', 'East Asia & Pacific': 'East Asia and the Pacific',
  'Europe & Central Asia': 'Europe and Central Asia', 'Latin America & Caribbean': 'Latin America and the Caribbean',
  'North America': 'North America', 'South Asia': 'South Asia', 'Sub-Saharan Africa': 'Sub-Saharan Africa',
};
const regionProse = r => REGION_PROSE[r] ?? r;
// Dwelling types and risk flags in prose.
const TYPE_PROSE = { house: 'single-family houses', detached: 'detached houses', semi_detached: 'semi-detached houses', townhouse: 'townhouses', condo: 'condos and flats' };
const FLAG_PROSE = {
  PTI_HIGH: 'prices far above their income history', PTR_HIGH: 'prices far above their rent history', PRICES_HOT: 'rapid real price growth',
  CREDIT_GAP: 'a wide credit-to-GDP gap', RENT_OUTPACING: 'rents outpacing incomes', UNEMPLOYMENT_RISING: 'rising unemployment',
  WAGE_STAGNATION: 'stagnant real wages', MORTGAGE_STRESS: 'high mortgage stress', DEBT_SERVICE_HIGH: 'an elevated household debt service burden',
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// World Bank names that read awkwardly in prose.
const DISPLAY = {
  'Korea, Rep.': 'South Korea', 'Hong Kong SAR, China': 'Hong Kong', 'Russian Federation': 'Russia', 'Turkiye': 'Türkiye',
  'Egypt, Arab Rep.': 'Egypt', 'Iran, Islamic Rep.': 'Iran', 'Venezuela, RB': 'Venezuela', 'Slovak Republic': 'Slovakia',
  'Yemen, Rep.': 'Yemen', 'Macao SAR, China': 'Macao', 'Kyrgyz Republic': 'Kyrgyzstan', 'Lao PDR': 'Laos', 'Viet Nam': 'Vietnam',
  'Gambia, The': 'The Gambia', 'Bahamas, The': 'The Bahamas', 'Congo, Dem. Rep.': 'the Democratic Republic of the Congo', 'Congo, Rep.': 'the Republic of the Congo',
  'Micronesia, Fed. Sts.': 'Micronesia', 'St. Lucia': 'Saint Lucia', 'St. Kitts and Nevis': 'Saint Kitts and Nevis', 'St. Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
  'Syrian Arab Republic': 'Syria', 'Korea, Dem. People\'s Rep.': 'North Korea', 'Czechia': 'Czechia',
};
const NEEDS_THE = new Set(['United States', 'United Kingdom', 'Netherlands', 'United Arab Emirates', 'Philippines', 'Czech Republic', 'Dominican Republic', 'Central African Republic', 'Maldives', 'Marshall Islands', 'Solomon Islands', 'Comoros', 'Seychelles']);

export function names(raw) {
  const base = DISPLAY[raw] ?? raw;
  const the = NEEDS_THE.has(base);
  const subject = the ? `the ${base}` : base;
  const possessive = /s$/.test(base) ? `${subject}'` : `${subject}'s`;
  return { short: base, subject, Subject: cap(subject), possessive, Possessive: cap(possessive) };
}

// Short basis label for income-based ratios (the full basis strings carry years and are
// shown on the affordability tiles instead).
function incomeBasis(basis) {
  if (!basis) return null;
  if (/national statistics office|median household income/i.test(basis)) return 'national median household income';
  if (/OECD/i.test(basis)) return 'OECD household disposable income';
  if (/GDP/i.test(basis)) return 'a GDP-based income proxy';
  return 'household income';
}

const sentence = s => s.trim().replace(/\s+/g, ' ');
const para = parts => parts.filter(Boolean).map(sentence).join(' ');

// ── Headline ────────────────────────────────────────────────────────────────────
export function headline(input) {
  const n = names(input.name);
  if (input.tier !== 1 || !input.price) return `${n.short}: no official house price index, so the outlook rests on housing drivers`;
  const p10 = input.price.h10.median;
  const pti = input.affordability?.ptiVsHistory;
  const stress = input.stress?.score;
  const slump = (input.live?.events ?? []).find(e => e.class === 'transaction_slump' && e.applies);
  const rank = input.tier1?.priceRank, count = input.tier1?.count;
  if (slump && finite(slump.intensity)) return `${n.short}: a ${pctAbs(slump.intensity)} drop in registered sales clouds the outlook for prices`;
  if (input.stale) return `${n.short}: official prices end in ${input.originYear}, so the outlook starts from a dated base`;
  if (finite(pti) && pti > 20 && finite(stress) && stress >= 70) return `${n.short}: prices sit ${pctAbs(pti)} above their income history as mortgage stress builds`;
  if (finite(pti) && pti > 20) return `${n.short}: stretched valuations temper a ${pctAbs(p10)} ten-year real price outlook`;
  if (finite(rank) && finite(count) && rank <= Math.ceil(count / 4) && p10 > 0) return `${n.short}: among the strongest outlooks, with real prices projected ${rise(p10, 'up', 'down')} ${pctAbs(p10)} over ten years`;
  if (p10 < 5) return `${n.short}: little real price growth ahead over the next decade`;
  if (finite(pti) && pti <= 0) return `${n.short}: affordability near its long-run norm supports a ${pctAbs(p10)} real price outlook`;
  return `${n.short}: real prices projected ${rise(p10, 'up', 'down')} ${pctAbs(p10)} over ten years, ${p10 >= (input.tier1?.medianPrice10 ?? 0) ? 'above' : 'below'} the median market`;
}

// ── KPI strip ───────────────────────────────────────────────────────────────────
export function kpis(input) {
  const a = input.affordability ?? {};
  const sign = v => (v >= 0 ? '+' : '-') + f1(v) + '%';
  const out = [];
  if (input.price) out.push({ label: 'Real price, 10y', value: sign(input.price.h10.median), period: `${input.originYear} to ${input.originYear + 10}` });
  if (input.rent) out.push({ label: 'Real rent, 10y', value: sign(input.rent.h10.median), period: `${input.rentOriginYear} to ${input.rentOriginYear + 10}` });
  if (finite(a.ptiVsHistory)) out.push({ label: 'Price to income vs history', value: sign(a.ptiVsHistory), period: String(input.ptiYear ?? input.originYear) });
  if (finite(a.mortgageToIncome)) out.push({ label: 'Mortgage / income', value: `${f1(a.mortgageToIncome)}%`, period: 'at today\'s rate' });
  else if (finite(a.priceToIncome)) out.push({ label: 'Price / income', value: `${f1(a.priceToIncome)}x`, period: String(input.originYear) });
  if (finite(input.rates?.policy)) out.push({ label: 'Policy rate', value: `${f2(input.rates.policy)}%`, period: input.rates.policyAsOf ?? '' });
  if (finite(input.rates?.mortgage)) out.push({ label: 'Mortgage rate', value: `${f2(input.rates.mortgage)}%`, period: input.rates.mortgageIsProxy ? 'policy + spread' : (input.rates.mortgageAsOf ?? 'latest') });
  if (finite(a.unemployment)) out.push({ label: 'Unemployment', value: `${f1(a.unemployment)}%`, period: a.unemploymentAsOf ?? '' });
  if (finite(input.stress?.score)) out.push({ label: 'Mortgage stress', value: `${Math.round(input.stress.score)}/${input.stress.max}`, period: `rank ${input.stress.rank} of ${input.stress.count}` });
  if (input.tier !== 1) {
    for (const d of input.drivers ?? []) out.push({ label: d.label, value: d.display, period: d.period });
  }
  return out.slice(0, 8);
}

// ── Sections ────────────────────────────────────────────────────────────────────
function pricesSection(input, n) {
  const p = input.price, t = input.tier1 ?? {}, h = input.history?.price ?? {}, peers = input.peers;
  const p10 = p.h10.median;
  const open = `${n.Possessive} real house prices are projected to ${rise(p10)} ${b(pctAbs(p10))} over the next ten years, with an ${input.bandLevel}% range of ${p.h10.p10 >= 0 ? '' : 'minus '}${pctAbs(p.h10.p10)} to ${p.h10.p90 >= 0 ? '' : 'minus '}${pctAbs(p.h10.p90)}.`;
  const vsMedian = finite(t.medianPrice10)
    ? `That outlook is ${rankPhrase(t.priceRank, t.count, t.priceRankLow)} markets with official price data, ${p10 >= t.medianPrice10 ? 'ahead of' : 'behind'} the median market and its ${projected(t.medianPrice10).replace('a projected', 'projected')}.`
    : null;
  const peer = peers && peers.count >= 3 && finite(peers.medianPrice10)
    ? `Among ${count(peers.count)} peers in ${regionProse(peers.region)}, the median market faces ${projected(peers.medianPrice10)} over the same period.`
    : null;
  const hist = finite(h.change10)
    ? `Over the past decade real prices ${h.change10 >= 0 ? 'rose' : 'fell'} ${b(pctAbs(h.change10))}${finite(h.change5) ? `, and they ${h.change5 >= 0 ? 'gained' : 'lost'} ${pctAbs(h.change5)} over the last five years` : ''}${finite(h.belowPeak) && h.belowPeak > 1 && h.peakYear ? `, leaving them ${pctAbs(h.belowPeak)} below their ${h.peakYear} peak` : h.atPeak ? ', leaving them at a record high in real terms' : ''}.`
    : null;
  const first = para([open, vsMedian, peer, hist].slice(0, 4));

  const complications = [];
  if (input.stale) complications.push(`However, the official index for ${n.subject} ends in ${input.originYear}, so these projections start from a dated base and should be read as indicative.`);
  if (input.nowcast && finite(input.nowcast.changePct)) {
    const c = input.nowcast.changePct;
    complications.push(`${complications.length ? 'Moreover' : c < 0 ? 'However' : 'Moreover'}, the latest official reading for ${input.nowcast.quarter} sits ${pctAbs(c)} ${c < 0 ? 'below' : 'above'} the ${input.originYear} average, so the starting point has already ${c < 0 ? 'softened' : 'firmed'}.`);
  }
  const pti = input.affordability?.ptiVsHistory;
  if (finite(pti) && Math.abs(pti) >= 10) {
    complications.push(`${complications.length ? 'Moreover' : pti > 0 ? 'However' : 'Moreover'}, prices sit ${b(pctAbs(pti))} ${pti > 0 ? 'above' : 'below'} their long-run ratio to incomes, ${pti > 0 ? 'which leaves less room for gains that outpace earnings' : 'which gives buyers more room than the national averages suggest'}.`);
  }
  const sk = input.skill ?? {};
  if (sk.price10Method === 'baseline') complications.push(`At the ten-year horizon no model beat a simple baseline on years it never saw, so the path shown is that baseline rather than a forecast with demonstrated skill.`);
  else if (finite(sk.price10)) complications.push(`On years it never saw, the ten-year projection cut the error of a no-change rule by ${pctAbs(sk.price10)}, so the direction carries information even where the level is uncertain.`);
  const paragraphs = [first];
  if (complications.length >= 2) paragraphs.push(para(complications.slice(0, 4)));
  else if (complications.length === 1) paragraphs[0] = para([first, complications[0]]);
  return { id: 'prices', title: 'House prices', chart: 'price', paragraphs };
}

function rentsSection(input, n) {
  const r = input.rent, a = input.affordability ?? {}, t = input.tier1 ?? {};
  const parts = [];
  if (r) {
    const r10 = r.h10.median;
    parts.push(`Real rents in ${n.subject} are projected to ${rise(r10)} ${b(pctAbs(r10))} over ten years, against ${projected(t.medianRent10)} for the median of the ${t.rentCount} markets that publish a rent index.`);
    if (finite(input.history?.rent?.change10)) parts.push(`Over the past decade real rents ${input.history.rent.change10 >= 0 ? 'rose' : 'fell'} ${pctAbs(input.history.rent.change10)}${input.stale_rent ? `, although the official rent series ends in ${input.rentOriginYear}` : ''}.`);
  } else {
    parts.push(`${n.Subject} publishes no official rent index in the OECD dataset, so rents are not projected here.`);
  }
  const ptr = input.ptrVsHistory;
  if (finite(ptr) && Math.abs(ptr) >= 5) parts.push(`${parts.length > 1 ? 'However' : 'Moreover'}, prices sit ${b(pctAbs(ptr))} ${ptr > 0 ? 'above' : 'below'} their long-run ratio to rents, ${ptr > 0 ? 'which points to thin rental yields for investors and makes renting the better value for many households' : 'which keeps rental yields healthy and strengthens the case for ownership'}.`);
  const basis = incomeBasis(a.incomeBasis);
  if (finite(a.priceToIncome)) parts.push(`A typical home costs ${b(`${f1(a.priceToIncome)} times`)} household income${basis ? `, measured against ${basis}` : ''}${finite(a.mortgageToIncome) ? `, and a mortgage covering ${input.loanToValue}% of the price absorbs ${b(pctAbs(a.mortgageToIncome))} of that income` : ''}.`);
  if (finite(a.rentToIncome)) parts.push(`${finite(a.priceToIncome) ? 'Moreover, rent' : 'Rent'} takes ${b(pctAbs(a.rentToIncome))} of household income${!finite(a.priceToIncome) && basis ? `, measured against ${basis}` : ''}${a.rentToIncome > input.rentBurden ? `, above the ${input.rentBurden}% level usually treated as a burden` : ''}.`);
  if (parts.length < 2) return null;
  return { id: 'rents', title: 'Rents and affordability', chart: 'rent', paragraphs: [para(parts.slice(0, 5))] };
}

function ratesSection(input, n) {
  const r = input.rates;
  if (!r || !finite(r.policy)) return null;
  const parts = [];
  const d = r.delta;
  parts.push(`${n.Possessive} policy rate stands at ${b(`${f2(r.policy)}%`)}${r.policyAsOf ? ` (${r.policyAsOf})` : ''}${finite(d) && Math.abs(d) >= 0.05 ? `, ${f2(d)} percentage points ${d < 0 ? 'below' : 'above'} its ${r.originYear} average` : ''}${finite(r.mortgage) ? `, and the mortgage rate used here is ${b(`${f2(r.mortgage)}%`)}${r.mortgageSource && !r.mortgageIsProxy ? ` (${r.mortgageSource})` : ''}` : ''}.`);
  if (r.mortgageIsProxy) parts.push(`No national mortgage rate series is published openly, so that rate is the policy rate plus an assumed spread of ${r.spread.toFixed(1)} points.`);
  if (finite(d) && Math.abs(d) >= 0.25 && finite(r.liveShift10)) parts.push(`The ${d < 0 ? 'easing' : 'tightening'} already delivered ${d < 0 ? 'lifts' : 'trims'} the ten-year real price path by ${pctAbs(r.liveShift10)}, and that adjustment is included in the projections above.`);
  if (finite(r.sens3) && r.sensValid) {
    parts.push(`${parts.length > 1 ? 'Moreover' : 'However'}, on the estimates behind this page a sustained one point rise in rates would lower real prices by ${b(pctAbs(r.sens3))} over three years and ${pctAbs(r.sens10 ?? r.sens3)} over ten years${finite(r.rentSens10) && Math.abs(r.rentSens10) >= 0.05 ? `, while real rents would ${r.rentSens10 >= 0 ? 'rise' : 'fall'} ${pctAbs(r.rentSens10)} as would-be buyers ${r.rentSens10 >= 0 ? 'stay in the rental market' : 'return to ownership'}` : ''}.`);
    parts.push('The toggle beside this analysis applies that sensitivity to any rate path, and the figures update as it moves.');
  } else {
    parts.push('The rate effect on prices is switched off for this run because no horizon gave a clear, correctly signed estimate.');
  }
  return { id: 'rates', title: 'Interest rates and mortgages', chart: 'rates', paragraphs: [para(parts.slice(0, 5))] };
}

// Rewrites the rate paragraph for a toggled rate path. `shifted` carries the shifted
// medians: { price10, price3, rent10, basePrice10, basePrice3, baseRent10 } as % changes.
export function rewriteRateSection(input, deltaPp, shifted) {
  const n = names(input.name);
  const r = input.rates ?? {};
  if (!deltaPp || !finite(r.policy)) return null;
  const newRate = r.policy + deltaPp;
  const parts = [];
  parts.push(`At a policy rate ${f2(deltaPp)} points ${deltaPp > 0 ? 'higher' : 'lower'} than today, or ${b(`${f2(newRate)}%`)}${finite(r.mortgage) ? ` with mortgages at ${f2(r.mortgage + deltaPp)}%` : ''}, ${n.possessive} ten-year real price path would ${rise(shifted.price10, 'reach', 'fall to')} ${b(`${shifted.price10 >= 0 ? '' : 'minus '}${pctAbs(shifted.price10)}`)} instead of ${shifted.basePrice10 >= 0 ? '' : 'minus '}${pctAbs(shifted.basePrice10)}.`);
  if (finite(shifted.price3)) parts.push(`Over three years the change would be ${shifted.price3 >= 0 ? '' : 'minus '}${pctAbs(shifted.price3)}, against ${shifted.basePrice3 >= 0 ? '' : 'minus '}${pctAbs(shifted.basePrice3)} at current rates.`);
  if (finite(shifted.rent10) && finite(shifted.baseRent10)) parts.push(`${deltaPp > 0 ? 'However' : 'Moreover'}, real rents would move to ${shifted.rent10 >= 0 ? '' : 'minus '}${pctAbs(shifted.rent10)} over ten years from ${shifted.baseRent10 >= 0 ? '' : 'minus '}${pctAbs(shifted.baseRent10)}, as ${shifted.rent10 >= shifted.baseRent10 ? (deltaPp > 0 ? 'higher borrowing costs keep more households renting' : 'stronger demand across the market lifts rents') : (deltaPp > 0 ? 'weaker demand across the market eases rents' : 'cheaper credit draws renters into ownership')}.`);
  parts.push(deltaPp > 0 ? 'Unless incomes rise to absorb the higher payments, a move of this size would weigh on demand from first-time buyers.' : 'Cuts of this size would support demand, although they would also make it harder for affordability to improve.');
  return [para(parts)];
}

function labourSection(input, n) {
  const a = input.affordability ?? {}, s = input.stress;
  const parts = [];
  if (finite(a.unemployment)) parts.push(`Unemployment in ${n.subject} stands at ${b(`${f1(a.unemployment)}%`)}${a.unemploymentAsOf ? ` (${a.unemploymentAsOf})` : ''}${finite(a.unemploymentChange12m) && Math.abs(a.unemploymentChange12m) >= 0.05 ? `, ${a.unemploymentChange12m > 0 ? 'up' : 'down'} ${f1(a.unemploymentChange12m)} points over twelve months` : ''}${a.unemploymentRising ? ', enough to trip the rising-unemployment trigger used in this analysis' : ''}.`);
  if (finite(a.realWageGrowth3y)) parts.push(`${a.wageStagnation ? 'However, real' : 'Real'} wages have grown ${b(`${a.realWageGrowth3y < 0 ? 'minus ' : ''}${pctAbs(a.realWageGrowth3y)}`)} a year over the past three years${a.wageStagnation ? ', which leaves household incomes struggling to keep pace with housing costs' : ', which helps households carry their housing costs'}.`);
  if (finite(a.hhDebt)) parts.push(`${parts.length >= 2 ? 'Moreover, household' : 'Household'} debt equals ${b(`${Math.round(a.hhDebt)}% of GDP`)}${finite(a.debtService) ? `, and servicing it takes ${pctAbs(a.debtService)} of disposable income${finite(a.debtServiceGap) ? `, ${f1(a.debtServiceGap)} points ${a.debtServiceGap >= 0 ? 'above' : 'below'} its ${input.debtServiceWindow}-year average` : ''}` : ''}.`);
  if (s && finite(s.score)) parts.push(`Taken together, the mortgage stress index scores ${b(`${Math.round(s.score)} out of ${s.max}`)}, ${rankPhrase(s.rank, s.count, s.rankLow)} markets with enough data${s.score >= 75 ? ', a level that warrants close monitoring' : s.score <= 40 ? ', comfortably below the middle of the range' : ''}.`);
  if (parts.length < 2) return null;
  return { id: 'labour', title: 'Labour market and household balance sheets', chart: 'labour', paragraphs: [para(parts.slice(0, 5))] };
}

function typesSection(input, n) {
  const types = (input.types ?? []).filter(t => finite(t.h10)).map(t => ({ ...t, label: TYPE_PROSE[t.type] ?? t.label }));
  const cities = input.cities;
  if (!types.length && !(cities && cities.count)) return null;
  const parts = [];
  if (types.length >= 2) {
    const sorted = [...types].sort((x, y) => y.h10 - x.h10);
    const best = sorted[0], worst = sorted.at(-1);
    if (Math.abs(best.h10 - worst.h10) < 0.5) parts.push(`By dwelling type, ${list(types.map(t => t.label))} in ${n.subject} share a ten-year real price outlook of ${b(`${best.h10 < 0 ? 'minus ' : ''}${pctAbs(best.h10)}`)}, so the segments are expected to move together.`);
    else parts.push(`By dwelling type, ${best.label} carry the strongest ten-year outlook in ${n.subject} at ${b(`${best.h10 < 0 ? 'minus ' : ''}${pctAbs(best.h10)}`)} in real terms, against ${worst.h10 < 0 ? 'minus ' : ''}${pctAbs(worst.h10)} for ${worst.label}.`);
    const withPast = types.filter(t => finite(t.last5));
    if (withPast.length >= 2) {
      const pb = [...withPast].sort((x, y) => y.last5 - x.last5);
      parts.push(`Over the last five years ${pb[0].label} ${pb[0].last5 >= 0 ? 'gained' : 'lost'} ${pctAbs(pb[0].last5)} while ${pb.at(-1).label} ${pb.at(-1).last5 >= 0 ? 'gained' : 'lost'} ${pctAbs(pb.at(-1).last5)}, so the gap between segments ${Math.abs(best.h10 - worst.h10) < 0.5 ? 'is projected to close' : Math.sign(pb[0].last5 - pb.at(-1).last5) === Math.sign(best.h10 - worst.h10) ? 'is projected to persist' : 'is projected to narrow'}.`);
    }
  } else if (types.length === 1) {
    parts.push(`Prices for ${types[0].label} in ${n.subject} are projected to ${rise(types[0].h10)} ${b(pctAbs(types[0].h10))} in real terms over ten years.`);
  }
  if (cities && cities.count) {
    parts.push(`${parts.length ? 'Moreover, national' : 'National'} agencies publish data for ${count(cities.count)} ${cities.count === 1 ? 'city or region' : 'cities and regions'}${cities.rent ? `, where the average two-bedroom rent ranges from ${cities.rent.min.toLocaleString('en')} in ${cities.rent.minCity} to ${cities.rent.max.toLocaleString('en')} in ${cities.rent.maxCity} in local currency` : ''}.`);
    if (cities.vacancy) parts.push(`Rental vacancy runs at ${pctAbs(cities.vacancy.value)} across the main metros (${cities.vacancy.period}), ${cities.vacancy.value < 3 ? 'a tight market that keeps upward pressure on rents' : 'enough slack to temper rent growth'}.`);
  }
  if (parts.length < 2) return null;
  return { id: 'types', title: 'Dwelling types and cities', chart: 'types', paragraphs: [para(parts.slice(0, 5))] };
}

function liveSection(input, n) {
  const events = input.live?.events ?? [];
  if (!events.length) return null;
  const parts = [];
  for (const e of events.slice(0, 3)) {
    if (e.class === 'transaction_slump') {
      parts.push(`Registered sales${e.region ? ` in ${e.region}` : ''} fell ${b(pctAbs(e.intensity))} on a year earlier over the latest three months, the kind of drop that past episodes in other markets followed with weaker prices.`);
      if (e.applies && finite(e.effect3)) parts.push(`Based on ${e.episodes} past episodes, the typical effect is ${pctAbs(e.effect3)} on real prices over three years relative to what the model expected, and that adjustment is included above.`);
      else parts.push('Past episodes show no clear effect beyond what the model already expects, so it is shown here without an adjustment.');
    } else {
      const label = e.label.toLowerCase();
      if (e.applies && finite(e.effect3) && e.clear) parts.push(`A ${label} detected on ${e.onset} carries a typical effect of ${pctAbs(e.effect3)} on real prices over three years across ${e.episodes} past episodes, and that adjustment is included above.`);
      else if (e.class === 'natural_disaster' && !e.applies) parts.push(`A natural disaster alert has been active since ${e.onset}, and it is noted without an adjustment because only the most severe alerts move national price paths.`);
      else parts.push(`A ${label} has been active since ${e.onset}${e.applies ? ', but past episodes of its kind show no clear effect on prices, so it is noted without an adjustment' : ', and because it is already reflected in the data the model trained on, it carries no extra adjustment'}.`);
    }
  }
  if (parts.length < 2) parts.push('The live layer refreshes daily and records every change on the live page.');
  return { id: 'live', title: 'Live developments', chart: 'live', paragraphs: [para(parts.slice(0, 5))] };
}

function outlookSection(input, n) {
  const s = input.signals ?? {};
  const a = input.affordability ?? {};
  const first = [];
  const lab = k => (s[k] ? `“${s[k].label}”` : null);
  if (s.buyer && s.seller) first.push(`On balance, the market signal for ${n.subject} reads ${b(lab('buyer'))} for buyers and ${b(lab('seller'))} for sellers${s.investor ? `, with ${lab('investor')} for investors` : ''}${s.renter ? ` and ${lab('renter')} for renters` : ''}.`);
  const reason = s.buyer?.support?.[0];
  if (reason) first.push(`The buyer signal rests above all on one point: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
  const counter = s.buyer?.oppose?.[0];
  if (counter) first.push(`However, one factor points the other way, which argues against reading the signal as permanent: ${counter.charAt(0).toLowerCase()}${counter.slice(1)}.`);
  const fl = (input.flagIds ?? []).map(id => FLAG_PROSE[id]).filter(Boolean);
  if (fl.length) first.push(`${cap(count(fl.length))} risk ${fl.length === 1 ? 'flag is' : 'flags are'} active, covering ${list(fl.slice(0, 3))}${fl.length > 3 ? ' among others' : ''}.`);

  const risks = [];
  const stressHigh = finite(input.stress?.score) && input.stress.score >= 60;
  const pti = a.ptiVsHistory;
  if (a.unemploymentRising || (stressHigh && a.wageStagnation)) risks.push(`Unless unemployment stabilises and real wages recover, ${n.subject} will struggle to keep mortgage payments within reach of household incomes.`);
  else if (finite(pti) && pti > 20) risks.push(`Unless incomes catch up with prices, ${n.subject} will struggle to sustain gains of this size without a long period of flat real prices.`);
  else if (input.price && input.price.h10.median < 5) risks.push(`Unless credit conditions ease further, ${n.subject} will struggle to restore meaningful real price growth.`);
  else if (input.rent && input.rent.h10.median > (input.tier1?.medianRent10 ?? 0)) risks.push(`Unless rental supply keeps pace with household formation, ${n.subject} will struggle to stop rents from rising faster than in the median market.`);
  else risks.push(`Unless household incomes grow faster than housing costs, ${n.subject} will struggle to improve affordability from current levels.`);
  if (input.stale) risks.push(`Moreover, the dated official index means the first priority is better data: statistics authorities should publish a timely, national house price series.`);
  const pres = [];
  if (finite(pti) && pti > 20) pres.push(`Policy makers need to expand housing supply faster than demand if affordability is to improve, and lenders should keep stress testing borrowers against rates well above today's.`);
  else if (stressHigh) pres.push(`Lenders and supervisors will need to watch arrears closely, and governments should target support at stretched first-time buyers rather than adding to demand across the board.`);
  else if (input.rent && input.rent.h10.median > (input.tier1?.medianRent10 ?? 0)) pres.push(`Governments need to prioritise rental supply, because rents projected to outpace the median market will otherwise squeeze the households least able to buy.`);
  else pres.push(`Buyers and investors should treat the ten-year range, not the central path, as the planning case, and policy makers need to keep supply responsive so that any recovery in demand does not tip into overvaluation.`);
  return { id: 'outlook', title: 'Outlook and key risks', chart: 'signals', paragraphs: [para(first.slice(0, 4)), para([...risks, ...pres].slice(0, 4))].filter(Boolean) };
}

function driversNarrative(input, n) {
  const d = Object.fromEntries((input.drivers ?? []).map(x => [x.key, x]));
  const parts = [];
  parts.push(`${n.Subject} publishes no official house price index in the BIS or OECD datasets, so this page does not project prices or rents and invents no numbers to fill the gap.`);
  if (d.POP_GROWTH) parts.push(`Housing demand starts with people: the population grew ${b(pctAbs(d.POP_GROWTH.value))} in ${d.POP_GROWTH.period}${d.URBAN_GROWTH ? `, and the urban population ${d.URBAN_GROWTH.value >= 0 ? 'grew' : 'shrank'} ${pctAbs(d.URBAN_GROWTH.value)}` : ''}.`);
  if (d.INFLATION) parts.push(`Consumer prices rose ${pctAbs(d.INFLATION.value)} in ${d.INFLATION.period}${d.LENDING_RATE ? `, and the average bank lending rate stood at ${pctAbs(d.LENDING_RATE.value)} (${d.LENDING_RATE.period})` : ''}.`);
  if (d.PRIVATE_CREDIT) parts.push(`${parts.length > 2 ? 'Moreover, domestic' : 'Domestic'} credit to the private sector equals ${b(`${Math.round(d.PRIVATE_CREDIT.value)}% of GDP`)} (${d.PRIVATE_CREDIT.period}), a guide to how much mortgage lending the financial system can support.`);
  const sections = [{ id: 'drivers', title: 'Housing drivers', chart: 'drivers', paragraphs: [para(parts.slice(0, 5))] }];
  sections.push({ id: 'outlook', title: 'Outlook and key risks', chart: null, paragraphs: [para([
    `Without an official price index, the clearest signals for ${n.subject} come from these drivers rather than from prices themselves.`,
    `Unless a national statistics office or central bank publishes a regular house price series, buyers and lenders in ${n.subject} will struggle to judge whether prices are running ahead of incomes.`,
    'Statistics authorities should prioritise that series, because it is the precondition for any credible outlook.',
  ])] });
  return sections;
}

export function buildCountryNarrative(input) {
  const n = names(input.name);
  if (input.tier !== 1 || !input.price) {
    return { headline: headline(input), kpis: kpis(input), sections: driversNarrative(input, n) };
  }
  const sections = [pricesSection(input, n), rentsSection(input, n), ratesSection(input, n), labourSection(input, n), typesSection(input, n), liveSection(input, n), outlookSection(input, n)].filter(Boolean);
  return { headline: headline(input), kpis: kpis(input), sections };
}

// Splits a paragraph with **bold** markers into text runs (for the UI and for checks).
export function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(t => (t.startsWith('**') ? { bold: true, text: t.slice(2, -2) } : { bold: false, text: t }));
}
export const plain = text => text.replace(/\*\*/g, '');
