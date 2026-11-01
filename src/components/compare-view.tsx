"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shiftBand, type Band, type SensMap } from "@/lib/toggle";
import { flagEmoji, fmt, pct, PERSONA_ORDER } from "@/lib/labels";

export type CompareCountry = {
  iso3: string; name: string; iso2: string;
  price: Band[]; rent: Band[]; ptr: Band[];
  policy: number | null; mortgage: number | null; flags: number;
  personas: Record<string, number | null>;
};

const COLORS = ["var(--line)", "var(--rent)", "var(--moss)", "var(--gold)"];

export function CompareView({ options, selected, data, sens, personaLabels }: {
  options: { iso3: string; name: string }[]; selected: string[]; data: CompareCountry[];
  sens: { real_price?: SensMap; real_rent?: SensMap; priceValid: boolean }; personaLabels: Record<string, string>;
}) {
  const router = useRouter(), path = usePathname();
  const [delta, setDelta] = useState(0);
  const [adding, setAdding] = useState("");
  const update = (next: string[]) => router.replace(`${path}?c=${next.join(",")}`, { scroll: false });

  const shifted = data.map((c) => ({
    ...c,
    price: shiftBand(c.price, sens.priceValid ? sens.real_price : undefined, delta),
    rent: shiftBand(c.rent, sens.real_rent, delta),
  }));
  const at = (rows: Band[], h: number) => rows.find((r) => r.horizon === h);
  const chartData = (key: "price" | "rent") =>
    [{ h: "Today", ...Object.fromEntries(shifted.filter((c) => c[key].length).map((c) => [c.iso3, 100])) },
      ...Array.from({ length: 10 }, (_, i) => ({ h: `+${i + 1}y`, ...Object.fromEntries(shifted.map((c) => [c.iso3, at(c[key], i + 1)?.median != null ? +at(c[key], i + 1)!.median.toFixed(2) : undefined])) }))];

  const chart = (key: "price" | "rent", title: string) => {
    const withData = shifted.filter((c) => c[key].length);
    return (
      <div className="panel">
        <p className="eyebrow">{key === "price" ? "Buy" : "Rent"}</p>
        <h3 style={{ margin: "4px 0 8px", font: "400 22px var(--font-display)" }}>{title}</h3>
        {withData.length ? (
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={chartData(key)} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="h" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--rule)" }} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} />
                <ReferenceLine y={100} stroke="var(--faint)" strokeWidth={0.5} />
                <Tooltip contentStyle={{ background: "var(--sheet)", border: "1px solid var(--rule)", fontSize: 12 }} formatter={(v, n) => [Number(v).toFixed(1), shifted.find((c) => c.iso3 === n)?.name ?? n]} />
                <Legend formatter={(v) => shifted.find((c) => c.iso3 === v)?.name ?? v} wrapperStyle={{ fontSize: 12 }} />
                {shifted.map((c, i) => c[key].length ? <Line key={c.iso3} dataKey={c.iso3} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls /> : null)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="note">None of the selected countries has a rent index.</p>}
        <p className="note">Median real index, today = 100.</p>
      </div>
    );
  };

  return (
    <>
      <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <div className="chips">
          {data.map((c) => (
            <button key={c.iso3} className="chip" aria-pressed="true" onClick={() => selected.length > 2 && update(selected.filter((s) => s !== c.iso3))} title={selected.length > 2 ? "Remove" : "Keep at least two"}>
              {flagEmoji(c.iso2)} {c.name} {selected.length > 2 ? "×" : ""}
            </button>
          ))}
        </div>
        {selected.length < 4 ? (
          <label className="field" style={{ flex: "1 1 220px" }}>Add a country
            <select value={adding} onChange={(e) => { setAdding(""); if (e.target.value) update([...selected, e.target.value]); }}>
              <option value="">Choose…</option>
              {options.filter((o) => !selected.includes(o.iso3)).map((o) => <option key={o.iso3} value={o.iso3}>{o.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <section className="section">
        <div className="toggle">
          <p className="eyebrow">Interest-rate toggle</p>
          <div className="toggle__row" style={{ marginTop: 8 }}>
            <span className="toggle__value num">{delta > 0 ? "+" : ""}{delta.toFixed(2)} pp</span>
            <input type="range" min={-3} max={3} step={0.25} value={delta} onChange={(e) => setDelta(Number(e.target.value))} aria-label="Change in interest rates, percentage points" />
            <div className="chips">{[-2, -1, 0, 1, 2].map((v) => <button key={v} className="chip" aria-pressed={delta === v} onClick={() => setDelta(v)}>{v > 0 ? `+${v}` : v}</button>)}</div>
          </div>
          <p className="note">The same sustained rate move applied to every selected country, using the pooled model-implied sensitivity.{!sens.priceValid ? " The price effect is switched off this run (wrong-signed estimate)." : ""}</p>
        </div>
      </section>

      <section className="section grid-2">
        {chart("price", "Real house prices, 10 years")}
        {chart("rent", "Real rents, 10 years")}
      </section>

      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Measure</th>
                {shifted.map((c) => <th key={c.iso3} className="r"><Link href={`/countries/${c.iso3}`}>{c.name}</Link></th>)}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Real price, 3 years", get: (c: CompareCountry) => pct(at(c.price, 3) ? at(c.price, 3)!.median - 100 : null) },
                { label: "Real price, 10 years", get: (c: CompareCountry) => pct(at(c.price, 10) ? at(c.price, 10)!.median - 100 : null) },
                { label: "Real rent, 10 years", get: (c: CompareCountry) => pct(at(c.rent, 10) ? at(c.rent, 10)!.median - 100 : null) },
                { label: "Price-to-rent, 10 years", get: (c: CompareCountry) => pct(at(c.ptr, 10) ? at(c.ptr, 10)!.median - 100 : null) },
                { label: "Policy rate", get: (c: CompareCountry) => (c.policy != null ? `${fmt(c.policy + delta, 2)}%` : "–") },
                { label: "Mortgage rate", get: (c: CompareCountry) => (c.mortgage != null ? `${fmt(c.mortgage + delta, 2)}%` : "–") },
                ...PERSONA_ORDER.map((k) => ({ label: `${personaLabels[k] ?? k} index`, get: (c: CompareCountry) => (c.personas[k] != null ? c.personas[k]!.toFixed(0) : "–") })),
                { label: "Risk flags", get: (c: CompareCountry) => String(c.flags) },
              ].map((row) => (
                <tr key={row.label}><td>{row.label}</td>{shifted.map((c) => <td key={c.iso3} className="r num">{row.get(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Persona scores are shown at current rates; the country pages recompute them under the toggle. Price-to-rent is not rate-adjusted here.</p>
      </section>
    </>
  );
}
