import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import "./globals.css";

// One family in two widths: expanded and heavy for headings and figures, normal for reading.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Global Housing Intelligence", template: "%s · Global Housing Intelligence" },
  description: "House prices and rents for every economy, with honestly backtested 10-year projections, an interest-rate toggle and indexes for investors, buyers, renters and sellers.",
  alternates: { types: { "application/rss+xml": [{ url: "/feed.xml", title: "Global Housing Intelligence: live changes" }] } },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable} style={{ ["--font-display" as string]: "var(--font-sans)" }}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="masthead">
          <Link href="/" className="brand">
            <span className="brand__mark">GHI</span>
            <span><strong>Global Housing Intelligence</strong><small>House prices and rents, 10 years out</small></span>
          </Link>
          <span className="masthead__live"><i aria-hidden="true" />Live adjustments update daily</span>
        </header>
        <div className="shell">
          <aside className="rail">
            <Nav />
            <div className="rail__foot">
              <p>217 economies · BIS, OECD, IMF, World Bank and national housing agencies.</p>
              <p>Projections are estimates with published error rates, not advice.</p>
            </div>
          </aside>
          <div className="shell__main">
        <main id="main">{children}</main>
        <footer className="foot">
          Sources: BIS, OECD, IMF World Economic Outlook, World Bank, CMHC and Statistics Canada, Bank of Canada, US Census Bureau, BLS and Freddie Mac via FRED,
          Zillow Research, HM Land Registry, Australian Bureau of Statistics, and Dubai Real Estate Data (dubairealestatedata.com), based on Dubai Land Department open data (CC BY 4.0). Projections are statistical estimates with published error rates, not financial advice.{" "}
          <Link className="link" href="/methodology">Methodology</Link>
        </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
