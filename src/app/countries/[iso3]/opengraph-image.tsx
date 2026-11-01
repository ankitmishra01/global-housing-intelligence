import { ImageResponse } from "next/og";
import { applyLive, country, liveShifts, projections } from "@/lib/data";

export const alt = "Global Housing Intelligence country outlook";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (global-economic-intelligence): near-black chrome, white sheet, blue prices, teal rents.
const INK = "#0a0a0a", CANVAS = "#f4f4f1", PRICE = "#1e40af", RENT = "#0f766e", MUTED = "#565656";

export default async function Image({ params }: { params: Promise<{ iso3: string }> }) {
  const iso3 = (await params).iso3.toUpperCase();
  const [c, proj, shiftsAll] = await Promise.all([country(iso3), projections(iso3), liveShifts(iso3)]);
  const at = (t: string) => {
    const row = proj.find((p) => p.target === t && Number(p.horizon) === 10);
    return row ? applyLive([row], shiftsAll[iso3]?.[t])[0] : null;
  };
  const price = at("real_price"), rent = at("real_rent");
  const fmt = (v: number | undefined) => (v == null ? "–" : `${v - 100 > 0 ? "+" : ""}${(v - 100).toFixed(0)}%`);
  const stat = (label: string, b: ReturnType<typeof at>, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "28px 32px", background: "#ffffff", borderRadius: 18, borderTop: `8px solid ${color}` }}>
      <div style={{ fontSize: 26, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 96, fontWeight: 800, color, lineHeight: 1.05 }}>{fmt(b?.median)}</div>
      <div style={{ fontSize: 24, color: MUTED }}>{b ? `80% range ${fmt(b.p10)} to ${fmt(b.p90)}` : "Not projected"}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: CANVAS, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "30px 48px", background: INK, color: "#ffffff" }}>
          <div style={{ display: "flex", width: 56, height: 56, borderRadius: 10, background: "#ffffff", color: INK, alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 }}>GHI</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Global Housing Intelligence</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "36px 48px 0" }}>
          <div style={{ fontSize: 30, color: PRICE, fontWeight: 700 }}>10-year housing outlook, after inflation</div>
          <div style={{ fontSize: 84, fontWeight: 800, color: INK, lineHeight: 1.05 }}>{c?.name ?? iso3}</div>
        </div>
        <div style={{ display: "flex", gap: 24, padding: "28px 48px" }}>
          {stat("House prices", price, PRICE)}
          {stat("Rents", rent, RENT)}
        </div>
      </div>
    ),
    size,
  );
}
