// Waterfall-style bars for the ten-year projection: the pooled starting point, the long-run
// trend share (blends only) and each driver's contribution, in percentage points.
export type DriverShare = { name: string; value: number; typical: number; contribution: number };
export type DriverBreakdown = { totalPct: number; base: number; anchor: number; weight: number; features: DriverShare[] };

const SHORT: Record<string, string> = {
  "own 1y real growth": "Last year's real price growth",
  "own 3y average real growth": "Three-year price momentum",
  "price-to-income vs trailing 20 years": "Price to income vs history",
  "price-to-rent vs trailing 20 years": "Price to rent vs history",
  "real policy rate": "Real policy rate",
  "policy rate change": "Policy rate change, 1 year",
  "household credit change (3y)": "Household credit growth, 3 years",
  "credit-to-GDP gap": "Credit-to-GDP gap",
  "population growth": "Population growth",
  "real GDP growth": "Real GDP growth",
  "cross momentum (rent for prices, prices for rents)": "Real rent growth",
  "unemployment change (1y)": "Unemployment change",
  "real wage growth": "Real wage growth",
  "household debt-service gap": "Debt service vs average",
  "real policy rate × household credit": "Real rate × household debt",
};

const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

export function DriversChart({ d, name }: { d: DriverBreakdown; name: string }) {
  const shown = d.features.filter((f) => Math.abs(f.contribution) >= 0.3).slice(0, 8);
  const other = d.totalPct - d.base - d.anchor - shown.reduce((s, f) => s + f.contribution, 0);
  const rows = [
    { label: "Typical market, pooled history", v: d.base, kind: "base" },
    ...(Math.abs(d.anchor) >= 0.1 ? [{ label: `${name}'s long-run trend (${Math.round((1 - d.weight) * 100)}% weight)`, v: d.anchor, kind: "base" }] : []),
    ...shown.map((f) => ({ label: SHORT[f.name] ?? f.name, v: f.contribution, kind: f.contribution >= 0 ? "pos" : "neg" })),
    ...(Math.abs(other) >= 0.05 ? [{ label: "Other drivers", v: other, kind: other >= 0 ? "pos" : "neg" }] : []),
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), Math.abs(d.totalPct), 1);
  return (
    <figure className="drivers-chart" aria-label={`What drives ${name}'s ten-year real price projection`}>
      <figcaption>What drives the 10-year projection <small>percentage points of real price change, before live adjustments</small></figcaption>
      <ul>
        {rows.map((r) => (
          <li key={r.label}>
            <span className="drivers-chart__label">{r.label}</span>
            <span className="drivers-chart__track"><span className={`drivers-chart__bar drivers-chart__bar--${r.kind}`} style={{ width: `${(100 * Math.abs(r.v)) / max}%` }} /></span>
            <span className="drivers-chart__value num">{fmt(r.v)}</span>
          </li>
        ))}
        <li className="drivers-chart__total">
          <span className="drivers-chart__label">Model projection, 10 years</span>
          <span className="drivers-chart__track"><span className="drivers-chart__bar drivers-chart__bar--total" style={{ width: `${(100 * Math.abs(d.totalPct)) / max}%` }} /></span>
          <span className="drivers-chart__value num">{fmt(d.totalPct)}%</span>
        </li>
      </ul>
    </figure>
  );
}
