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
const TYPE_PROSE = { house: 'single-family houses', detached: 'detached houses', semi_detached: 'semi-detached houses', townhouse: 'townhouses', condo: 'condos' };
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
  return null;
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
  return `${n.short}: real prices projected ${rise(p10, 'up', 'down')} ${pctAbs(p10)} over ten years, ${Math.abs(p10 - (input.tier1?.medianPrice10 ?? 0)) < 0.05 ? 'in line with' : p10 > (input.tier1?.medianPrice10 ?? 0) ? 'above' : 'below'} the median market`;
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
  const open = `${n.Possessive} real house prices are projected to ${rise(p10)} ${b(pctAbs(p10))} over the next ten years, with an ${input.bandLevel}% range from ${projected(p.h10.p10).replace('a projected ', 'a ')} to ${projected(p.h10.p90).replace('a projected ', 'a ')}.`;
  const vsMedian = finite(t.medianPrice10)
    ? `That outlook is ${rankPhrase(t.priceRank, t.count, t.priceRankLow)} markets with official price data, ${Math.abs(p10 - t.medianPrice10) < 0.05 ? 'in line with' : p10 > t.medianPrice10 ? 'ahead of' : 'behind'} the median market and its ${projected(t.medianPrice10).replace('a projected', 'projected')}.`
    : null;
  const peer = peers && peers.count >= 3 && finite(peers.medianPrice10)
    ? `Among ${count(peers.count)} peers in ${regionProse(peers.region)}, the median market faces ${projected(peers.medianPrice10)} over the same period.`
    : null;
  const hist = finite(h.change10)
    ? `Over the past decade real prices ${h.change10 >= 0 ? 'rose' : 'fell'} ${b(pctAbs(h.change10))}${finite(h.change5) ? `, and they ${h.change5 >= 0 ? 'gained' : 'lost'} ${pctAbs(h.change5)} over the last five years` : ''}${finite(h.belowPeak) && h.belowPeak > 1 && h.peakYear ? `, leaving them ${pctAbs(h.belowPeak)} below their ${h.peakYear} peak` : h.atPeak ? ', leaving them at a record high in real terms' : ''}.`
    : null;
  const phases = phaseSentence(input.history?.phases ?? []);
  const nominal = input.nominal && finite(input.nominal.price10)
    ? `In nominal terms, with inflation averaging ${pctAbs(input.nominal.inflAvg)} a year on IMF projections (the last projected year carried forward), the central path implies prices about ${b(pctAbs(input.nominal.price10))} ${input.nominal.price10 >= 0 ? 'higher' : 'lower'} by ${input.originYear + 10}.`
    : null;
  const first = para([open, vsMedian, peer, phases ?? hist, nominal].filter(Boolean));

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
  const data = notesFor(input, ['data']);
  if (data.text) paragraphs.push(data.text);
  return { id: 'prices', title: 'House prices', chart: 'price', paragraphs, sources: data.sources };
}

function rentsSection(input, n) {
  const r = input.rent, a = input.affordability ?? {}, t = input.tier1 ?? {};
  const parts = [];
  if (r) {
    const r10 = r.h10.median;
    parts.push(`Real rents in ${n.subject} are projected to ${Math.abs(r10) < 0.05 ? 'hold roughly flat' : `${rise(r10)} ${b(pctAbs(r10))}`} over ten years, against ${projected(t.medianRent10)} for the median of the ${t.rentCount} markets that publish a rent index.`);
    if (finite(input.history?.rent?.change10)) parts.push(`Over the past decade real rents ${input.history.rent.change10 >= 0 ? 'rose' : 'fell'} ${pctAbs(input.history.rent.change10)}${input.stale_rent ? `, although the official rent series ends in ${input.rentOriginYear}` : ''}.`);
  } else {
    parts.push(`${n.Subject} publishes no official rent index in the OECD dataset, so rents are not projected here.`);
  }
  const ptr = input.ptrVsHistory;
  if (finite(ptr) && Math.abs(ptr) >= 5) parts.push(`${parts.length > 1 ? 'However' : 'Moreover'}, prices sit ${b(pctAbs(ptr))} ${ptr > 0 ? 'above' : 'below'} their long-run ratio to rents, ${ptr > 0 ? 'which points to thin rental yields for investors and makes renting the better value for many households' : 'which keeps rental yields healthy and strengthens the case for ownership'}.`);
  const basis = incomeBasis(a.incomeBasis);
  if (finite(a.priceToIncome)) parts.push(`A typical home costs ${b(`${f1(a.priceToIncome)} times`)} household income${basis ? `, measured against ${basis}` : ''}${finite(a.mortgageToIncome) ? `, and a mortgage covering ${input.loanToValue}% of the price absorbs ${b(pctAbs(a.mortgageToIncome))} of that income` : ''}.`);
  if (finite(a.rentToIncome)) parts.push(`${finite(a.priceToIncome) ? 'Moreover, rent' : 'Rent'} takes ${b(pctAbs(a.rentToIncome))} of household income${!finite(a.priceToIncome) && basis ? `, measured against ${basis}` : ''}${a.rentToIncome > input.rentBurden ? `, above the ${input.rentBurden}% level usually treated as a burden` : ''}.`);
  const rd = input.drivers?.rent10;
  const top = rd?.features?.find(f => Math.abs(f.contribution) >= 0.5 && FEATURE_PROSE[f.name]);
  if (r && top) parts.push(`The largest single influence on that rent path is ${featureWhat(top, 'rent', input.rentOriginYear)}, against ${featureTypical(top, 'rent')}, which ${top.contribution >= 0 ? 'adds' : 'takes'} about ${pts(top.contribution)}${top.contribution >= 0 ? '' : ' off'}.`);
  const notes = notesFor(input, ['rental'], ['supports_rents', 'restrains_rents']);
  if (parts.length < 2 && !notes.text) return null;
  const paragraphs = [para(parts.slice(0, 6))];
  if (notes.text) paragraphs.push(notes.text);
  return { id: 'rents', title: 'Rents and affordability', chart: 'rent', paragraphs, sources: notes.sources };
}

