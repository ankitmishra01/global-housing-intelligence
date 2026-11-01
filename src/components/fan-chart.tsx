"use client";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { Band } from "@/lib/toggle";

type Point = { year: number; value: number };
type Series = { history: Point[]; bands: Band[]; color: "price" | "rent" };

const VARS = {
  price: { line: "var(--line)", b80: "var(--band80)", b50: "var(--band50)" },
  rent: { line: "var(--rent)", b80: "var(--rentBand80)", b50: "var(--rentBand50)" },
};

// History (index, origin year = 100) joined to the projected fan. Bands are drawn as
// stacked areas: transparent base to p10, then p10-p25, p25-p75, p75-p90.
export function FanChart({ history, bands, color, label }: Series & { label: string }) {
  const v = VARS[color];
  const origin = history.at(-1);
  const data = [
    ...history.map((p) => ({ year: p.year, hist: +p.value.toFixed(2) })),
    ...bands.map((b) => ({
      year: b.year, median: +b.median.toFixed(2),
      base: +b.p10.toFixed(2), lo: +(b.p25 - b.p10).toFixed(2), mid: +(b.p75 - b.p25).toFixed(2), hi: +(b.p90 - b.p75).toFixed(2),
      p10: b.p10, p90: b.p90,
    })),
  ];
  if (origin && data.length > history.length) Object.assign(data[history.length - 1], { median: +origin.value.toFixed(2), base: origin.value, lo: 0, mid: 0, hi: 0 });
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="chart">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--rule)" }} minTickGap={24} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} />
            <Tooltip
              contentStyle={{ background: "var(--sheet)", border: "1px solid var(--rule)", fontSize: 12 }}
              formatter={(value, name, item) => {
                const p = item?.payload as { p10?: number; p90?: number };
                if (name === "median") return [`${Number(value).toFixed(1)} (80%: ${p.p10?.toFixed(1)}–${p.p90?.toFixed(1)})`, "Projection"];
                if (name === "hist") return [Number(value).toFixed(1), "Observed"];
                return [null, null];
              }}
            />
            {origin ? <ReferenceLine x={origin.year} stroke="var(--faint)" strokeDasharray="3 3" /> : null}
            <ReferenceLine y={100} stroke="var(--faint)" strokeWidth={0.5} />
            <Area dataKey="base" stackId="b" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="lo" stackId="b" stroke="none" fill={v.b80} isAnimationActive={false} />
            <Area dataKey="mid" stackId="b" stroke="none" fill={v.b50} isAnimationActive={false} />
            <Area dataKey="hi" stackId="b" stroke="none" fill={v.b80} isAnimationActive={false} />
            <Line dataKey="hist" stroke="var(--hist)" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="median" stroke={v.line} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="chart-legend">
        <span><i style={{ background: "var(--hist)", height: 2 }} />Observed (real, {origin?.year ?? "origin"} = 100)</span>
        <span><i style={{ background: v.line, height: 2 }} />Median projection</span>
        <span><i style={{ background: v.b50 }} />50% band</span>
        <span><i style={{ background: v.b80 }} />80% band</span>
      </figcaption>
    </figure>
  );
}
