import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CitiesTable } from "@/components/cities-table";
import { citySummaries, country } from "@/lib/data";
import { flagEmoji } from "@/lib/labels";

export const revalidate = 86400;

// Cached after the first request (ISR); nothing is built ahead of time.
export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ iso3: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const c = await country((await params).iso3);
  return { title: c ? `Cities in ${c.name}: house prices and rents` : "Cities" };
}

export default async function CitiesPage({ params }: Params) {
  const iso3 = (await params).iso3.toUpperCase();
  const [c, cities] = await Promise.all([country(iso3), citySummaries(iso3)]);
  if (!c || !cities.length) notFound();
  const sources = [...new Set(cities.flatMap((x) => x.sources))].sort();
  const withPrice = cities.filter((x) => x.price).length, withRent = cities.filter((x) => x.rent).length;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow"><Link href={`/countries/${iso3}`}>{c.name}</Link> · Cities and regions</p>
          <h1>{flagEmoji(c.iso2)} Cities in {c.name}</h1>
          <p className="lede">
            {cities.length} cities and regions from national statistics offices, land registries and housing agencies. {withPrice} have a price series and {withRent} have rents.
            Figures are the latest annual readings; changes compare the same series one and five years earlier. These pages describe city markets; projections are national.
          </p>
        </div>
        <div className="hero-stats">
          <div><span>Cities and regions</span><strong className="num">{cities.length}</strong><small>with any housing series</small></div>
          <div><span>With prices</span><strong className="num">{withPrice}</strong><small>level or index</small></div>
          <div><span>With rents</span><strong className="num">{withRent}</strong><small>average or typical rent</small></div>
          <div><span>Sources</span><strong className="num">{sources.length}</strong><small>credited on each row</small></div>
        </div>
      </header>
      <CitiesTable iso3={iso3} cities={cities} />
      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Sources</p><h2>Where the city data comes from</h2></div></div>
        <div className="chips">{sources.map((s) => <span key={s} className="badge">{s}</span>)}</div>
      </section>
    </div>
  );
}
