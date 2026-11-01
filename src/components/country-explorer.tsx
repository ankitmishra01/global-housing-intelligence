"use client";
import { useMemo, useState } from "react";
import { FanChart } from "./fan-chart";
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
  rates: { policy: number | null; policyAsOf: string | null; mortgage: number | null; mortgageSource: string | null };
  personas: { specs: Record<string, PersonaSpec>; components: Record<string, number | null>; distributions: Record<string, number[]>; base: Record<string, number | null> };
  calculator: { price: number | null; priceLabel: string | null; rent: number | null; rentLabel: string | null };
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
  const unit = nominal ? "nominal" : "real (after inflation)";

  return (
    <>
      <section className="section">
        <div className="toggle" aria-labelledby="rate-heading">
          <div className="section-title" style={{ marginBottom: 8 }}>
            <div>
              <p className="eyebrow">Interest-rate toggle</p>
              <h2 id="rate-heading" style={{ font: "400 24px var(--font-display)" }}>What if rates move?</h2>
            </div>
            <p>
              Policy rate {p.rates.policy != null ? `${fmt(p.rates.policy, 2)}%` : "n/a"}{p.rates.policyAsOf ? ` (${p.rates.policyAsOf})` : ""} · mortgage rate{" "}
              {p.rates.mortgage != null ? `${fmt(p.rates.mortgage, 2)}%` : "n/a"} {p.rates.mortgageSource ? `(${p.rates.mortgageSource})` : ""}
            </p>
          </div>
          <div className="toggle__row">
            <span className="toggle__value num">{delta > 0 ? "+" : ""}{delta.toFixed(2)} pp</span>
            <input type="range" min={-3} max={3} step={0.25} value={delta} onChange={(e) => setDelta(Number(e.target.value))} aria-label="Change in interest rates, percentage points" />
            <div className="chips" role="group" aria-label="Rate presets">
              {PRESETS.map((pr) => <button key={pr.label} className="chip" aria-pressed={delta === pr.value} onClick={() => setDelta(pr.value)}>{pr.label}</button>)}
            </div>
          </div>
          <div className="toggle__row" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <div className="chips" role="group" aria-label="Real or nominal">
              <button className="chip" aria-pressed={!nominal} onClick={() => setNominal(false)}>Real (after inflation)</button>
              <button className="chip" aria-pressed={nominal} onClick={() => setNominal(true)}>Nominal</button>
            </div>
            <span className="note">A sustained move of this size from today, applied to the model-implied sensitivity. Bands widen with the sensitivity's uncertainty.</span>
          </div>
          {!p.sensNotes.priceValid ? <p className="disabled-note" style={{ marginTop: 12 }}>The rate effect on prices is switched off this run: {p.sensNotes.price}</p> : null}
        </div>
      </section>

      <section className="section grid-2">
        <div className="panel">
          <p className="eyebrow">Buy</p>
          <h3 style={{ margin: "4px 0 2px", font: "400 22px var(--font-display)" }}>House prices, 10-year outlook</h3>
          <p className="note">10-year {unit} change: <strong className={p10 && p10.median >= 100 ? "pos" : "neg"}>{pct(p10 ? p10.median - 100 : null)}</strong> (80% range {pct(p10 ? p10.p10 - 100 : null)} to {pct(p10 ? p10.p90 - 100 : null)}) · 3-year {pct(p3 ? p3.median - 100 : null)}</p>
          {priceBands.length ? <FanChart history={p.history.price} bands={priceBands} color="price" label={`${p.name} house price projection`} /> : <p className="empty">No price projection.</p>}
          <p className="note">10-year method: {p.methods.price10}</p>
        </div>
        <div className="panel">
          <p className="eyebrow">Rent</p>
          <h3 style={{ margin: "4px 0 2px", font: "400 22px var(--font-display)" }}>Rents, 10-year outlook</h3>
          {rentBands.length ? (
            <>
              <p className="note">10-year {unit} change: <strong>{pct(r10 ? r10.median - 100 : null)}</strong> (80% range {pct(r10 ? r10.p10 - 100 : null)} to {pct(r10 ? r10.p90 - 100 : null)})</p>
              <FanChart history={p.history.rent} bands={rentBands} color="rent" label={`${p.name} rent projection`} />
              <p className="note">10-year method: {p.methods.rent10}. {p.sensNotes.rent}</p>
            </>
          ) : <div className="empty"><h2>No rent index</h2><p>This country publishes no rent price index in the OECD dataset, so rents are not projected.</p></div>}
        </div>
      </section>

      {typeKeys.length ? (
        <section className="section">
          <div className="section-title">
            <div><p className="eyebrow">By dwelling type</p><h2>Condos, houses, detached, townhouses</h2></div>
            <p>Each type has its own series and its own pooled model, backtested separately. Real prices, origin year = 100.</p>
          </div>
          <div className="grid-2">
            <div className="panel">
              <div className="chips" role="group" aria-label="Dwelling type">
                {typeKeys.map((t) => <button key={t} className="chip" aria-pressed={type === t} onClick={() => setType(t)}>{TYPE_LABELS[t] ?? t}</button>)}
              </div>
              <div style={{ marginTop: 12 }}>
                {typeBands.length ? <FanChart history={p.history.types[type] ?? []} bands={typeBands} color="price" label={`${TYPE_LABELS[type]} projection`} /> : null}
              </div>
            </div>
            <div className="table-wrap">
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
              <p className="note" style={{ padding: "0 12px 10px" }}>Real price change, median projection, at the chosen rate.</p>
            </div>
          </div>
        </section>
      ) : null}

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
            {!p.bands.nominal_rent.length ? <p className="note" style={{ padding: "0 12px 10px" }}>No rent projection for this country; the rent column stays flat at today's figure only if you enter one.</p> : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div><p className="eyebrow">Indexes</p><h2>Investor, buyer, renter, seller</h2></div>
          <p>0 to 100 against every economy with house price data. 100 is most favourable for that person. Scores update with the rate toggle.</p>
        </div>
        <div className="grid-4">
          {PERSONA_ORDER.map((k) => {
            const spec = p.personas.specs[k], s = scores[k], base = p.personas.base[k];
            const d = s != null && base != null ? s - base : null;
            return (
              <article key={k} className="persona-card">
                <h3>{spec?.label}</h3>
                <div className="score num">{s == null ? "–" : s.toFixed(0)}</div>
                {d != null && Math.abs(d) >= 0.5 ? <div className={`delta ${d > 0 ? "pos" : "neg"}`}>{d > 0 ? "+" : ""}{d.toFixed(1)} vs current rates</div> : <div className="delta" style={{ color: "var(--faint)" }}>at current rates</div>}
                <div className="meter"><i style={{ width: `${s ?? 0}%` }} /></div>
                <p>{spec?.question}</p>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
