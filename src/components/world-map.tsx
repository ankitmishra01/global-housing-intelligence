import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import countries from "i18n-iso-countries";
import world from "world-atlas/countries-110m.json";
import Link from "next/link";

// Server-rendered choropleth in stepped classes. The breaks follow the spread of the data
// (evenly spaced across the middle 80% of rises, in round steps) so the map separates markets even when every
// projection is positive; any projected fall gets its own red class. Countries without data stay grey.
export function mapClasses(values: number[]) {
  const rises = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const q = (p: number) => rises[Math.min(rises.length - 1, Math.floor(p * rises.length))];
  // Four evenly spaced breaks across the 10th to 90th percentile, in round steps of 5 or 10.
  let breaks = [10, 20, 30, 40];
  if (rises.length >= 5) {
    const lo = q(0.1), hi = q(0.9);
    const step = Math.max(5, Math.round((hi - lo) / 4 / 5) * 5);
    const start = Math.max(step, Math.round(lo / step) * step);
    breaks = [0, 1, 2, 3].map((i) => start + i * step);
  }
  const classes: { from: number | null; to: number | null; color: string; label: string }[] = [];
  if (values.some((v) => v < 0)) classes.push({ from: null, to: 0, color: "var(--map-fall)", label: "Fall" });
  const edges = [0, ...breaks];
  edges.forEach((from, i) => {
    const to = edges[i + 1] ?? null;
    classes.push({ from, to, color: `var(--map-${i + 1})`, label: to == null ? `+${from}% or more` : `+${from} to ${to}%` });
  });
  return classes;
}

export function WorldMap({ values, names, label }: { values: Record<string, number>; names: Record<string, string>; label: string }) {
  const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries);
  const projection = geoEqualEarth().fitSize([960, 470], fc);
  // One decimal is sub-pixel at this viewBox and cuts the path data (HTML and RSC payload) by about half.
  const path = geoPath(projection).digits(1);
  const classes = mapClasses(Object.values(values));
  const color = (v: number | undefined) => {
    if (v == null) return "var(--map-empty)";
    const c = classes.find((k) => (k.from == null || v >= k.from) && (k.to == null || v < k.to));
    return c?.color ?? "var(--map-empty)";
  };
  return (
    <figure className="map" style={{ margin: 0 }}>
      <svg viewBox="0 0 960 470" role="img" aria-label={label}>
        {fc.features.map((f, i) => {
          const iso3 = countries.numericToAlpha3(String(f.id).padStart(3, "0"));
          const v = iso3 ? values[iso3] : undefined;
          const d = path(f) ?? "";
          const title = `${(iso3 && names[iso3]) || f.properties?.name}: ${v == null ? "no house price index" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}`;
          return v != null && iso3 ? (
            <Link key={i} href={`/countries/${iso3}`}><path d={d} fill={color(v)}><title>{title}</title></path></Link>
          ) : (
            <path key={i} d={d} fill={color(undefined)}><title>{title}</title></path>
          );
        })}
      </svg>
      <figcaption className="map-legend">
        {classes.map((k) => <span key={k.label}><i style={{ background: k.color }} />{k.label}</span>)}
        <span><i style={{ background: "var(--map-empty)" }} />No official price index</span>
      </figcaption>
    </figure>
  );
}
