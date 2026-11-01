import type { Metadata } from "next";
import { CountryFilter, type CountryRow } from "@/components/country-filter";
import { contexts, countries, projections } from "@/lib/data";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Countries" };

export default async function CountriesPage() {
  const [list, proj, ctxs] = await Promise.all([countries(), projections(), contexts()]);
  const at10 = (target: string) => Object.fromEntries(proj.filter((p) => p.target === target && p.horizon === 10).map((p) => [p.country, p.median - 100]));
  const price10 = at10("real_price"), rent10 = at10("real_rent");
  const types = Object.fromEntries(ctxs.map((c) => [c.country, Object.keys(c.details.types ?? {})]));
  const rows: CountryRow[] = list.map((c) => ({
    iso3: c.iso3, iso2: c.iso2, name: c.name, region: c.region, income_group: c.income_group, tier: Number(c.tier), has_rent: Number(c.has_rent), has_national: Number(c.has_national),
    price10: price10[c.iso3] ?? null, rent10: rent10[c.iso3] ?? null, types: types[c.iso3] ?? [],
  }));
  const tier1 = rows.filter((r) => r.tier === 1).length;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Coverage</p>
          <h1>Every economy</h1>
          <p className="lede">{rows.length} economies. {tier1} publish an official house price index (Tier 1) and get 10-year projections. The rest (Tier 2) show the housing drivers the data supports.</p>
        </div>
      </header>
      <section className="section">
        {rows.length ? <CountryFilter rows={rows} /> : <div className="empty"><h2>No countries loaded yet</h2><p>Run the seed pipeline to populate the database.</p></div>}
      </section>
    </div>
  );
}