function ratesSection(input, n) {
  const r = input.rates;
  if (!r || !finite(r.policy)) return null;
  const parts = [];
  const d = r.delta;
  const bank = CENTRAL_BANK[input.iso3] ?? null;
  const mv = r.lastMove;
  if (mv && finite(mv.size) && Math.abs(mv.size) >= 0.05) {
    parts.push(`${bank ? (NO_ARTICLE.has(bank) ? bank : `The ${bank}`) : `${n.Possessive} central bank`} ${mv.size > 0 ? 'raised' : 'cut'} its policy rate by ${f2(mv.size)} points to ${b(`${f2(r.policy)}%`)}${r.policyAsOf ? ` (latest reading ${r.policyAsOf})` : ''}, from ${f2(mv.from)}%${mv.since ? ` in ${mv.since}` : ''}.`);
  } else {
    parts.push(`${n.Possessive} policy rate stands at ${b(`${f2(r.policy)}%`)}${r.policyAsOf ? ` (${r.policyAsOf})` : ''}.`);
  }
  if (finite(d) && Math.abs(d) >= 0.05) {
    const against = mv && Math.sign(mv.size) !== Math.sign(d) && Math.abs(mv.size) >= 0.05;
    parts.push(`${against ? `Even after that ${mv.size > 0 ? 'increase' : 'cut'}, the` : 'The'} rate sits ${f2(d)} points ${d < 0 ? 'below' : 'above'} its ${r.originYear} average, the year the projections start from${finite(r.liveShift10) && Math.abs(d) >= 0.25 ? `, and that net ${d < 0 ? 'easing' : 'tightening'} ${d < 0 ? 'lifts' : 'trims'} the ten-year real price path by ${pctAbs(r.liveShift10)}, an adjustment already included above` : ''}.`);
  }
  if (finite(r.mortgage)) parts.push(r.mortgageIsProxy
    ? `No national mortgage rate series is published openly, so the mortgage rate used here, ${b(`${f2(r.mortgage)}%`)}, is the policy rate plus an assumed spread of ${r.spread.toFixed(1)} points.`
    : `The mortgage rate used here is ${b(`${f2(r.mortgage)}%`)}${r.mortgageSource ? ` (${r.mortgageSource})` : ''}.`);
  if (finite(r.sens3) && r.sensValid) {
    const rentBit = input.rent && finite(r.rentSens10) && Math.abs(r.rentSens10) >= 0.05
      ? `, while real rents would ${r.rentSens10 >= 0 ? 'rise' : 'fall'} ${pctAbs(r.rentSens10)}${r.rentSens10 >= 0 ? ', as higher borrowing costs keep would-be buyers renting for longer' : ', a pattern typical of heavily indebted markets, where higher repayments squeeze household budgets and rental demand alike'}`
      : '';
    parts.push(`Moreover, on the estimates behind this page a sustained one point rise in rates would lower real prices by ${b(pctAbs(r.sens3))} over three years and ${pctAbs(r.sens10 ?? r.sens3)} over ten years${rentBit}.`);
    parts.push('The toggle beside this analysis applies that sensitivity to any rate path, and the figures update as it moves.');
  } else {
    parts.push('The rate effect on prices is switched off for this run because no horizon gave a clear, correctly signed estimate.');
  }
  const notes = notesFor(input, ['mortgage_market', 'macroprudential']);
  const transmission = transmissionSentence(input, notes.effects);
  const paragraphs = [para(parts.slice(0, 6))];
  if (notes.text) paragraphs.push(para([notes.text, transmission]));
  return { id: 'rates', title: 'Interest rates and mortgages', chart: 'rates', paragraphs, sources: notes.sources };
}

// How the mortgage structure bears on the rate estimate above, from the notes' tagged effects.
function transmissionSentence(input, effects) {
  const up = effects.filter(e => e === 'raises_rate_sensitivity').length, down = effects.filter(e => e === 'lowers_rate_sensitivity').length;
  if (!input.rates?.sensValid || up === down) return null;
  return up > down
    ? 'That structure exposes borrowers to rate changes at each reset, more than in markets dominated by long fixed-rate loans, so the pooled sensitivity above is, if anything, a conservative guide for this market.'
    : 'That structure delays the pass-through of rate changes to existing borrowers, so the pooled sensitivity above is likely to play out more slowly here than in markets where most loans reset quickly.';
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
  if (finite(a.realWageGrowth3y)) parts.push(`${a.wageStagnation ? 'However, real' : 'Real'} wages have ${a.realWageGrowth3y < 0 ? 'fallen' : 'grown'} ${b(pctAbs(a.realWageGrowth3y))} a year over the past three years${a.wageStagnation ? ', which leaves household incomes struggling to keep pace with housing costs' : ', which helps households carry their housing costs'}.`);
  if (finite(a.hhDebt)) parts.push(`${parts.length >= 2 ? 'Moreover, household' : 'Household'} debt equals ${b(`${Math.round(a.hhDebt)}% of GDP`)}${finite(a.debtService) ? `, and servicing it takes ${pctAbs(a.debtService)} of disposable income${finite(a.debtServiceGap) ? `, ${f1(a.debtServiceGap)} points ${a.debtServiceGap >= 0 ? 'above' : 'below'} its ${input.debtServiceWindow}-year average` : ''}` : ''}.`);
  if (s && finite(s.score)) parts.push(`Taken together, the mortgage stress index scores ${b(`${Math.round(s.score)} out of ${s.max}`)}, ${rankPhrase(s.rank, s.count, s.rankLow)} markets with enough data${s.score >= 75 ? ', a level that warrants close monitoring' : s.score <= 40 ? ', comfortably below the middle of the range' : ''}.`);
  if (parts.length < 2) return null;
  return { id: 'labour', title: 'Labour market and household balance sheets', chart: 'labour', paragraphs: [para(parts.slice(0, 5))] };
}

