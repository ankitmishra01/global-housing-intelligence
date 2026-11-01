"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/countries", label: "Countries" },
  { href: "/indexes", label: "Indexes" },
  { href: "/compare", label: "Compare" },
  { href: "/ask", label: "Ask AI" },
  { href: "/methodology", label: "Methodology" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "page" : undefined}>{l.label}</Link>
      ))}
    </nav>
  );
}
