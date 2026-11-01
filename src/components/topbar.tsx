"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  "": "Overview", live: "Live", countries: "Countries", indexes: "Indexes", compare: "Compare", scenario: "Scenarios",
  "track-record": "Track record", ask: "Ask AI", methodology: "Methodology", quality: "Data quality", "api-docs": "API and MCP",
};

// Breadcrumb, live status and actions, styled like the Global Economic Intelligence top bar.
export function Topbar() {
  const path = usePathname();
  // The prerendered home page can report "/index"; it is the overview.
  const parts = path.split("/").filter((p) => p && p !== "index");
  const crumbs = parts.length ? parts.map((p, i) => (i === 0 ? LABELS[p] ?? p : p.toUpperCase().length <= 3 ? p.toUpperCase() : p.replace(/-/g, " "))) : ["Overview"];
  return (
    <div className="topbar">
      <div className="topbar__crumbs">
        <Link href="/">Housing</Link>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}><span aria-hidden="true">/</span>{i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}</span>
        ))}
      </div>
      <div className="topbar__actions">
        <span className="topbar__status"><i aria-hidden="true" />Live adjustments · updated daily</span>
        <Link className="topbar__btn" href="/api-docs">API</Link>
        <Link className="topbar__btn" href="/compare">Compare</Link>
        <Link className="topbar__btn topbar__btn--primary" href="/ask">Ask AI</Link>
      </div>
    </div>
  );
}