function typesSection(input, n) {
  const types = (input.types ?? []).filter(t => finite(t.h10)).map(t => ({ ...t, label: TYPE_PROSE[t.type] ?? t.label }));
  const cities = input.cities;
  if (!types.length && !(cities && cities.count) && !input.cityPrices) return null;
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
  const cp = input.cityPrices;
  if (cp && cp.list.length >= 2) {
    const sorted = [...cp.list].sort((x, y) => y.change5y - x.change5y);
    const hi = sorted[0], lo = sorted.at(-1);
    const nat = finite(cp.national5) ? `, against ${cp.national5 >= 0 ? '' : 'minus '}${pctAbs(cp.national5)} for the national index` : '';
    parts.push(sorted.length === 2
      ? `${parts.length ? 'Moreover, at' : 'At'} city level, prices ${hi.change5y >= 0 ? 'rose' : 'fell'} ${b(pctAbs(hi.change5y))} in ${hi.name} and ${lo.change5y >= 0 ? 'rose' : 'fell'} ${pctAbs(lo.change5y)} in ${lo.name} over the five years to ${hi.period}, in nominal terms${nat}.`
      : `${parts.length ? 'Moreover, across' : 'Across'} the ${count(sorted.length)} cities and regions with price data, nominal prices over the past five years ${hi.change5y >= 0 ? 'rose most' : 'fell least'} in ${hi.name} (${pctAbs(hi.change5y)}) and ${lo.change5y >= 0 ? 'rose least' : 'fell most'} in ${lo.name} (${pctAbs(lo.change5y)})${nat}.`);
    const spread = hi.change5y - lo.change5y;
    if (sorted.length >= 2 && spread >= 10) parts.push(`A gap of ${f1(spread)} points between the strongest and weakest markets is a reminder that the national path averages over very different local conditions.`);
  }
  if (cities && cities.count && (cities.rent || cities.vacancy || !cp)) {
    parts.push(`${parts.length ? 'Moreover, national' : 'National'} statistics cover ${count(cities.count)} ${cities.count === 1 ? 'city or region' : 'cities and regions'}${cities.rent ? `, where the average two-bedroom rent ranges from ${money(input.iso3, cities.rent.min)} in ${cities.rent.minCity} to ${money(input.iso3, cities.rent.max)} in ${cities.rent.maxCity} a month` : ''}.`);
    if (cities.vacancy) parts.push(`Rental vacancy runs at ${pctAbs(cities.vacancy.value)} across the main metros (${cities.vacancy.period}), ${cities.vacancy.value < 3 ? 'a tight market that keeps upward pressure on rents' : 'enough slack to temper rent growth'}.`);
  }
  if (parts.length < 2) return null;
  return { id: 'types', title: 'Dwelling types and cities', chart: 'types', paragraphs: [para(parts.slice(0, 6))] };
}

