"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { FanChart } from "./fan-chart";
import { SeriesChart } from "./series-chart";
import { NarrativeProse, type ProseSource } from "./narrative-prose";
import { DriversChart, type DriverBreakdown } from "./drivers-chart";
import { rewriteRateSection } from "../../lib/engine/narrative.js";
import { shiftBand, monthlyPayment, type Band, type SensMap } from "@/lib/toggle";
import { scorePersona, shiftComponents } from "../../lib/engine/indexes.js";
import { TYPE_LABELS, PERSONA_ORDER, pct, money, fmt } from "@/lib/labels";

type Point = { year: number; value: number };
type PersonaSpec = { label: string; question: string; components: { key: string; weight: number; direction: number; label: string }[] };

export type ExplorerProps = {
  name: string;
  history: { price: Point[]; rent: Point[]; types: Record<string, Point[]> };
  bands: { real_price: Band[]; nominal_price: Band[]; real_rent: Band[]; nominal_rent: Band[]; types: Record<string, Band[]> };
  methods: { price10: string; rent10: string };
  sens: { real_price?: SensMap; real_rent?: SensMap; type_price?: SensMap };
  sensNotes: { price: string; rent: string; priceValid: boolean };
  sensScope?: string;
  rates: { policy: number | null; policyAsOf: string | null; mortgage: number | null; mortgageSource: string | null };
  personas: { specs: Record<string, PersonaSpec>; components: Record<string, number | null>; distributions: Record<string, number[]>; base: Record<string, number | null> };
  calculator: { price: number | null; priceLabel: string | null; rent: number | null; rentLabel: string | null };
  narrative?: { sections: { id: string; title: string; paragraphs: string[]; chart: string | null; sources?: ProseSource[] }[] };
  drivers?: DriverBreakdown | null;
  countryName?: string;
  rateInput?: { name: string; rates: { policy: number | null; mortgage: number | null } };
  labourSeries?: { name: string; color: string; points: { period: string; value: number }[] }[];
  live?: { asOf: string; items: { kind: string; text: string }[] } | null;
  signals?: Record<string, { label: string; level: number; adjusted: boolean; support: string[]; oppose: string[] }>;
  signalDisclaimer?: string;
  regions?: { slug: string; name: string }[];
  iso3?: string;
};

const PRESETS = [
  { label: "Deep cuts", value: -2 },
  { label: "Cuts", value: -1 },
  { label: "Hold", value: 0 },
  { label: "Hikes", value: 1 },
  { label: "Shock", value: 2 },
];

const at = (rows: Band[], h: number) => rows.find((r) => r.horizon === h);

