import type { Metadata } from "next";
import { IndexTable } from "@/components/index-table";
import { countries, latestRun, personaRows } from "@/lib/data";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Indexes" };

export default async function IndexesPage({ searchParams }: { searchParams: Promise<{ persona?: string }> }) {
  const [run, rows, list, sp] = await Promise.all([latestRun(), personaRows(), countries(), searchParams]);
  const names = Object.fromEntries(list.map((c) => [c.iso3, { name: c.name, iso2: c.iso2 }]));
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Persona indexes</p>
          <h1>Investors, buyers, renters, sellers</h1>
          <p className="lede">Each index scores an economy from 0 to 100 against every economy with an official house price index. 100 is most favourable for that person. Components and weights are published below each table.</p>
        </div>
      </header>
      <section className="section">
        {run && rows.length ? <IndexTable specs={run.summary.personas} rows={rows} names={names} initial={sp.persona ?? "investor"} /> : <div className="empty"><h2>No indexes yet</h2><p>Run the training pipeline to compute the indexes.</p></div>}
      </section>
    </div>
  );
}
