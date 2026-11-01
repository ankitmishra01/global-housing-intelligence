export const TYPE_LABELS: Record<string, string> = {
  house: "Houses (single-family)",
  detached: "Detached",
  semi_detached: "Semi-detached",
  townhouse: "Townhouse / terraced / row",
  condo: "Condos / flats / apartments",
};

export const PERSONA_ORDER = ["investor", "buyer", "renter", "seller"] as const;

export const TARGET_LABELS: Record<string, string> = {
  real_price: "Real house prices",
  nominal_price: "Nominal house prices",
  real_rent: "Real rents",
  nominal_rent: "Nominal rents",
  price_to_rent: "Price-to-rent ratio",
};

export const pct = (v: number | null | undefined, digits = 1, signed = true) =>
  v == null || !Number.isFinite(v) ? "–" : `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

// Index (origin = 100) to percentage change.
export const fromIndex = (index: number | null | undefined) => (index == null ? null : index - 100);

export const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const money = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("en");

export const flagEmoji = (iso2: string | null | undefined) =>
  iso2 && /^[A-Z]{2}$/.test(iso2) ? String.fromCodePoint(...[...iso2].map((c) => 127397 + c.charCodeAt(0))) : "";

export const EVENT_LABELS: Record<string, string> = {
  armed_conflict: "Armed conflict",
  regional_conflict: "Regional conflict spillover",
  natural_disaster: "Natural disaster",
  currency_crisis: "Currency crisis",
  transaction_slump: "Sales slump",
};
