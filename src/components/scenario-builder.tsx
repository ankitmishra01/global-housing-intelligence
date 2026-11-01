"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FanChart } from "./fan-chart";
import { monthlyPayment } from "@/lib/toggle";
import { adjustStress, applyScenario, combinedShift, DRIVER_LABELS, isZero, nonRateShift, PRESETS, ZERO, type Band, type DriverKey, type Scenario, type StressMetrics, type TargetSens } from "@/lib/scenario";
import { scorePersona, shiftComponents } from "../../lib/engine/indexes.js";
import { mortgageStressIndex } from "../../lib/engine/affordability.js";
import { computeSignals as computeSignalsJs } from "../../lib/engine/signals.js";

// The JS engine function infers narrow default-parameter types; type its real shape here.
const computeSignals = computeSignalsJs as unknown as (input: { scores: Record<string, number | null>; components: Record<string, unknown>; flags: string[]; stress: { score: number } | null }) => unknown;
import { PERSONA_ORDER, pct, money, fmt } from "@/lib/labels";

type Point = { year: number; value: number };
type PersonaSpec = { label: string; question: string; components: { key: string; weight: number; direction: number; label: string }[] };
type Signal = { label: string; level: number; adjusted: boolean; support: string[]; oppose: string[] };

export type ScenarioProps = {
  countries: { iso3: string; name: string }[];
  iso3: string;
  name: string;
  originLabel: string;
  history: { price: Point[]; rent: Point[] };
  bands: { real_price: Band[]; nominal_price: Band[]; real_rent: Band[]; nominal_rent: Band[] };
  sens: { real_price: TargetSens; real_rent: TargetSens };
  unclear: string[];
  rates: { policy: number | null; mortgage: number | null; mortgageSource: string | null };
  personas: { specs: Record<string, PersonaSpec>; components: Record<string, number | null>; distributions: Record<string, number[]> };
  stress: { metrics: StressMetrics; distributions: Record<string, number[]> };
  flags: string[];
  calculator: { price: number | null; rent: number | null };
};

const SLIDERS: { key: DriverKey; min: number; max: number; unit: string; hint: string }[] = [
  { key: "rate", min: -3, max: 3, unit: "pp", hint: "sustained change in the policy rate" },
  { key: "unemployment", min: -2, max: 4, unit: "pp", hint: "change in the unemployment rate" },
  { key: "wages", min: -3, max: 3, unit: "pp a year", hint: "real wage growth vs baseline" },
  { key: "gdp", min: -3, max: 3, unit: "pp a year", hint: "real GDP growth vs baseline" },
];

const at = (rows: Band[], h: number) => rows.find((r) => r.horizon === h);
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