function liveSection(input, n) {
  const events = input.live?.events ?? [];
  if (!events.length) return null;
  const parts = [];
  for (const e of events.slice(0, 3)) {
    if (e.class === 'transaction_slump') {
      parts.push(`Registered sales${e.region ? ` in ${e.region}` : ''} fell ${b(pctAbs(e.intensity))} on a year earlier over the latest three months, the kind of drop that past episodes in other markets followed with weaker prices.`);
      if (e.applies && finite(e.effect3)) parts.push(`Based on ${count(e.episodes)} past episodes, the typical effect is ${e.effect3 < 0 ? 'a fall' : 'a rise'} of ${pctAbs(e.effect3)} in real prices over three years relative to what the model expected, and that adjustment is included above.`);
      else parts.push('Past episodes show no clear effect beyond what the model already expects, so it is shown here without an adjustment.');
    } else {
      const label = e.label.toLowerCase();
      if (e.applies && finite(e.effect3) && e.clear) parts.push(`A ${label} detected on ${e.onset} carries a typical ${e.effect3 < 0 ? 'fall' : 'rise'} of ${pctAbs(e.effect3)} in real prices over three years across ${count(e.episodes)} past episodes, and that adjustment is included above.`);
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
  else if ((input.live?.events ?? []).some(e => e.class === 'transaction_slump' && e.applies)) risks.push(`Unless registered sales recover from their recent slump, ${n.subject} will struggle to restore meaningful real price growth.`);
  else if (input.price && input.price.h10.median < 5 && finite(input.rates?.delta) && input.rates.delta < 0) risks.push(`Unless demand responds to the easing already delivered, ${n.subject} will struggle to restore meaningful real price growth.`);
  else if (input.price && input.price.h10.median < 5) risks.push(`Unless credit conditions ease, ${n.subject} will struggle to restore meaningful real price growth.`);
  else if (input.rent && input.rent.h10.median > (input.tier1?.medianRent10 ?? 0)) risks.push(`Unless rental supply keeps pace with household formation, ${n.subject} will struggle to stop rents from rising faster than in the median market.`);
  else risks.push(`Unless household incomes grow faster than housing costs, ${n.subject} will struggle to improve affordability from current levels.`);
  const tally = structuralTally(input);
  if (tally) risks.push(tally);
  if (input.stale) risks.push(`Moreover, the dated official index means the first priority is better data: statistics authorities should publish a timely, national house price series.`);
  const pres = [];
  if (finite(pti) && pti > 20) pres.push(`Policy makers need to expand housing supply faster than demand if affordability is to improve, and lenders should keep stress testing borrowers against rates well above today's.`);
  else if (stressHigh) pres.push(`Lenders and supervisors will need to watch arrears closely, and governments should target support at stretched first-time buyers rather than adding to demand across the board.`);
  else if (input.rent && input.rent.h10.median > (input.tier1?.medianRent10 ?? 0)) pres.push(`Governments need to prioritise rental supply, because rents projected to outpace the median market will otherwise squeeze the households least able to buy.`);
  else pres.push(`Buyers and investors should treat the ten-year range, not the central path, as the planning case, and policy makers need to keep supply responsive so that any recovery in demand does not tip into overvaluation.`);
  return { id: 'outlook', title: 'Outlook and key risks', chart: 'signals', paragraphs: [para(first.slice(0, 4)), para([...risks, ...pres].slice(0, 5))].filter(Boolean) };
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

// Currency symbols for local-currency levels quoted in prose; unknown codes fall back to a plain number with the ISO code.
const CURRENCY = { CAN: 'C$', USA: 'US$', GBR: '£', AUS: 'A$', NZL: 'NZ$', ARE: 'AED ', IRL: '€', FRA: '€', ESP: '€', NLD: '€', DEU: '€', ITA: '€', PRT: '€', BEL: '€', AUT: '€', FIN: '€', SWE: 'SEK ', NOR: 'NOK ', IND: '₹', JPN: '¥', BRA: 'R$' };
const money = (iso3, v) => `${CURRENCY[iso3] ?? ''}${Math.round(v).toLocaleString('en')}${CURRENCY[iso3] ? '' : ' in local currency'}`;


// ── Price history in phases ─────────────────────────────────────────────────────
// legs: [{ from, to, real, nominal }] from the zigzag in the input builder (8% reversals).
function phaseSentence(legs) {
  if (!legs.length) return null;
  const move = l => (l.real >= 0 ? (l.real >= 90 && l.real < 100 ? 'nearly doubled' : `rose ${pctAbs(l.real)}`) : `fell ${pctAbs(l.real)}`);
  const why = l => (l.real < 0 && finite(l.nominal) && l.nominal > 0 ? ` even though nominal prices rose ${pctAbs(l.nominal)}, because consumer prices rose faster` : '');
  if (legs.length === 1) return `Over the period with official data, real prices ${move(legs[0])} between ${legs[0].from} and ${legs[0].to}${why(legs[0])}.`;
  const last = legs.at(-1), earlier = legs.slice(0, -1);
  const lead = `Over the last full cycle, real prices ${earlier.map((l, i) => `${i ? 'then ' : ''}${move(l)} ${i ? `by ${l.to}` : `between ${l.from} and ${l.to}`}${why(l)}`).join(', ')}.`;
  const tail = `Since ${last.from} they have ${last.real >= 0 ? 'risen' : 'fallen'} ${pctAbs(last.real)}${why(last)}.`;
  return `${lead} ${tail}`;
}

// ── Country notes ───────────────────────────────────────────────────────────────
// Curated notes (each with sources) by topic, or by tagged effect. Each note is used once per page.
function notesFor(input, topics, effects = []) {
  const used = input._usedNotes ?? new Set();
  const picked = (input.notes?.notes ?? []).map((nt, i) => ({ ...nt, i })).filter(nt => !used.has(nt.i) && (topics.includes(nt.topic) || effects.includes(nt.effect)));
  for (const nt of picked) used.add(nt.i);
  const sources = [];
  for (const nt of picked) for (const src of nt.sources ?? []) if (!sources.some(x => x.url === src.url)) sources.push(src);
  return { text: picked.length ? para(picked.map(nt => nt.text)) : null, sources, effects: picked.map(nt => nt.effect) };
}

// Market structure and policy: the notes not already woven into an earlier section.
function contextSection(input, n) {
  const notes = notesFor(input, ['policy', 'supply', 'demand', 'macroprudential', 'mortgage_market', 'rental', 'data']);
  if (!notes.text) return null;
  return { id: 'context', title: 'Market structure and policy', chart: null, paragraphs: [notes.text], sources: notes.sources };
}

// One sentence weighing the structural notes against the projection.
function structuralTally(input) {
  const all = input.notes?.notes ?? [];
  const sup = all.filter(nt => nt.effect === 'supports_prices').length, res = all.filter(nt => nt.effect === 'restrains_prices').length;
  if (!sup && !res) return null;
  const p10 = input.price?.h10?.median;
  if (sup > res) return `Moreover, the structural features described above lean toward support, ${count(sup)} of them working for prices against ${count(res)} working against, which ${finite(p10) && p10 < (input.tier1?.medianPrice10 ?? 0) ? 'suggests the risk to a below-median projection runs to the upside' : 'reinforces the projected gains rather than threatening them'}.`;
  if (res > sup) return `Moreover, the structural features described above lean toward restraint, ${count(res)} of them working against prices and ${count(sup)} for them, which ${finite(p10) && p10 > (input.tier1?.medianPrice10 ?? 0) ? 'argues for treating an above-median projection with caution' : 'is consistent with the subdued projection'}.`;
  return `The structural features described above are evenly balanced, ${count(sup)} working for prices and ${count(res)} against, so the projection rests mainly on the cyclical drivers.`;
}

// ── What drives the projection ──────────────────────────────────────────────────
// Prose for each model feature. sign: +1 when a higher value would intuitively lift prices.
// lift/weigh explain an intuitive contribution; alt explains the counterintuitive case where the
// pooled history supports a known reversion story. Anything else is described as a pattern only.
const sgn = v => `${v < 0 ? 'minus ' : ''}${pctAbs(v)}`;
const pts = v => `${f1(v)} points`;
// Momentum and wage features are stored as log points (100 × log change); prose quotes percent.
const lp = v => 100 * (Math.exp(v / 100) - 1);
// Features are measured in the projection's origin year, which can differ from "the latest year"
// quoted elsewhere on the page (quarterly momentum, monthly rates), so the prose names the year.
const inYear = y => (y ? ` in ${y}` : '');
const toYear = y => (y ? ` to ${y}` : '');
const realMove = (v, y) => (lp(v) >= 0 ? `real price growth of ${pctAbs(lp(v))}${inYear(y)}` : `a real price fall of ${pctAbs(lp(v))}${inYear(y)}`);
const FEATURE_PROSE = {
  'own 1y real growth': { sign: 1, what: (v, k, y) => realMove(v, y), typ: t => `${sgn(lp(t))} in the typical market year`,
    lift: 'momentum, since markets that have been rising tend to keep rising for a while', weigh: 'weak momentum, which tends to persist for a time',
    alt: { lift: 'the tendency of soft years to be followed by recoveries', weigh: 'the tendency of strong years to fade as buyers reach the limits of affordability' } },
  'own 3y average real growth': { sign: 1, what: (v, k, y) => `real prices ${lp(v) >= 0 ? 'rising' : 'falling'} an average of ${pctAbs(lp(v))} a year over the three years${toYear(y)}`, typ: t => `${sgn(lp(t))} a year in the typical market`,
    lift: 'sustained momentum', weigh: 'a stalled market, where weakness has tended to linger',
    alt: { lift: 'the tendency of stalled markets to catch up over time', weigh: 'the tendency of long runs of gains to cool as valuations stretch' } },
  'price-to-income vs trailing 20 years': { sign: -1, what: v => `prices ${pctAbs(v)} ${v >= 0 ? 'above' : 'below'} their 20-year average ratio to incomes`, typ: t => `${pctAbs(t)} ${t >= 0 ? 'above' : 'below'} in the typical market`,
    lift: 'room for prices to grow with incomes after a period of improving affordability', weigh: 'stretched affordability, which has historically capped gains until incomes catch up' },
  'price-to-rent vs trailing 20 years': { sign: -1, what: v => `prices ${pctAbs(v)} ${v >= 0 ? 'above' : 'below'} their 20-year average ratio to rents`, typ: t => `${pctAbs(t)} ${t >= 0 ? 'above' : 'below'} in the typical market`,
    lift: 'healthy rental yields that keep ownership attractive to investors', weigh: 'thin rental yields that leave less room for further gains' },
  'real policy rate': { sign: -1, what: (v, k, y) => `${v < 0 ? 'a negative real policy rate (the policy rate less inflation) of ' + pctAbs(v) : 'a real policy rate (the policy rate less inflation) of ' + pctAbs(v)}${inYear(y)}`, typ: t => `${t < 0 ? 'minus ' : ''}${pctAbs(t)} in the typical market year`,
    lift: 'cheap real borrowing costs', weigh: 'tight real borrowing costs',
    alt: { lift: 'the tendency of high real rates to ease over the following decade, with prices recovering as they do', weigh: 'the tendency of unusually low real rates to rise over time, eroding the support they give prices' } },
  'policy rate change': { sign: -1, what: (v, k, y) => `${Math.abs(v) < 0.05 ? 'an unchanged average policy rate' : `a ${v < 0 ? 'cut' : 'rise'} of ${pts(v)} in the average policy rate`}${inYear(y)}`, typ: t => `${t < 0 ? 'a cut' : 'a rise'} of ${pts(t)} in the typical market year`,
    lift: 'easier credit as recent cuts reach borrowers', weigh: 'tighter credit as recent increases reach borrowers',
    alt: { lift: 'the tendency of prices to recover once tightening cycles end', weigh: 'the tendency of rate cuts to arrive when the housing cycle is already turning down' } },
  'household credit change (3y)': { sign: 1, what: (v, k, y) => `household credit ${v >= 0 ? 'up' : 'down'} ${pts(v)} of GDP over the three years${toYear(y)}`, typ: t => `${t >= 0 ? 'up' : 'down'} ${pts(t)} in the typical market`,
    lift: 'expanding mortgage credit, which adds purchasing power', weigh: 'slowing credit growth',
    alt: { lift: 'the room for borrowing to recover after a period of deleveraging', weigh: 'the tendency of rapid credit growth to be followed by weaker price gains as borrowing reaches its limits' } },
  'credit-to-GDP gap': { sign: -1, what: v => `household and corporate credit ${pts(v)} of GDP ${v < 0 ? 'below' : 'above'} its long-run trend (the credit-to-GDP gap)`, typ: t => `${pts(t)} ${t < 0 ? 'below' : 'above'} in the typical market`,
    lift: 'credit running below its trend, which leaves room for lending to grow', weigh: 'credit running above its trend, a classic early warning of housing corrections' },
  'population growth': { sign: 1, what: (v, k, y) => (v < -0.05 ? `a population shrinking ${pctAbs(v)}${inYear(y)}` : `population growth of ${sgn(v)}${inYear(y)}`), typ: t => `growth of ${sgn(t)} in the typical market`,
    lift: 'more households seeking homes', weigh: 'slower household formation' },
  'real GDP growth': { sign: 1, what: (v, k, y) => (v < -0.05 ? `a real GDP contraction of ${pctAbs(v)}${inYear(y)}` : `real GDP growth of ${sgn(v)}${inYear(y)}`), typ: t => `${sgn(t)} in the typical market year`,
    lift: 'rising incomes and employment', weigh: 'weaker income growth' },
  'cross momentum (rent for prices, prices for rents)': { sign: 1, what: (v, k, y) => `${k === 'rent' ? 'real price' : 'real rent'} ${lp(v) >= 0 ? 'growth' : 'fall'} of ${pctAbs(lp(v))}${inYear(y)}`, typ: t => `${sgn(lp(t))} in the typical market year`,
    lift: 'the pull between rents and prices, which tend to move together over time', weigh: 'soft conditions in the linked market' },
  'unemployment change (1y)': { sign: -1, what: (v, k, y) => `unemployment ${Math.abs(v) < 0.05 ? 'unchanged' : `${v > 0 ? 'up' : 'down'} ${pts(v)}`}${inYear(y)}`, typ: t => `${Math.abs(t) < 0.05 ? 'little change' : `${t > 0 ? 'a rise' : 'a fall'} of ${pts(t)}`} in the typical market year`,
    lift: 'an improving labour market', weigh: 'a weakening labour market, which deters buyers and raises the risk of forced sales' },
  'real wage growth': { sign: 1, what: (v, k, y) => `real wage ${lp(v) >= 0 ? 'growth' : 'fall'} of ${pctAbs(lp(v))}${inYear(y)}`, typ: t => `${sgn(lp(t))} in the typical market year`,
    lift: 'rising real wages, which lift what households can afford', weigh: 'weak real wage growth, which limits what households can afford' },
  'household debt-service gap': { sign: -1, what: (v, k, y) => `household debt service ${pts(v)} ${v >= 0 ? 'above' : 'below'} its long-run average${inYear(y)}`, typ: t => `${pts(t)} ${t >= 0 ? 'above' : 'below'} in the typical market`,
    lift: 'manageable repayment burdens', weigh: 'heavy repayment burdens' },
  'real policy rate × household credit': { sign: -1, what: v => `the burden of real interest rates on household debt (the real rate multiplied by debt as a share of GDP, ${v < 0 ? 'minus ' : ''}${f2(v)})`, typ: t => `${t < 0 ? 'minus ' : ''}${f2(t)} in the typical market year`,
    lift: 'a light real interest burden on household debt', weigh: 'a heavy real interest burden on household debt',
    alt: { lift: 'the tendency of indebted markets to recover strongly once high real rates ease', weigh: 'the tendency of unusually cheap credit for indebted households to unwind over time' } },
};
const featureWhat = (f, kind, year) => FEATURE_PROSE[f.name]?.what(f.value, kind, year) ?? f.name;
const featureTypical = (f) => FEATURE_PROSE[f.name]?.typ(f.typical) ?? `${f2(f.typical)} typically`;
function featureWhy(f) {
  const p = FEATURE_PROSE[f.name];
  if (!p) return null;
  const dev = f.value - f.typical;
  const intuitive = Math.sign(f.contribution) === Math.sign(p.sign * dev) || Math.abs(dev) < 1e-6;
  if (intuitive) return f.contribution >= 0 ? p.lift : p.weigh;
  const alt = p.alt?.[f.contribution >= 0 ? 'lift' : 'weigh'];
  return alt ?? 'a pattern the model draws from the pooled history, where this driver overlaps with others, rather than a direct effect';
}

function driversSection(input, n) {
  const d = input.drivers?.h10;
  if (!d || !finite(d.totalPct)) return null;
  const m = input.macro ?? {};
  const back = [];
  if (m.gdp && finite(m.gdp.value)) back.push(`${n.Possessive} economy grew ${b(sgn(m.gdp.value))} in real terms in ${m.gdp.period}${finite(m.gdpAhead) ? `, and the IMF expects growth to average ${sgn(m.gdpAhead)} a year over the next five years` : ''}.`);
  const demo = [];
  if (m.pop && finite(m.pop.value)) demo.push(Math.abs(m.pop.value) < 0.05 ? 'the population is broadly stable' : `the population is ${m.pop.value >= 0 ? 'growing' : 'shrinking'} ${pctAbs(m.pop.value)} a year`);
  if (m.urban && finite(m.urban.value)) demo.push(`${pctAbs(m.urban.value)} of people live in urban areas`);
  if (demo.length) back.push(`${cap(list(demo))} (${m.pop?.period ?? m.urban?.period}).`);
  if (m.credit && finite(m.credit.value)) back.push(`Household credit equals ${pctAbs(m.credit.value).replace('%', '')}% of GDP${finite(m.credit.change5) && Math.abs(m.credit.change5) >= 0.5 ? `, ${m.credit.change5 > 0 ? 'up' : 'down'} ${f1(m.credit.change5)} points over five years` : ''}.`);

  const own = d.totalPct - d.base - d.anchor;
  const anchorBit = Math.abs(d.anchor) >= 0.1 ? `, and ${n.possessive} own long-run growth trend, which the model blends in at ${Math.round((1 - d.weight) * 100)}%, accounts for ${d.anchor >= 0 ? '' : 'minus '}${pts(d.anchor)}` : '';
  const live = finite(input.drivers.liveGap10) && Math.abs(input.drivers.liveGap10) >= 0.1 ? ` Today's live adjustments ${input.drivers.liveGap10 >= 0 ? 'add' : 'subtract'} a further ${pts(input.drivers.liveGap10)}, which is why the headline reads ${input.price.h10.median >= 0 ? pctAbs(input.price.h10.median) : `a fall of ${pctAbs(input.price.h10.median)}`}.` : '';
  const p1 = `Before live adjustments, the model projects ${n.possessive} real prices ${d.totalPct >= 0 ? 'up' : 'down'} ${b(pctAbs(d.totalPct))} over ten years. The typical market in the model's pooled history gained ${b(pctAbs(d.base))} in real terms over a decade, and that is the common starting point; ${n.possessive} own conditions ${own >= 0 ? 'add' : 'subtract'} ${b(pts(own))} on balance${anchorBit}.${live}`;

  const big = d.features.filter(f => Math.abs(f.contribution) >= 0.5 && FEATURE_PROSE[f.name]);
  const lifts = big.filter(f => f.contribution > 0).slice(0, 2), weighs = big.filter(f => f.contribution < 0).slice(0, 2);
  const sent = [];
  const y = input.originYear;
  lifts.forEach((f, i) => sent.push(`${i === 0 ? 'The largest lift comes from' : 'Moreover, the model credits'} ${featureWhat(f, 'price', y)}, against ${featureTypical(f)}, which adds about ${b(pts(f.contribution))}, reflecting ${featureWhy(f)}.`));
  weighs.forEach((f, i) => {
    const lead = i === 0 && lifts.length ? `However, ${featureWhat(f, 'price', y)}` : cap(featureWhat(f, 'price', y));
    sent.push(`${lead}, against ${featureTypical(f)}, takes ${i === 0 ? `about ${b(pts(f.contribution))}` : `another ${pts(f.contribution)}`} off, reflecting ${featureWhy(f)}.`);
  });
  if (!big.length) sent.push(`No single driver moves the path by more than half a point, so the projection sits close to the pooled average.`);

  const h3 = input.drivers?.h3;
  const near = [];
  if (h3 && finite(h3.totalPct)) {
    const top = h3.features.filter(f => Math.abs(f.contribution) >= 0.4 && FEATURE_PROSE[f.name]).slice(0, 2);
    if (top.length) near.push(`Over three years the model path is ${h3.totalPct >= 0 ? 'a rise' : 'a fall'} of ${pctAbs(h3.totalPct)}, and the balance shifts: ${list(top.map(f => `${featureWhat(f, 'price', y)} ${f.contribution >= 0 ? 'adds' : 'subtracts'} ${pts(f.contribution)}`))}.`);
  }
  near.push('These shares come from the pooled model’s own weights, so they show what the projection leans on rather than proven causes, and the drivers are measured against the average market year in the training data.');
  return { id: 'drivers', title: 'What drives the projection', chart: 'drivers', paragraphs: [back.length ? para(back) : null, p1, para(sent), para(near)].filter(Boolean) };
}

const CENTRAL_BANK = {
  IND: 'Reserve Bank of India', USA: 'Federal Reserve', CAN: 'Bank of Canada', GBR: 'Bank of England', AUS: 'Reserve Bank of Australia', NZL: 'Reserve Bank of New Zealand',
  JPN: 'Bank of Japan', CHE: 'Swiss National Bank', SWE: 'Riksbank', NOR: 'Norges Bank', DNK: 'Danmarks Nationalbank', ISL: 'Central Bank of Iceland', KOR: 'Bank of Korea',
  BRA: 'Banco Central do Brasil', MEX: 'Banco de México', CHL: 'Central Bank of Chile', COL: 'Banco de la República', PER: 'Central Reserve Bank of Peru', ZAF: 'South African Reserve Bank',
  TUR: 'Central Bank of the Republic of Türkiye', POL: 'National Bank of Poland', CZE: 'Czech National Bank', HUN: 'Magyar Nemzeti Bank', ROU: 'National Bank of Romania',
  SRB: 'National Bank of Serbia', MKD: 'National Bank of the Republic of North Macedonia', ISR: 'Bank of Israel', SAU: 'Saudi Central Bank',
  // The UAE figure is the US policy rate (BIS proxy for the dollar peg), not the CBUAE base rate.
  ARE: 'Federal Reserve, whose rate the dirham peg follows,',
  CHN: "People's Bank of China", HKG: 'Hong Kong Monetary Authority', MYS: 'Bank Negara Malaysia', THA: 'Bank of Thailand', IDN: 'Bank Indonesia', PHL: 'Bangko Sentral ng Pilipinas',
  MAR: 'Bank Al-Maghrib', RUS: 'Bank of Russia',
  ...Object.fromEntries(['AUT', 'BEL', 'BGR', 'CYP', 'DEU', 'ESP', 'EST', 'FIN', 'FRA', 'GRC', 'HRV', 'IRL', 'ITA', 'LTU', 'LUX', 'LVA', 'MLT', 'NLD', 'PRT', 'SVK', 'SVN'].map(k => [k, 'European Central Bank'])),
};

// Central bank names that read without "the".
const NO_ARTICLE = new Set(['Bank Indonesia', 'Norges Bank', 'Danmarks Nationalbank', 'Bank Negara Malaysia', 'Bank Al-Maghrib']);

export function buildCountryNarrative(input) {
  const n = names(input.name);
  if (input.tier !== 1 || !input.price) {
    return { headline: headline(input), kpis: kpis(input), sections: driversNarrative(input, n) };
  }
  input = { ...input, _usedNotes: new Set() };
  const sections = [pricesSection(input, n), driversSection(input, n), rentsSection(input, n), ratesSection(input, n), labourSection(input, n), typesSection(input, n), contextSection(input, n), liveSection(input, n), outlookSection(input, n)].filter(Boolean);
  return { headline: headline(input), kpis: kpis(input), sections };
}

// ── Figures prepared for the prose (pure helpers used by src/lib/narrative-input.ts) ──

// Turning points of a real price index: a zigzag that only registers a reversal of at least
// `threshold` percent, so the prose describes the booms and corrections, not annual noise.
// Returns up to the last three legs, each with its real and (where available) nominal change.
export function pricePhases(real, nominal, origin, threshold = 8, window = 25) {
  if (!real || origin == null) return [];
  const pts = Object.entries(real).map(([y, v]) => [Number(y), v]).filter(([y, v]) => y >= origin - window && y <= origin && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  if (pts.length < 4) return [];
  const pivots = [pts[0]];
  let trend = 0, ext = pts[0];
  for (const p of pts.slice(1)) {
    if (trend >= 0 && p[1] >= ext[1]) { ext = p; if (trend === 0 && p[1] > pts[0][1] * (1 + threshold / 100)) trend = 1; continue; }
    if (trend <= 0 && p[1] <= ext[1]) { ext = p; if (trend === 0 && p[1] < pts[0][1] * (1 - threshold / 100)) trend = -1; continue; }
    if (trend >= 0 && p[1] < ext[1] * (1 - threshold / 100)) { if (ext !== pivots.at(-1)) pivots.push(ext); trend = -1; ext = p; continue; }
    if (trend <= 0 && p[1] > ext[1] * (1 + threshold / 100)) { if (ext !== pivots.at(-1)) pivots.push(ext); trend = 1; ext = p; }
  }
  if (ext !== pivots.at(-1)) pivots.push(ext);
  if (pivots.at(-1)[0] !== origin) pivots.push(pts.at(-1));
  const legs = pivots.slice(1).map((p, i) => {
    const a = pivots[i];
    const n0 = nominal?.[a[0]], n1 = nominal?.[p[0]];
    return { from: a[0], to: p[0], real: 100 * (p[1] / a[1] - 1), nominal: n0 && n1 ? 100 * (n1 / n0 - 1) : null };
  }).filter(l => l.to > l.from);
  return legs.slice(-3);
}

// Converts a stored driver breakdown (log points) into percentage-point shares of the projected
// percentage change, scaled so the parts add up to the headline figure.
export function driverShares(d) {
  if (!d || d.total == null || !d.features) return null;
  const pct = 100 * (Math.exp(d.total / 100) - 1);
  const k = Math.abs(d.total) > 0.5 ? pct / d.total : 1;
  return { method: d.method, weight: d.weight ?? 1, totalPct: pct, base: (d.base ?? 0) * k, anchor: (d.anchor ?? 0) * k,
    features: d.features.map(f => ({ name: f.name, value: f.value, typical: f.typical, contribution: f.contribution * k })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)) };
}

// The latest policy rate move: the daily live reading against the latest monthly value when the
// live reading is newer, else the last monthly step. `since` is the month the move took effect.
// Monthly values are end of month, so a live reading that differs moved after the monthly as-of
// month: in the live month when that is the next one, otherwise the month is not known.
/** @param {{ liveNewer: boolean, liveRate: number | null, liveDate: string | null, monthlyRate: number | null, monthlyAsOf: string | null, monthly?: { period: string, value: number }[] }} args */
export function latestRateMove({ liveNewer, liveRate, liveDate, monthlyRate, monthlyAsOf, monthly = [] }) {
  const nextMonth = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
  if (liveNewer && finite(liveRate) && finite(monthlyRate) && Math.abs(liveRate - monthlyRate) >= 0.05) {
    const liveMonth = liveDate ? liveDate.slice(0, 7) : '';
    return { size: liveRate - monthlyRate, from: monthlyRate, since: monthlyAsOf && nextMonth(monthlyAsOf) === liveMonth ? liveMonth : '' };
  }
  const m = [...monthly].sort((a, b) => a.period.localeCompare(b.period));
  for (let i = m.length - 1; i > 0; i--) {
    const d = m[i].value - m[i - 1].value;
    if (Math.abs(d) >= 0.05) return { size: d, from: m[i - 1].value, since: m[i].period };
  }
  return null;
}

// Nominal ten-year outlook: the real path compounded with the inflation path,
// (1 + real/100) × Π(1 + inflation/100) − 1, with the path's average inflation for the prose.
export function nominalOutlook(real10, inflation) {
  const path = Object.values(inflation ?? {}).map(Number).filter(Number.isFinite);
  if (!path.length || !finite(real10)) return null;
  const inflAvg = path.reduce((a, b) => a + b, 0) / path.length;
  const cumInfl = 100 * (path.reduce((acc, v) => acc * (1 + v / 100), 1) - 1);
  return { inflAvg, cumInfl, price10: 100 * ((1 + real10 / 100) * (1 + cumInfl / 100) - 1) };
}

// Places only: aggregates, size classes, remainders and duplicate spellings are not places, so
// they stay out of city counts and names. Spaced dashes in official names become hyphens.
const NOT_A_PLACE = /\baggregate\b|\(discontinued\)|\bhors\b|\bexluding\b|^Province\b/i;
/** @template {{ name: string }} T @param {T[]} list @returns {T[]} */
export function placesOnly(list) {
  const key = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/æ/gi, 'ae').toLowerCase();
  const seen = new Set();
  return list.filter(x => !NOT_A_PLACE.test(x.name) && !seen.has(key(x.name)) && seen.add(key(x.name))).map(x => ({ ...x, name: x.name.replace(/\s+-\s+/g, '-') }));
}

// Splits a paragraph with **bold** markers into text runs (for the UI and for checks).
export function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(t => (t.startsWith('**') ? { bold: true, text: t.slice(2, -2) } : { bold: false, text: t }));
}
export const plain = text => text.replace(/\*\*/g, '');
