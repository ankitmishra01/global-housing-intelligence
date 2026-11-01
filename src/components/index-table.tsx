"use client";
import Link from "next/link";
import { useState } from "react";
import { flagEmoji, fmt, PERSONA_ORDER } from "@/lib/labels";

type Spec = { label: string; question: string; components: { key: string; weight: number; direction: number; label: string }[] };
type Row = { country: string; persona: string; score: number; rank: number; components: { key: string; value: number | null; percentile: number | null; weight: number }[] };

const short = (s: string) => { const base = s.split(" (")[0]; return base.length > 28 ? `${base.slice(0, 26)}…` : base; };

export function IndexTable({ specs, rows, names, initial }: { specs: Record<string, Spec>; rows: Row[]; names: Record<string, { name: string; iso2: string }>; initial: string }) {
  const [persona, setPersona] = useState<string>((PERSONA_ORDER as readonly string[]).includes(initial) ? initial : "investor");
  const spec = specs[persona];
  const list = rows.filter((r) => r.persona === persona).sort((a, b) => a.rank - b.rank);
  const select = (k: string) => {
    setPersona(k);
    const url = new URL(window.location.href); url.searchParams.set("persona", k); window.history.replaceState(null, "", url);
  };
  return (
    <>
      <div className="chips" role="tablist" aria-label="Persona">
        {PERSONA_ORDER.map((k) => <button key={k} role="tab" className="chip" aria-selected={persona === k} aria-pressed={persona === k} onClick={() => select(k)}>{specs[k]?.label ?? k}</button>)}
      </div>
      <p className="lede" style={{ margin: "14px 0" }}>{spec?.question}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="r">#</th><th>Country</th><th>Score</th>
              {spec?.components.map((c) => <th key={c.key} className="r" title={c.label}>{short(c.label)}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.country}>
                <td className="r num">{r.rank}</td>
                <td><Link href={`/countries/${r.country}`}>{flagEmoji(names[r.country]?.iso2)} {names[r.country]?.name ?? r.country}</Link></td>
                <td style={{ minWidth: 120 }}><span className="num">{r.score.toFixed(1)}</span><div className="meter"><i style={{ width: `${r.score}%` }} /></div></td>
                {spec?.components.map((c) => {
                  const part = r.components.find((x) => x.key === c.key);
                  return <td key={c.key} className="r num" title={part?.value != null ? `Raw value: ${fmt(part.value, 2)}` : "No data"}>{part?.percentile != null ? part.percentile.toFixed(0) : "–"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Columns show each component&apos;s percentile (0 to 100, oriented so higher is better for this persona); hover for the raw value. Weights:{" "}
        {spec?.components.map((c) => `${short(c.label)} ${Math.round(c.weight * 100)}%`).join(" · ")}. Missing components are re-weighted; a score needs at least half the weight.
      </p>
    </>
  );
}
