"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { flagEmoji, pct, TYPE_LABELS } from "@/lib/labels";

export type CountryRow = {
  iso3: string; iso2: string; name: string; region: string; income_group: string | null; tier: number; has_rent: number; has_national: number;
  price10: number | null; rent10: number | null; types: string[];
};

export function CountryFilter({ rows }: { rows: CountryRow[] }) {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [tier, setTier] = useState<"all" | "1" | "2">("all");
  const [rents, setRents] = useState(false);
  const [national, setNational] = useState(false);
  const regions = useMemo(() => [...new Set(rows.map((r) => r.region))].sort(), [rows]);
  const shown = rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.iso3.toLowerCase() === q.toLowerCase()) &&
    (!region || r.region === region) &&
    (tier === "all" || String(r.tier) === tier) &&
    (!rents || r.has_rent) && (!national || r.has_national));

  return (
    <>
      <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label className="field" style={{ flex: "1 1 200px" }}>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Country name or ISO3" /></label>
        <label className="field" style={{ flex: "1 1 200px" }}>Region
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="chips" role="group" aria-label="Tier">
          {(["all", "1", "2"] as const).map((t) => <button key={t} className="chip" aria-pressed={tier === t} onClick={() => setTier(t)}>{t === "all" ? "All" : `Tier ${t}`}</button>)}
        </div>
        <div className="chips">
          <button className="chip" aria-pressed={rents} onClick={() => setRents(!rents)}>Has rents</button>
          <button className="chip" aria-pressed={national} onClick={() => setNational(!national)}>National data</button>
        </div>
      </div>
      <p className="note">{shown.length} of {rows.length} economies</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Country</th><th>Region</th><th>Income group</th><th>Tier</th><th className="r">Real price, 10y</th><th className="r">Real rent, 10y</th><th>Dwelling types</th><th>National</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.iso3}>
                <td><Link href={`/countries/${r.iso3}`}>{flagEmoji(r.iso2)} {r.name}</Link></td>
                <td className="note">{r.region}</td>
                <td className="note">{r.income_group ?? "–"}</td>
                <td><span className={`badge ${r.tier === 1 ? "badge--t1" : ""}`}>Tier {r.tier}</span></td>
                {r.tier === 1 ? (
                  <>
                    <td className="r">{pct(r.price10)}</td>
                    <td className="r">{pct(r.rent10)}</td>
                    <td className="note">{r.types.length ? r.types.map((t) => TYPE_LABELS[t] ?? t).join(", ") : "–"}</td>
                  </>
                ) : <td colSpan={3} className="note">Drivers only, no official price index</td>}
                <td>{r.has_national ? <span className="badge">National</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
