import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import countries from "i18n-iso-countries";
import world from "world-atlas/countries-110m.json";
import Link from "next/link";

// Server-rendered choropleth. Values are % changes: rises shade toward deep cobalt, falls
// toward crimson, clamped at ±maxAbs. Countries without data stay grey.
export function WorldMap({ values, names, maxAbs = 40, label }: { values: Record<string, number>; names: Record<string, string>; maxAbs?: number; label: string }) {
  const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries);
  const projection = geoEqualEarth().fitSize([960, 470], fc);
  const path = geoPath(projection);
  const color = (v: number | undefined) => {
    if (v == null) return "var(--map-empty)";
    const t = Math.max(-1, Math.min(1, v / maxAbs));
    const pctMix = Math.round(Math.abs(t) * 100);
    return `color-mix(in oklab, ${t < 0 ? "var(--map-lo)" : "var(--map-hi)"} ${pctMix}%, var(--map-mid))`;
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
      <figcaption className="map-scale"><span>{-maxAbs}% or lower</span><i /><span>+{maxAbs}% or higher</span><span style={{ marginLeft: 12 }}>Grey: no official price index</span></figcaption>
    </figure>
  );
}
