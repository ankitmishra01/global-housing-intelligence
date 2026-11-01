"use client";

export function PrintButton() {
  return <button type="button" className="button no-print" onClick={() => window.print()}>Print or save as PDF</button>;
}
