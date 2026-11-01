import { ImageResponse } from "next/og";

export const alt = "Global Housing Intelligence: house prices and rents, 10 years out";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", color: "#ffffff", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", width: 72, height: 72, borderRadius: 12, background: "#ffffff", color: "#0a0a0a", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800 }}>GHI</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>Global Housing Intelligence</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.02 }}>Where house prices and rents go next</div>
          <div style={{ fontSize: 32, color: "rgba(245,245,242,.62)", marginTop: 18 }}>217 economies · backtested 10-year projections · rate toggle · live adjustments</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ display: "flex", height: 12, flex: 3, background: "#1e40af", borderRadius: 6 }} />
          <div style={{ display: "flex", height: 12, flex: 2, background: "#0f766e", borderRadius: 6 }} />
          <div style={{ display: "flex", height: 12, flex: 1, background: "#f5f5f2", borderRadius: 6 }} />
        </div>
      </div>
    ),
    size,
  );
}
