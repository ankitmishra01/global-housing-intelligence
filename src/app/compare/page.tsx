import type { Metadata } from "next";
import { CompareView, type CompareCountry } from "@/components/compare-view";
import { contexts, countries, flags, latestRun, personaRows, projections, sensitivities, type Projection, type Sensitivity } from "@/lib/data";
import type { Band, SensMap } from "@/lib/toggle";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Compare" };

const DEFAULT = ["CAN", "USA", "GBR", "AUS"];

const bands = (list: Projection[], iso3: string, target: string): Band[] =>
  list.filter((p) => p.country === iso3 && p.target === target).map((p) => ({ horizon: p.horizon, year: p.year, p10: p.p10, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90 }));
const sensMap = (list: Sensitivity[], target: string): SensMap | undefined => {
  const rows = list.filter((s) => s.target === target);
  return rows.length ? Object.fromEntries(rows.map((s) => [s.horizon, { coef: s.coef, se: s.se, valid: !!s.valid }])) : undefined;
};

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const [run, list, proj, sens, allFlags, personas, ctxs, sp] = await Promise.all([latestRun(), countries(), projections(), sensitivities(), flags(), personaRows(), contexts(), searchParams]);
  const tier1 = list.filter((c) => Number(c.tier) === 1);
  const valid = new Set(tier1.map((c) => c.iso3));
  let selected = (sp.c ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s, i, a) => valid.has(s) && a.indexOf(s) === i).slice(0, 4);
  if (selected.length < 2) selected = DEFAULT.filter((s) => valid.has(s));

  const data: CompareCountry[] = selected.map((iso3) => {
    const c = tier1.find((x) => x.iso3 === iso3)!;
    const ctx = ctxs.find((x) => x.country === iso3);
    return {
      iso3, name: c.name, iso2: c.iso2,
      price: bands(proj, iso3, "real_price"), rent: bands(proj, iso3, "real_rent"), ptr: bands(proj, iso3, "price_to_rent"),
      policy: ctx?.policy_rate ?? null, mortgage: ctx?.mortgage_rate ?? null,
      flags: allFlags.filter((f) => f.country === iso3).length,
      personas: Object.fromEntries(["investor", "buyer", "renter", "seller"].map((k) => [k, personas.find((r) => r.country === iso3 && r.persona === k)?.score ?? null])),
    };
  });
  const priceSens = sens.filter((s) => s.target === "real_price");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Compare</p>
          <h1>Side by side</h1>
          <p className="lede">Compare two to four economies: 10-year real price and rent paths, valuation, rates and the four persona indexes, under the same interest-rate scenario.</p>
        </div>
      </header>
      <section className="section">
        {run && data.length >= 2 ? (
          <CompareView
            options={tier1.map((c) => ({ iso3: c.iso3, name: c.name }))}
            selected={selected}
            data={data}
            sens={{ real_price: sensMap(sens, "real_price"), real_rent: sensMap(sens, "real_rent"), priceValid: priceSens.length > 0 && !!priceSens[0].valid }}
            personaLabels={Object.fromEntries(Object.entries(run.summary.personas).map(([k, v]) => [k, v.label]))}
          />
        ) : <div className="empty"><h2>No projections yet</h2><p>Run the training pipeline first.</p></div>}
      </section>
    </div>
  );
}
