"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CityMetric, CitySummary } from "@/lib/data";

type SortKey = "name" | "price" | "price1y" | "price5y" | "rent" | "rent1y" | "vacancy" | "sales";

const fmtNum = (m: CityMetric | null) => {
  if (!m) return "–";
  if (m.kind === "rate") return `${m.value.toFixed(1)}%`;
  if (m.kind === "index") return m.value.toFixed(1);
  return Math.round(m.value).toLocaleString("en");
};
const fmtPct = (v: number | null | undefined, rate = false) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${rate ? "pp" : "%"}`);
const tone = (v: number | null | undefined) => (v == null ? undefined : v < 0 ? "neg" : "pos");

// Sortable, searchable table of every city or region for one country.
export function CitiesTable({ iso3, cities }: { iso3: string; cities: CitySummary[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "price" | "rent">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const value = (c: CitySummary, k: SortKey): number | string | null =>
    k === "name" ? c.name : k === "price" ? c.price?.value ?? null : k === "price1y" ? c.price?.change1y ?? null : k === "price5y" ? c.price?.change5y ?? null
      : k === "rent" ? c.rent?.value ?? null : k === "rent1y" ? c.rent?.change1y ?? null : k === "vacancy" ? c.vacancy?.value ?? null : c.sales?.value ?? null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cities
      .filter((c) => (!needle || c.name.toLowerCase().includes(needle)) && (only === "all" || (only === "price" ? c.price : c.rent)))
      .sort((a, b) => {
        const va = value(a, sort.key), vb = value(b, sort.key);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
      });
  }, [cities, q, only, sort]);
  const head = (key: SortKey, label: string, right = true) => (
    <th className={right ? "r" : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <section className="section">
      <div className="cities-tools">
        <label className="field" style={{ flex: "1 1 240px" }}>Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="City or region" aria-label="Search cities" />
        </label>
        <div className="chips" role="group" aria-label="Filter">
          {(["all", "price", "rent"] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={only === k} onClick={() => setOnly(k)}>{k === "all" ? "All" : k === "price" ? "With prices" : "With rents"}</button>
          ))}
        </div>
        <span className="note">{shown.length} shown</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {head("name", "City or region", false)}
              {head("price", "Price")}
              {head("price1y", "1y")}
              {head("price5y", "5y")}
              {head("rent", "Rent / month")}
              {head("rent1y", "Rent 1y")}
              {head("vacancy", "Vacancy")}
              {head("sales", "Sales / year")}
              <th>Series</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.slug}>
                <td><Link href={`/countries/${iso3}/${c.slug}`}>{c.name}</Link></td>
                <td className="r" title={c.price ? `${c.price.indicator} ${c.price.period}` : undefined}>{fmtNum(c.price)}{c.price?.kind === "index" ? <span className="note"> idx</span> : null}</td>
                <td className={`r ${tone(c.price?.change1y) ?? ""}`}>{fmtPct(c.price?.change1y)}</td>
                <td className={`r ${tone(c.price?.change5y) ?? ""}`}>{fmtPct(c.price?.change5y)}</td>
                <td className="r" title={c.rent ? `${c.rent.indicator} ${c.rent.period}` : undefined}>{fmtNum(c.rent)}</td>
                <td className="r">{fmtPct(c.rent?.change1y)}</td>
                <td className="r">{c.vacancy ? `${c.vacancy.value.toFixed(1)}%` : "–"}</td>
                <td className="r">{fmtNum(c.sales)}</td>
                <td className="note">{c.indicators.length} · {c.sources.slice(0, 2).join(", ")}{c.sources.length > 2 ? ` +${c.sources.length - 2}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Prices are local-currency levels where a registry or agency publishes them, otherwise an index (idx). Sales are registered transactions per year.</p>
    </section>
  );
}