export function CountryExplorer(p: ExplorerProps) {
  const [delta, setDelta] = useState(0);
  const [nominal, setNominal] = useState(false);
  const typeKeys = Object.keys(p.bands.types);
  const [type, setType] = useState(typeKeys[0] ?? "");
  const [price, setPrice] = useState(p.calculator.price ? String(Math.round(p.calculator.price)) : "");
  const [rent, setRent] = useState(p.calculator.rent ? String(Math.round(p.calculator.rent)) : "");
  const [down, setDown] = useState("20");
  const [term, setTerm] = useState("25");

  const priceSens = p.sensNotes.priceValid ? p.sens.real_price : undefined;
  const priceBands = useMemo(() => shiftBand(nominal ? p.bands.nominal_price : p.bands.real_price, priceSens, delta), [nominal, p.bands, priceSens, delta]);
  const rentBands = useMemo(() => shiftBand(nominal ? p.bands.nominal_rent : p.bands.real_rent, p.sens.real_rent, delta), [nominal, p.bands, p.sens.real_rent, delta]);
  const typeBands = useMemo(() => shiftBand(p.bands.types[type] ?? [], p.sensNotes.priceValid ? p.sens.type_price : undefined, delta), [p.bands.types, type, p.sens.type_price, p.sensNotes.priceValid, delta]);

  // Persona indexes recomputed for this country's components at the chosen rate.
  const sensForIndex = {
    real_price: priceSens ? { 3: priceSens[3]?.coef, 10: priceSens[10]?.coef } : undefined,
    real_rent: p.sens.real_rent ? { 10: p.sens.real_rent[10]?.coef } : undefined,
  };
  const shifted = shiftComponents(p.personas.components, delta, sensForIndex, p.rates.mortgage);
  const scores = Object.fromEntries(PERSONA_ORDER.map((k) => [k, scorePersona(k, shifted, p.personas.distributions).score]));

  // Buy vs rent: nominal paths applied to today's local-currency price and rent.
  const nominalPrice = shiftBand(p.bands.nominal_price, priceSens, delta);
  const nominalRent = shiftBand(p.bands.nominal_rent, p.sens.real_rent, delta);
  const rate = (p.rates.mortgage ?? 0) + delta;
  const homePrice = Number(price), monthlyRent = Number(rent);
  const calcRows = [0, 1, 3, 5, 10].map((h) => {
    const pi = h === 0 ? 100 : at(nominalPrice, h)?.median, ri = h === 0 ? 100 : at(nominalRent, h)?.median;
    const projPrice = pi && homePrice ? (homePrice * pi) / 100 : null;
    return {
      h, projPrice,
      payment: projPrice ? monthlyPayment(projPrice, Number(down) || 0, rate, Number(term) || 25) : null,
      rent: ri && monthlyRent ? (monthlyRent * ri) / 100 : null,
    };
  });

  const p10 = at(priceBands, 10), r10 = at(rentBands, 10), p3 = at(priceBands, 3);
  // The same horizons at current rates, to show what the toggle changed.
  const base = (rows: Band[], h: number) => at(rows, h)?.median;
  const bp10 = base(nominal ? p.bands.nominal_price : p.bands.real_price, 10), bp3 = base(nominal ? p.bands.nominal_price : p.bands.real_price, 3);
  const br10 = base(nominal ? p.bands.nominal_rent : p.bands.real_rent, 10);
  const moved = (now?: number, was?: number) => (delta && now != null && was != null ? <span className={`delta-chip ${now - was < 0 ? "neg" : "pos"}`}>{now - was > 0 ? "+" : ""}{(now - was).toFixed(1)} pts vs current rates</span> : null);
  const unit = nominal ? "nominal" : "real (after inflation)";

  // Rate prose rewritten live for the chosen rate path.
  const ratePara = useMemo(() => {
    if (!delta || !p.rateInput) return null;
    const pct10 = (rows: Band[], h: number) => { const r = at(rows, h); return r ? r.median - 100 : NaN; };
    const realP = shiftBand(p.bands.real_price, priceSens, delta), realR = shiftBand(p.bands.real_rent, p.sens.real_rent, delta);
    return rewriteRateSection(p.rateInput, delta, {
      price10: pct10(realP, 10), price3: pct10(realP, 3), basePrice10: pct10(p.bands.real_price, 10), basePrice3: pct10(p.bands.real_price, 3),
      rent10: p.bands.real_rent.length ? pct10(realR, 10) : NaN, baseRent10: p.bands.real_rent.length ? pct10(p.bands.real_rent, 10) : NaN,
    }) as string[] | null;
  }, [delta, p.rateInput, p.bands, priceSens, p.sens.real_rent]);

  const toggleBlock = (
    <div className="toggle" aria-labelledby="rate-heading">
      <div className="section-title" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">Interest-rate toggle</p>
          <h2 id="rate-heading" className="display" style={{ fontSize: 22, margin: "2px 0 0", color: "#fff" }}>What if rates move?</h2>
        </div>
        <p>
          Policy rate {p.rates.policy != null ? `${fmt(p.rates.policy, 2)}%` : "n/a"}{p.rates.policyAsOf ? ` (${p.rates.policyAsOf})` : ""}, mortgage rate{" "}
          {p.rates.mortgage != null ? `${fmt(p.rates.mortgage, 2)}%` : "n/a"} {p.rates.mortgageSource ? `(${p.rates.mortgageSource})` : ""}
        </p>
      </div>
      <div className="toggle__row">
        <span className="toggle__value num">{delta > 0 ? "+" : ""}{delta.toFixed(2)} pp</span>
        <input type="range" min={-3} max={3} step={0.25} value={delta} onChange={(e) => setDelta(Number(e.target.value))} aria-label="Change in interest rates, percentage points" />
      </div>
      <div className="chips" role="group" aria-label="Rate presets" style={{ marginTop: 10 }}>
        {PRESETS.map((pr) => <button key={pr.label} className="chip" aria-pressed={delta === pr.value} onClick={() => setDelta(pr.value)}>{pr.label}</button>)}
      </div>
      <div className="toggle__row" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <div className="chips" role="group" aria-label="Real or nominal">
          <button className="chip" aria-pressed={!nominal} onClick={() => setNominal(false)}>Real (after inflation)</button>
          <button className="chip" aria-pressed={nominal} onClick={() => setNominal(true)}>Nominal</button>
        </div>
      </div>
      <dl className="toggle-readout">
        <div><dt>Real price, 10y</dt><dd className="num">{pct(p10 ? p10.median - 100 : null)} {moved(p10?.median, bp10)}</dd></div>
        <div><dt>Real price, 3y</dt><dd className="num">{pct(p3 ? p3.median - 100 : null)} {moved(p3?.median, bp3)}</dd></div>
        {rentBands.length ? <div><dt>Real rent, 10y</dt><dd className="num">{pct(r10 ? r10.median - 100 : null)} {moved(r10?.median, br10)}</dd></div> : null}
      </dl>
      <p className="note" style={{ marginTop: 10 }}>A sustained move of this size from today, applied to this country&apos;s model-implied sensitivity. {p.sensScope} Bands widen with the sensitivity&apos;s uncertainty.</p>
      {!p.sensNotes.priceValid ? <p className="disabled-note" style={{ marginTop: 12 }}>The rate effect on prices is switched off this run: {p.sensNotes.price}</p> : null}
    </div>
  );

  const priceBlock = (
    <div className="panel">
      <p className="eyebrow">Buy</p>
      <h3 className="display" style={{ margin: "4px 0 2px", fontSize: 19, color: "var(--line)" }}>House prices, 10-year outlook</h3>
      <p className="note">10-year {unit} change: <strong className={p10 && p10.median >= 100 ? "pos" : "neg"}>{pct(p10 ? p10.median - 100 : null)}</strong> {moved(p10?.median, bp10)} (80% range {pct(p10 ? p10.p10 - 100 : null)} to {pct(p10 ? p10.p90 - 100 : null)}), 3-year {pct(p3 ? p3.median - 100 : null)} {moved(p3?.median, bp3)}</p>
      {priceBands.length ? <FanChart history={p.history.price} bands={priceBands} color="price" label={`${p.name} house price projection`} /> : <p className="empty">No price projection.</p>}
      <p className="note">10-year method: {p.methods.price10}</p>
    </div>
  );

  const rentBlock = (
    <div className="panel">
      <p className="eyebrow">Rent</p>
      <h3 className="display" style={{ margin: "4px 0 2px", fontSize: 19, color: "var(--rent)" }}>Rents, 10-year outlook</h3>
      {rentBands.length ? (
        <>
          <p className="note">10-year {unit} change: <strong>{pct(r10 ? r10.median - 100 : null)}</strong> {moved(r10?.median, br10)} (80% range {pct(r10 ? r10.p10 - 100 : null)} to {pct(r10 ? r10.p90 - 100 : null)})</p>
          <FanChart history={p.history.rent} bands={rentBands} color="rent" label={`${p.name} rent projection`} />
          <p className="note">10-year method: {p.methods.rent10}. {p.sensNotes.rent}</p>
        </>
      ) : <div className="empty"><h2>No rent index</h2><p>This country publishes no rent price index in the OECD dataset, so rents are not projected.</p></div>}
    </div>
  );

  const typesBlock = typeKeys.length ? (
    <div className="panel">
      <div className="chips" role="group" aria-label="Dwelling type">
        {typeKeys.map((t) => <button key={t} className="chip" aria-pressed={type === t} onClick={() => setType(t)}>{TYPE_LABELS[t] ?? t}</button>)}
      </div>
      <div style={{ marginTop: 12 }}>
        {typeBands.length ? <FanChart history={p.history.types[type] ?? []} bands={typeBands} color="price" label={`${TYPE_LABELS[type]} projection`} /> : null}
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Type</th><th className="r">Last 5y</th><th className="r">3-year</th><th className="r">5-year</th><th className="r">10-year</th></tr></thead>
          <tbody>
            {typeKeys.map((t) => {
              const rows = shiftBand(p.bands.types[t], p.sensNotes.priceValid ? p.sens.type_price : undefined, delta);
              const hist = p.history.types[t] ?? [];
              const past = hist.length > 5 ? hist.at(-1)!.value / hist.at(-6)!.value * 100 - 100 : null;
              return (
                <tr key={t}>
                  <td>{TYPE_LABELS[t] ?? t}</td>
                  <td className="r">{pct(past)}</td>
                  {[3, 5, 10].map((h) => <td key={h} className="r">{pct(at(rows, h) ? at(rows, h)!.median - 100 : null)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">Real price change, median projection, at the chosen rate.</p>
    </div>
  ) : null;

  const regionsBlock = p.regions?.length ? (
    <div className="panel">
      <p className="eyebrow">Cities and regions</p>
      <div className="chips" style={{ marginTop: 8 }}>{p.regions.map((r) => <Link key={r.slug} className="chip" href={`/countries/${p.iso3}/${r.slug}`}>{r.name}</Link>)}</div>
    </div>
  ) : null;

  const calculatorBlock = (
    <section className="section">
      <div className="section-title">
        <div><p className="eyebrow">Buy vs rent</p><h2>Monthly cost over time</h2></div>
        <p>Enter a home price and rent in local currency. The mortgage rate is held at {fmt(rate, 2)}% for the whole horizon; prices and rents follow the nominal median paths.</p>
      </div>
      <div className="grid-2">
        <div className="panel" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", alignContent: "start" }}>
          <label className="field">Home price<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 650000" /></label>
          <label className="field">Monthly rent<input inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 2400" /></label>
          <label className="field">Down payment %<input inputMode="numeric" value={down} onChange={(e) => setDown(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label className="field">Amortisation (years)<input inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/[^\d]/g, ""))} /></label>
          <p className="note" style={{ gridColumn: "1 / -1", margin: 0 }}>
            {p.calculator.priceLabel ? `Default price: ${p.calculator.priceLabel}. ` : ""}{p.calculator.rentLabel ? `Default rent: ${p.calculator.rentLabel}.` : ""}
            {" "}Payment covers principal and interest only.
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Year</th><th className="r">Home price</th><th className="r">Mortgage / month</th><th className="r">Rent / month</th><th className="r">Owning minus renting</th></tr></thead>
            <tbody>
              {calcRows.map((r) => (
                <tr key={r.h}>
                  <td>{r.h === 0 ? "Today" : `+${r.h}y`}</td>
                  <td className="r">{money(r.projPrice)}</td>
                  <td className="r">{money(r.payment)}</td>
                  <td className="r">{money(r.rent)}</td>
                  <td className="r">{r.payment != null && r.rent != null ? <span className={r.payment > r.rent ? "neg" : "pos"}>{r.payment > r.rent ? "+" : ""}{money(r.payment - r.rent)}</span> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!p.bands.nominal_rent.length ? <p className="note" style={{ padding: "0 12px 10px" }}>No rent projection for this country; the rent column stays flat at today&apos;s figure only if you enter one.</p> : null}
        </div>
      </div>
    </section>
  );

  const personasBlock = (
    <div className="grid-2">
      {PERSONA_ORDER.map((k) => {
        const spec = p.personas.specs[k], s = scores[k], base = p.personas.base[k];
        const d = s != null && base != null ? s - base : null;
        return (
          <article key={k} className="persona-card">
            <h3>{spec?.label} index</h3>
            <div className="score num">{s == null ? "–" : s.toFixed(0)}</div>
            {d != null && Math.abs(d) >= 0.5 ? <div className={`delta ${d > 0 ? "pos" : "neg"}`}>{d > 0 ? "+" : ""}{d.toFixed(1)} vs current rates</div> : <div className="delta" style={{ color: "var(--faint)" }}>at current rates</div>}
            <div className="meter"><i style={{ width: `${s ?? 0}%` }} /></div>
            <p>{spec?.question}</p>
          </article>
        );
      })}
    </div>
  );

  const signalsBlock = p.signals && Object.keys(p.signals).length ? (
    <div className="grid-2">
      {(["buyer", "seller", "investor", "renter"] as const).map((k) => {
        const sg = p.signals![k];
        if (!sg) return null;
        return (
          <article key={k} className="persona-card">
            <h3>{k[0].toUpperCase() + k.slice(1)} signal</h3>
            <div className={`score ${sg.level > 0 ? "pos" : sg.level < 0 ? "neg" : ""}`} style={{ fontSize: 22 }}>{sg.label}</div>
            {sg.adjusted ? <p className="delta" style={{ color: "var(--gold)" }}>Adjusted for labour-market and mortgage stress</p> : null}
            <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 12.5 }}>
              {sg.support.map((r) => <li key={r}>{r}</li>)}
              {sg.oppose.map((r) => <li key={r} style={{ color: "var(--muted)" }}>But: {r}</li>)}
            </ul>
          </article>
        );
      })}
    </div>
  ) : null;

  const labourBlock = p.labourSeries?.length ? (
    <div className="panel">
      <p className="eyebrow">Unemployment and household debt service</p>
      <SeriesChart series={p.labourSeries} unit="%" label={`${p.name} unemployment and debt service history`} />
      <p className="note">Unemployment (OECD monthly or IMF annual) and household debt service as a share of income (BIS).</p>
    </div>
  ) : null;

  const liveBlock = p.live && p.live.items.length ? (
    <div className="live-banner">
      <div className="live-banner__head">
        <p className="eyebrow"><span className="live-dot" aria-hidden="true" />Live adjustments, {p.live.asOf}</p>
        <Link className="link" href="/live">What changed today</Link>
      </div>
      <ul>{p.live.items.map((e, i) => <li key={i}><span className={`badge ${e.kind === "event" ? "badge--flag" : ""}`}>{e.kind === "event" ? "Event" : e.kind === "rate" ? "Rates" : e.kind.charAt(0).toUpperCase() + e.kind.slice(1)}</span> {e.text}</li>)}</ul>
      <p className="note">Charts, the buy-vs-rent table and index scores include these adjustments; the rate toggle moves on top of them.</p>
    </div>
  ) : null;

  const charts: Record<string, ReactNode> = {
    price: priceBlock,
    rent: rentBlock,
    rates: toggleBlock,
    labour: labourBlock,
    types: <div style={{ display: "grid", gap: 16 }}>{typesBlock}{regionsBlock}</div>,
    live: liveBlock,
    drivers: p.drivers ? <DriversChart d={p.drivers} name={p.countryName ?? "This market"} /> : null,
    signals: <div style={{ display: "grid", gap: 16 }}>{signalsBlock}{personasBlock}{p.signalDisclaimer ? <p className="note">{p.signalDisclaimer}</p> : null}</div>,
  };

  if (p.narrative?.sections.length) {
    const ids = new Set(p.narrative.sections.map((s) => s.id));
    return (
      <>
        {!ids.has("rates") ? <section className="section">{toggleBlock}</section> : null}
        {p.narrative.sections.map((sec) => {
          const chart = sec.chart ? charts[sec.chart] : null;
          const paragraphs = sec.id === "rates" && ratePara ? [...ratePara, ...sec.paragraphs] : sec.paragraphs;
          return (
            <div key={sec.id}>
              <section className={`section brief-section${chart ? "" : " brief-section--full"}`} id={`brief-${sec.id}`}>
                <NarrativeProse title={sec.title} paragraphs={paragraphs} sources={sec.sources} />
                {chart ? <div className="brief-section__chart">{chart}</div> : null}
              </section>
              {sec.id === "rents" ? calculatorBlock : null}
            </div>
          );
        })}
        {!ids.has("types") && typesBlock ? <section className="section">{typesBlock}</section> : null}
        {!ids.has("outlook") ? <section className="section">{personasBlock}</section> : null}
      </>
    );
  }

  return (
    <>
      <section className="section">{toggleBlock}</section>
      <section className="section grid-2">{priceBlock}{rentBlock}</section>
      {typesBlock ? <section className="section">{typesBlock}</section> : null}
      {calculatorBlock}
      <section className="section">{personasBlock}</section>
    </>
  );
}
