import "server-only";
import { backtests, contexts, countries, flags, latestRun, personaRows, projections, sensitivities } from "@/lib/data";
import { TYPE_LABELS } from "@/lib/labels";

// Facts are pre-formatted as percentage changes so the model can restate them
// without arithmetic. Every number the answer may use must appear here.
const f1 = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const TARGETS: Record<string, string> = { real_price: "real house prices", nominal_price: "nominal house prices", real_rent: "real rents", nominal_rent: "nominal rents" };

export async function buildFacts(iso3?: string): Promise<string[] | null> {
  const run = await latestRun();
  if (!run) return null;
  const [list, proj, fl, personas, ctxs, bt, sens] = await Promise.all([countries(), projections(iso3), flags(), personaRows(), contexts(), backtests(), sensitivities()]);
  const name = (c: string) => list.find((x) => x.iso3 === c)?.name ?? c;
  const facts: string[] = [`Data vintage ${run.data_vintage}; projection run ${run.id}. Projections are changes from each series' last observed year (the origin).`];

  if (iso3) {
    const c = list.find((x) => x.iso3 === iso3);
    if (!c) return facts;
    facts.push(`${c.name} (${iso3}): Tier ${c.tier}${c.tier === 2 ? " - no official house price index, so no price or rent projections exist" : ""}${c.has_rent ? ", has a rent index" : ", no rent index"}.`);
    const ctx = ctxs.find((x) => x.country === iso3);
    if (ctx) {
      facts.push(`${c.name} projection origin year ${ctx.origin_year}${ctx.rent_origin_year ? `; rent origin year ${ctx.rent_origin_year}` : ""}.`);
      if (ctx.policy_rate != null) facts.push(`${c.name} policy rate ${ctx.policy_rate.toFixed(2)}% (${ctx.policy_rate_as_of}).`);
      if (ctx.mortgage_rate != null) facts.push(`${c.name} mortgage rate used ${ctx.mortgage_rate.toFixed(2)}% (${ctx.mortgage_rate_source}).`);
    }
    for (const p of proj.filter((p) => [1, 3, 5, 10].includes(p.horizon))) {
      const [target, type] = p.target.split(":");
      const label = type ? `real ${TYPE_LABELS[type] ?? type} prices` : TARGETS[target];
      if (!label) continue;
      facts.push(`${c.name} ${label}, ${p.horizon}-year (${p.year}): median ${f1(p.median - 100)}, 80% range ${f1(p.p10 - 100)} to ${f1(p.p90 - 100)}; method: ${p.method}.`);
    }
    for (const f of fl.filter((f) => f.country === iso3)) facts.push(`${c.name} risk flag: ${run.summary.flagRules[f.flag]?.label} (reading ${f.value.toFixed(1)}, threshold ${f.threshold}, as of ${f.as_of}).`);
    for (const r of personas.filter((r) => r.country === iso3)) {
      const total = personas.filter((x) => x.persona === r.persona).length;
      facts.push(`${c.name} ${run.summary.personas[r.persona]?.label} index: ${r.score.toFixed(0)} out of 100, rank ${r.rank} of ${total}.`);
    }
  } else {
    const ranked = (await projections()).filter((p) => p.target === "real_price" && p.horizon === 10).sort((a, b) => b.median - a.median);
    ranked.slice(0, 10).forEach((p, i) => facts.push(`Strongest 10-year real price outlook #${i + 1}: ${name(p.country)} median ${f1(p.median - 100)} (80% range ${f1(p.p10 - 100)} to ${f1(p.p90 - 100)}).`));
    ranked.slice(-10).reverse().forEach((p, i) => facts.push(`Weakest 10-year real price outlook #${i + 1}: ${name(p.country)} median ${f1(p.median - 100)} (80% range ${f1(p.p10 - 100)} to ${f1(p.p90 - 100)}).`));
    for (const persona of ["investor", "buyer", "renter", "seller"]) {
      const top = personas.filter((r) => r.persona === persona).slice(0, 5).map((r) => `${name(r.country)} ${r.score.toFixed(0)}`).join(", ");
      facts.push(`Top ${run.summary.personas[persona]?.label} index scores: ${top}.`);
    }
    facts.push(`Countries with official house price indexes: ${list.filter((c) => c.tier === 1).length} of ${list.length}.`);
  }

  for (const b of bt.filter((b) => b.horizon === 1 || b.horizon === 10)) facts.push(`Backtest ${b.target} ${b.horizon}-year: ${b.status}; method ${b.method}; skill vs no-change ${b.skill_pct.toFixed(1)}%; ${b.n_origins} backtest origins.`);
  for (const s of sens.filter((s) => s.horizon === 3 || s.horizon === 10)) facts.push(`Rate sensitivity ${s.target} ${s.horizon}-year: ${s.coef.toFixed(2)} percentage points of cumulative real growth per +1pp sustained rate rise (standard error ${s.se.toFixed(2)}); toggle ${s.valid ? "on" : "off"}.`);
  for (const l of run.summary.limits) facts.push(`Limit: ${l}`);
  return facts;
}

// Every number in the answer must appear in the facts (compared at 0 and 1 decimals,
// sign-insensitive). Years 1900-2100 and small integers up to 10 are always allowed.
export function checkNumbers(answer: string, facts: string) {
  const extract = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const known = new Set<string>();
  for (const n of extract(facts)) { known.add(n.toFixed(0)); known.add(n.toFixed(1)); known.add(n.toFixed(2)); }
  const unverified: string[] = [];
  for (const n of extract(answer)) {
    if (Number.isInteger(n) && ((n >= 1900 && n <= 2100) || n <= 10)) continue;
    if (Number.isInteger(n) ? known.has(n.toFixed(0)) : known.has(n.toFixed(1)) || known.has(n.toFixed(2))) continue;
    unverified.push(String(n));
  }
  return { passed: unverified.length === 0, unverified: [...new Set(unverified)] };
}
