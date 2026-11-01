"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", key: "O" },
  { href: "/live", label: "Live", key: "L" },
  { href: "/countries", label: "Countries", key: "C" },
  { href: "/indexes", label: "Indexes", key: "I" },
  { href: "/compare", label: "Compare", key: "V" },
  { href: "/ask", label: "Ask AI", key: "A" },
  { href: "/methodology", label: "Methodology", key: "M" },
  { href: "/quality", label: "Data quality", key: "Q" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "page" : undefined}><span aria-hidden="true">{l.key}</span>{l.label}</Link>
      ))}
    </nav>
  );
}
