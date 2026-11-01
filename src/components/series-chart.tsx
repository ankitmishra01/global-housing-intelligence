"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Series = { name: string; color: string; points: { period: string; value: number }[] };

// A small multi-line history chart (region vs national) keyed by period label.
export function SeriesChart({ series, unit, label }: { series: Series[]; unit?: string; label: string }) {
  const periods = [...new Set(series.flatMap((s) => s.points.map((p) => p.period)))].sort();
  const data = periods.map((period) => Object.fromEntries([["period", period], ...series.map((s) => [s.name, s.points.find((p) => p.period === period)?.value ?? null])]));
  const fmt = (v: unknown) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : v.toFixed(Math.abs(v) < 20 ? 2 : 1)) : "–");
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="chart" style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} minTickGap={24} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmt(v)} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 8, fontSize: 12 }} formatter={(v) => `${fmt(v)}${unit ? ` ${unit}` : ""}`} />
            {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {series.map((s) => <Line key={s.name} dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