export function ScenarioBuilder(p: ScenarioProps) {
  const router = useRouter();
  const [s, setS] = useState<Scenario>(ZERO);
  const [nominal, setNominal] = useState(false);
  const [price, setPrice] = useState(p.calculator.price ? String(Math.round(p.calculator.price)) : "");
  const [rent, setRent] = useState(p.calculator.rent ? String(Math.round(p.calculator.rent)) : "");
  const [down, setDown] = useState("20");
  const [term, setTerm] = useState("25");
  const set = (key: DriverKey, v: number) => setS((prev) => ({ ...prev, [key]: v }));

  const priceBase = nominal ? p.bands.nominal_price : p.bands.real_price;
  const rentBase = nominal ? p.bands.nominal_rent : p.bands.real_rent;
  const priceBands = useMemo(() => applyScenario(priceBase, p.sens.real_price, s), [priceBase, p.sens.real_price, s]);
  const rentBands = useMemo(() => applyScenario(rentBase, p.sens.real_rent, s), [rentBase, p.sens.real_rent, s]);

  // Persona scores: the rate part goes through shiftComponents (which also moves mortgage
  // burden and rate trend); the other drivers add their path shifts to the projected components.
  const rateSensForIndex = {
    real_price: { 3: p.sens.real_price.rate?.[3]?.valid ? p.sens.real_price.rate[3].coef : undefined, 10: p.sens.real_price.rate?.[10]?.valid ? p.sens.real_price.rate[10].coef : undefined },
    real_rent: { 10: p.sens.real_rent.rate?.[10]?.valid ? p.sens.real_rent.rate[10].coef : undefined },
  };
  const scoreAt = (sc: Scenario) => {
    const c = { ...shiftComponents(p.personas.components, sc.rate, rateSensForIndex, p.rates.mortgage) } as Record<string, number | null>;
    const add = (k: string, v: number) => { if (typeof c[k] === "number") c[k] = (c[k] as number) + v; };
    add("proj3Price", nonRateShift(p.sens.real_price, sc, 3));
    add("proj10Price", nonRateShift(p.sens.real_price, sc, 10));
    add("proj10Rent", nonRateShift(p.sens.real_rent, sc, 10));
    add("rentVsIncome", -sc.wages);
    const scored = Object.fromEntries(PERSONA_ORDER.map((k) => [k, scorePersona(k, c, p.personas.distributions)]));
    return scored as Record<string, { score: number | null; components: { key: string; value: number | null; percentile: number | null; weight: number }[] }>;
  };
  const baseScores = useMemo(() => scoreAt(ZERO), [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const scenScores = scoreAt(s);

  const stressBase = mortgageStressIndex(p.stress.metrics, p.stress.distributions) as { score: number | null };
  const stressScen = mortgageStressIndex(adjustStress(p.stress.metrics, s, combinedShift(p.sens.real_price, s, 1).shift), p.stress.distributions) as { score: number | null };

  const flagsFor = (sc: Scenario, stressScore: number | null) => {
    const f = new Set(p.flags.filter((x) => x !== "MORTGAGE_STRESS"));
    if (sc.unemployment >= 0.5) f.add("UNEMPLOYMENT_RISING");
    if (stressScore != null && stressScore >= 75) f.add("MORTGAGE_STRESS");
    return [...f];
  };
  const signalsFor = (scores: ReturnType<typeof scoreAt>, sc: Scenario, stressScore: number | null) =>
    computeSignals({
      scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.score])),
      components: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.components])),
      flags: flagsFor(sc, stressScore),
      stress: stressScore == null ? null : { score: stressScore },
    }) as Record<string, Signal>;
  const signals = signalsFor(scenScores, s, stressScen.score);

  // Buy vs rent with the nominal scenario paths and the mortgage rate moved by the rate slider.
  const nomPrice = applyScenario(p.bands.nominal_price, p.sens.real_price, s);
  const nomRent = applyScenario(p.bands.nominal_rent, p.sens.real_rent, s);
  const rate = (p.rates.mortgage ?? 0) + s.rate;
  const homePrice = Number(price), monthlyRent = Number(rent);
  const calcRows = [0, 1, 3, 5, 10].map((h) => {
    const pi = h === 0 ? 100 : at(nomPrice, h)?.median, ri = h === 0 ? 100 : at(nomRent, h)?.median;
    const projPrice = pi && homePrice ? (homePrice * pi) / 100 : null;
    return { h, projPrice, payment: projPrice ? monthlyPayment(projPrice, Number(down) || 0, rate, Number(term) || 25) : null, rent: ri && monthlyRent ? (monthlyRent * ri) / 100 : null };
  });

  const headline = (base: Band[], scen: Band[]) => {
    const b = at(base, 10)?.median, n = at(scen, 10)?.median;
    if (b == null || n == null) return null;
    return { base: b - 100, scen: n - 100, delta: n - b };
  };
  const ph = headline(priceBase, priceBands), rh = headline(rentBase, rentBands);
  const unit = nominal ? "nominal" : "real";

  return (
    <>
      <section className="section">
        <div className="toggle" aria-labelledby="scenario-heading">
          <div className="section-title" style={{ marginBottom: 10 }}>
            <div>
              <p className="eyebrow">Build a scenario</p>
              <h2 id="scenario-heading" className="display" style={{ fontSize: 26, margin: "2px 0 0" }}>Move the economy, see the market</h2>
            </div>
            <label className="field scenario-country" style={{ minWidth: 220, color: "inherit" }}>
              Country
              <select value={p.iso3} onChange={(e) => router.replace(`/scenario?c=${e.target.value}`)} aria-label="Country">
                {p.countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="scenario-sliders">
            {SLIDERS.map((sl) => (
              <label key={sl.key} className="scenario-slider">
                <span className="scenario-slider__head">
                  <span>{DRIVER_LABELS[sl.key]}</span>
                  <strong className="num">{signed(s[sl.key])} {sl.unit}</strong>
                </span>
                <input type="range" min={sl.min} max={sl.max} step={0.25} value={s[sl.key]} onChange={(e) => set(sl.key, Number(e.target.value))} aria-label={`${DRIVER_LABELS[sl.key]}, ${sl.hint}`} />
                <span className="scenario-slider__hint">{sl.hint}</span>
              </label>
            ))}
          </div>
          <div className="toggle__row" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <div className="chips" role="group" aria-label="Scenario presets">
              {PRESETS.map((pr) => (
                <button key={pr.label} className="chip" aria-pressed={JSON.stringify(pr.scenario) === JSON.stringify(s)} onClick={() => setS(pr.scenario)}>{pr.label}</button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Real or nominal">
              <button className="chip" aria-pressed={!nominal} onClick={() => setNominal(false)}>Real</button>
              <button className="chip" aria-pressed={nominal} onClick={() => setNominal(true)}>Nominal</button>
            </div>
          </div>
        </div>
      </section>

      <section className="section grid-2">
        <div className="panel">
          <p className="eyebrow">Buy</p>
          <h3 className="display" style={{ margin: "4px 0 2px", fontSize: 22, color: "var(--line)" }}>House prices</h3>
          {ph ? (
            <p className="note">10-year {unit} change: {pct(ph.base)} at current settings → <strong className={ph.scen >= 0 ? "pos" : "neg"}>{pct(ph.scen)}</strong> in this scenario
              {!isZero(s) && Math.abs(ph.delta) >= 0.05 ? <span className={`delta-chip ${ph.delta < 0 ? "neg" : "pos"}`}>{ph.delta > 0 ? "+" : ""}{ph.delta.toFixed(1)} pts</span> : null}</p>
          ) : null}
          {priceBands.length ? <FanChart history={p.history.price} bands={priceBands} color="price" label={`${p.name} house prices under the scenario`} /> : <p className="note">No price projection.</p>}
        </div>
        <div className="panel">
          <p className="eyebrow" style={{ color: "var(--rent)" }}>Rent</p>
          <h3 className="display" style={{ margin: "4px 0 2px", fontSize: 22, color: "var(--rent)" }}>Rents</h3>
          {rentBands.length ? (
            <>
              {rh ? (
                <p className="note">10-year {unit} change: {pct(rh.base)} at current settings → <strong>{pct(rh.scen)}</strong> in this scenario
                  {!isZero(s) && Math.abs(rh.delta) >= 0.05 ? <span className={`delta-chip ${rh.delta < 0 ? "neg" : "pos"}`}>{rh.delta > 0 ? "+" : ""}{rh.delta.toFixed(1)} pts</span> : null}</p>
              ) : null}
              <FanChart history={p.history.rent} bands={rentBands} color="rent" label={`${p.name} rents under the scenario`} />
            </>
          ) : <div className="empty"><h2>No rent index</h2><p>This country publishes no rent price index, so rents are not projected.</p></div>}
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div><p className="eyebrow">Where the change comes from</p><h2>Effect of each driver</h2></div>
          <p>Real path change from each slider on its own, in percent. Drivers without a statistically clear effect add nothing.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Driver</th><th className="r">Setting</th><th className="r">Prices, 3 years</th><th className="r">Prices, 10 years</th><th className="r">Rents, 10 years</th></tr></thead>
            <tbody>
              {SLIDERS.map((sl) => {
                const only: Scenario = { ...ZERO, [sl.key]: s[sl.key] };
                const eff = (sens: TargetSens, h: number) => 100 * (Math.exp(combinedShift(sens, only, h).shift / 100) - 1);
                return (
                  <tr key={sl.key}>
                    <td>{DRIVER_LABELS[sl.key]}</td>
                    <td className="r">{signed(s[sl.key])} {sl.unit}</td>
                    <td className="r">{pct(eff(p.sens.real_price, 3))}</td>
                    <td className="r">{pct(eff(p.sens.real_price, 10))}</td>
                    <td className="r">{p.bands.real_rent.length ? pct(eff(p.sens.real_rent, 10)) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div><p className="eyebrow">Households and signals</p><h2>Mortgage stress and what each person should weigh</h2></div>
          <p>Stress is re-scored one year into the scenario against every economy at current conditions. Signals follow the index scores and stress.</p>
        </div>
        <div className="panel" style={{ marginBottom: 14 }}>
          <p className="eyebrow">Mortgage stress index</p>
          {stressScen.score != null ? (
            <>
              <p style={{ margin: "4px 0" }}>
                <strong className="num display" style={{ fontSize: 36, color: stressScen.score >= 75 ? "var(--neg)" : "var(--ink)" }}>{stressScen.score.toFixed(0)}</strong>
                <span className="note"> / 100 in this scenario · {stressBase.score != null ? `${stressBase.score.toFixed(0)} today` : "no current score"} (higher is more stress)</span>
              </p>
              <div className="meter"><i style={{ width: `${stressScen.score}%`, background: stressScen.score >= 75 ? "var(--neg)" : "var(--accent)" }} /></div>
            </>
          ) : <p className="note">Not enough data to score mortgage stress for this economy.</p>}
        </div>
        <div className="grid-4">
          {PERSONA_ORDER.map((k) => {
            const spec = p.personas.specs[k], sc = scenScores[k]?.score, base = baseScores[k]?.score, sg = signals[k];
            const d = sc != null && base != null ? sc - base : null;
            return (
              <article key={k} className="persona-card">
                <h3>{spec?.label}</h3>
                <div className="score num">{sc == null ? "–" : sc.toFixed(0)}</div>
                {d != null && Math.abs(d) >= 0.5 ? <div className={`delta ${d > 0 ? "pos" : "neg"}`}>{d > 0 ? "+" : ""}{d.toFixed(1)} vs today</div> : <div className="delta" style={{ color: "var(--faint)" }}>same as today</div>}
                <div className="meter"><i style={{ width: `${sc ?? 0}%` }} /></div>
                {sg ? <p style={{ marginTop: 10 }}><span className={`badge ${sg.level > 0 ? "badge--t1" : sg.level < 0 ? "badge--flag" : ""}`}>{sg.label}</span></p> : null}
                {sg?.support?.length ? <p>{sg.support[0]}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div><p className="eyebrow">Buy vs rent</p><h2>Monthly cost in this scenario</h2></div>
          <p>Mortgage rate held at {fmt(rate, 2)}% ({p.rates.mortgageSource ?? "policy rate plus spread"}, moved by the rate slider). Prices and rents follow the nominal scenario paths.</p>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", alignContent: "start" }}>
            <label className="field">Home price<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 650000" /></label>
            <label className="field">Monthly rent<input inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 2400" /></label>
            <label className="field">Down payment %<input inputMode="numeric" value={down} onChange={(e) => setDown(e.target.value.replace(/[^\d.]/g, ""))} /></label>
            <label className="field">Amortisation (years)<input inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/[^\d]/g, ""))} /></label>
            <p className="note" style={{ gridColumn: "1 / -1", margin: 0 }}>Local currency. Payment covers principal and interest only.</p>
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
          </div>
        </div>
      </section>

      <section className="section">
        <div className="panel">
          <p className="eyebrow">How to read this</p>
          <h3 className="display" style={{ margin: "4px 0 8px", fontSize: 20 }}>Model-implied, not a forecast of what will happen</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Each slider is a sustained move from today. Its effect comes from how housing moved alongside that driver in the backtested model across all Tier 1 economies, so it is an association, not a measured cause.</li>
            <li>Only horizons where an effect is statistically clear are used; elsewhere a driver adds nothing. Projections start from {p.originLabel} and already include today&apos;s live adjustments.</li>
            <li>Drivers interact in the real economy (a recession usually brings rate cuts); here their effects simply add up, so extreme combinations are a stress test, not a scenario forecast.</li>
            {p.unclear.length ? <li>No clear effect, set to zero: {p.unclear.join("; ")}.</li> : null}
          </ul>
        </div>
      </section>
    </>
  );
}
