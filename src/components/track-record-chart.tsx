"use client";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

type Point = { predicted: number; actual: number; label?: string };

const tooltipStyle = { background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 8, fontSize: 12 };

// Predicted vs actual (% change). Points on the diagonal were forecast exactly.
export function PredictedActualScatter({ points, label }: { points: Point[]; label: string }) {
  const lim = Math.ceil(Math.max(5, ...points.flatMap((p) => [Math.abs(p.predicted), Math.abs(p.actual)])) / 5) * 5;
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="chart" style={{ height: 320 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" />
            <XAxis type="number" dataKey="predicted" name="Projected" unit="%" domain={[-lim, lim]} tick={{ fill: "var(--muted)", fontSize: 11 }} label={{ value: "Projected change", position: "insideBottom", offset: -10, fill: "var(--muted)", fontSize: 12 }} />
            <YAxis type="number" dataKey="actual" name="Actual" unit="%" domain={[-lim, lim]} tick={{ fill: "var(--muted)", fontSize: 11 }} width={52} />
            <ZAxis range={[22, 22]} />
            <ReferenceLine segment={[{ x: -lim, y: -lim }, { x: lim, y: lim }]} stroke="var(--faint)" strokeDasharray="4 4" />
            <ReferenceLine x={0} stroke="var(--rule)" />
            <ReferenceLine y={0} stroke="var(--rule)" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} labelFormatter={() => ""} />
            <Scatter data={points} fill="var(--line)" fillOpacity={0.55} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="chart-legend"><span><i style={{ background: "var(--line)" }} />One country at one forecast date</span><span>Dashed line: a perfect forecast</span></figcaption>
    </figure>
  );
}

// One country's 1-year projections against what happened, by forecast date.
export function PredictedActualLine({ points, label }: { points: { origin: number; predicted: number; actual: number }[]; label: string }) {
  const data = points.map((p) => ({ year: p.origin + 1, Projected: +p.predicted.toFixed(2), Actual: +p.actual.toFixed(2) }));
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="chart" style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} minTickGap={20} />
            <YAxis unit="%" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <ReferenceLine y={0} stroke="var(--faint)" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="Actual" stroke="var(--hist)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            <Line dataKey="Projected" stroke="var(--line)" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
