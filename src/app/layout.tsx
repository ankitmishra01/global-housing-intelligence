import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Global Housing Intelligence", template: "%s · Global Housing Intelligence" },
  description: "House prices and rents for every economy, with honestly backtested 10-year projections, an interest-rate toggle and indexes for investors, buyers, renters and sellers.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="masthead">
          <Link href="/" className="brand">
            <span className="brand__mark">GHI</span>
            <span><strong>Global Housing Intelligence</strong><small>prices · rents · 10-year outlook</small></span>
          </Link>
          <Nav />
        </header>
        <main id="main">{children}</main>
        <footer className="foot">
          Sources: BIS, OECD, IMF World Economic Outlook, World Bank, CMHC and Statistics Canada, Bank of Canada, US Census Bureau, BLS and Freddie Mac via FRED,
          Zillow Research, HM Land Registry, Australian Bureau of Statistics. Projections are statistical estimates with published error rates, not financial advice.{" "}
          <Link className="link" href="/methodology">Methodology</Link>
        </footer>
      </body>
    </html>
  );
}
