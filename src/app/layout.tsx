import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { Topbar } from "@/components/topbar";
import { RatesTicker } from "@/components/rates-ticker";
import "./globals.css";
import "./brand.css";

// Brand shared with Global Economic Intelligence: Geist for reading and figures, Geist Mono for labels and data.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Global Housing Intelligence", template: "%s · Global Housing Intelligence" },
  description: "House prices and rents for every economy, with honestly backtested 10-year projections, an interest-rate toggle and indexes for investors, buyers, renters and sellers.",
  alternates: { types: { "application/rss+xml": [{ url: "/feed.xml", title: "Global Housing Intelligence: live changes" }] } },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} style={{ ["--font-display" as string]: "var(--font-sans)" }}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="shell">
          <aside className="rail">
            <Link href="/" className="rail__brand">
              <span className="rail__mark">GHI</span>
              <span>
                <span className="rail__title">Housing <span className="rail__live">LIVE</span></span>
                <span className="rail__sub">Global Housing Intelligence</span>
              </span>
            </Link>
            <div className="rail__label">Browse</div>
            <Nav />
            <div className="rail__foot">
              217 economies · BIS, OECD, IMF, World Bank and national housing agencies. Estimates with published error rates, not advice.
            </div>
          </aside>
          <div className="shell__main">
            <Topbar />
            <RatesTicker />
            <main id="main">{children}</main>
            <footer className="foot">
              Sources: BIS, OECD, IMF World Economic Outlook, World Bank, CMHC and Statistics Canada, Bank of Canada, US Census Bureau, BLS and Freddie Mac via FRED,
              Zillow Research, HM Land Registry, Australian Bureau of Statistics, and Dubai Real Estate Data (dubairealestatedata.com), based on Dubai Land Department open data (CC BY 4.0). Projections are statistical estimates with published error rates, not financial advice.{" "}
              <Link className="link" href="/methodology">Methodology</Link> · Sister site: <a className="link" href="https://g20-gamma.vercel.app">Global Economic Intelligence</a>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
