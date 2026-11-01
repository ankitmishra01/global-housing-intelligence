import type { Metadata } from "next";
import { backtests, latestRun, sensitivities } from "@/lib/data";
import { TYPE_LABELS, PERSONA_ORDER, fmt } from "@/lib/labels";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Methodology" };

const SOURCES: { name: string; series: string; provides: string; url: string }[] = [
  { name: "BIS selected residential property prices", series: "WS_SPP", provides: "Nominal and real house price indexes, quarterly, about 60 economies, some from the 1970s. The core Tier 1 price series.", url: "https://data.bis.org/topics/RPP" },
  { name: "BIS detailed residential property prices", series: "WS_DPP", provides: "Prices by dwelling type (houses, detached, townhouse, flats/condos), whole-country coverage only.", url: "https://data.bis.org/topics/RPP" },
  { name: "BIS total credit statistics", series: "WS_TC", provides: "Household credit as % of GDP.", url: "https://data.bis.org/topics/TOTAL_CREDIT" },
  { name: "BIS credit-to-GDP gaps", series: "WS_CREDIT_GAP", provides: "Deviation of private credit-to-GDP from its long-run trend.", url: "https://data.bis.org/topics/CREDIT_GAPS" },
  { name: "BIS central bank policy rates", series: "WS_CBPOL", provides: "Monthly policy rates; euro area members use the ECB rate from the year they joined. The base for the rate toggle.", url: "https://data.bis.org/topics/CBPOL" },
  { name: "OECD Analytical House Prices", series: "DSD_AN_HOUSE_PRICES", provides: "Rent price index, price-to-income and price-to-rent vs long-run average, real and nominal price indexes.", url: "https://data-explorer.oecd.org/" },
  { name: "IMF World Economic Outlook (DataMapper)", series: "PCPIPCH, NGDP_RPCH", provides: "Inflation and real GDP growth, history plus about five years of forecasts. Inflation converts real paths to nominal.", url: "https://www.imf.org/external/datamapper" },
  { name: "World Bank World Development Indicators", series: "WDI", provides: "Population and urban growth, income, lending and real rates, private credit for every economy (the Tier 2 baseline).", url: "https://data.worldbank.org/" },
  { name: "CMHC Rental Market Survey (via Statistics Canada)", series: "34-10-0133, 34-10-0127", provides: "Average two-bedroom rents and vacancy rates for major Canadian metros.", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410013301" },
  { name: "CMHC Starts and Completions Survey (via Statistics Canada)", series: "34-10-0135", provides: "Canadian housing starts.", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410013501" },
  { name: "Statistics Canada New Housing Price Index", series: "18-10-0205", provides: "New home prices (house and land).", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810020501" },
  { name: "Bank of Canada Valet API", series: "V80691335", provides: "Posted 5-year conventional mortgage rate (posted rates run above typical negotiated rates).", url: "https://www.bankofcanada.ca/valet/docs" },
  { name: "FRED (Federal Reserve Bank of St. Louis)", series: "MSPUS, CUSR0000SEHA, MORTGAGE30US, HOUST, RRVRUSQ156N", provides: "US median sales price (Census/HUD), CPI rent (BLS), 30-year fixed mortgage rate (Freddie Mac), housing starts and rental vacancy (Census).", url: "https://fred.stlouisfed.org/" },
  { name: "Zillow Research", series: "ZHVI, ZORI", provides: "US typical home values for condos/co-ops and single-family homes, and typical market rents.", url: "https://www.zillow.com/research/data/" },
  { name: "HM Land Registry UK House Price Index", series: "UK HPI", provides: "UK and nation-level average prices by type: detached, semi-detached, terraced, flats.", url: "https://landregistry.data.gov.uk/app/ukhpi" },
  { name: "Australian Bureau of Statistics", series: "RES_DWELL_ST", provides: "Mean price of residential dwellings, national and by state.", url: "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings" },
  { name: "ECB MFI interest rate statistics", series: "MIR", provides: "Rates on new loans to households for house purchase, by euro-area country. Used as the mortgage rate for 21 euro members.", url: "https://data.ecb.europa.eu/" },
  { name: "Bank of England database", series: "IUMBV34", provides: "Quoted 2-year fixed mortgage rate at 75% loan-to-value (UK mortgage rate).", url: "https://www.bankofengland.co.uk/boeapps/database/" },
  { name: "OECD household sector accounts and Statistics Canada", series: "DSD_NASEC10, 11-10-0190", provides: "Household disposable income (OECD mean per household) and Canadian median income, used for price-to-income and mortgage-to-income. The GDP-per-head proxy is used only where neither exists, and every figure is labelled with its basis.", url: "https://data-explorer.oecd.org/" },
  { name: "OECD labour force statistics and BIS debt service ratios", series: "DSD_LFS, AV_AN_WAGE, WS_DSR", provides: "Monthly unemployment (Sahm-style trigger), real wages and household debt-service ratios for mortgage stress.", url: "https://data-explorer.oecd.org/" },
  { name: "INSEE, INE, CSO, CBS, SCB, SSB, BCB", series: "IPLA-IPLNA, 80270, HPM09/HPM05, 85773NED/85792NED, FastpiPSRegKv, 07221, SGS 21340", provides: "National agencies of France, Spain, Ireland, the Netherlands, Sweden, Norway and Brazil: regional and dwelling-type price indexes, sales volumes and prices.", url: "https://www.insee.fr/" },
  { name: "Dubai Real Estate Data (DLD open data, CC BY 4.0)", series: "market, rents, yields", provides: "Dubai registered sales, median AED per sq ft, the DLD price index, new-contract rents and gross yields. Credit: Dubai Real Estate Data (dubairealestatedata.com), based on Dubai Land Department open data.", url: "https://www.dubairealestatedata.com/" },
  { name: "GDELT, GDACS and ECB reference rates", series: "GDELT 1.0 events, GDACS alerts, Frankfurter", provides: "Daily inputs to the live layer: conflict news intensity, disaster alerts and exchange-rate moves.", url: "https://www.gdeltproject.org/" },
  { name: "Jarociński–Karadi monetary policy shocks", series: "Fed and ECB shock series", provides: "Identified monetary-policy shocks for the causal rate estimate (Jarociński and Karadi, 2020, AEJ: Macroeconomics).", url: "https://github.com/marekjarocinski" },
];

const TARGET_NAMES: Record<string, string> = { real_price: "Real house prices", real_rent: "Real rents", type_price: "Prices by dwelling type" };

export default async function Methodology() {
  const [run, bt, sens] = await Promise.all([latestRun(), backtests(), sensitivities()]);
  return (
    <div className="page prose">
      <header className="page-head">
        <div>
          <p className="eyebrow">Methodology</p>
          <h1>How the numbers are made</h1>
          <p className="lede">Statistical code produces every number, the page renders it, and the AI analyst only explains what is already stored. A model has to beat a simple baseline on years it never saw, or the baseline is shown instead.</p>
        </div>
        {run ? <p className="note mono">Run {run.id} · model {run.model_version} · data to {run.data_vintage}</p> : null}
      </header>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Sources</p><h2>Where the data comes from</h2></div><p>All public, free APIs, refreshed monthly. International sources give comparability; national agencies add local-currency levels, cities and dwelling types.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Series</th><th>What it provides</th></tr></thead>
            <tbody>{SOURCES.map((s) => (
              <tr key={s.name}><td><a href={s.url} rel="noopener noreferrer" target="_blank">{s.name}</a></td><td className="mono note">{s.series}</td><td>{s.provides}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="note">Tier 1 economies have an official house price index (BIS or OECD). Tier 2 economies have housing drivers only and are never given a price or rent projection.</p>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Model</p><h2>The 10-year projection engine</h2></div></div>
        <div className="grid-2">
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>What is projected</h3>
            <p>Cumulative real (after-inflation) log growth of three kinds of series: each country&apos;s house price index, its rent index deflated by consumer prices, and each country × dwelling-type price series. Nominal paths add IMF WEO inflation forecasts, held flat after the last WEO year. The price-to-rent path is the ratio of the nominal price and rent paths.</p>
            <h3>How</h3>
            <p>A pooled ridge regression is fitted separately for each horizon (1, 2, 3, 5, 7 and 10 years ahead), predicting growth directly rather than chaining one-year forecasts. Years 4, 6, 8 and 9 are interpolated along the cumulative path. Missing predictors are mean-imputed inside each training window; outcomes are never imputed.</p>
            <h3>Features</h3>
            <ul>{(run?.summary.features ?? []).map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Baselines and the honesty rule</h3>
            <p>Three baselines compete with the model: <strong>no real change</strong>, the country&apos;s <strong>historical real trend</strong> (up to 20 prior years), and a <strong>long-run anchor</strong> (up to 30 years of real growth, shrunk toward the cross-country mean). A <strong>blend</strong> of model and anchor, and a shorter-horizon model <strong>held flat</strong> beyond its horizon, are also candidates.</p>
            <p>Rolling-origin backtests run from 1995. At each test year the model is trained only on outcomes already observed by then. The method is chosen on the earlier half of the test years and its error is quoted on the later half it never saw.</p>
            <ul>
              <li>A model candidate is kept only if it wins on the earlier half and beats every baseline by at least 2% on the held-out half.</li>
              <li>Otherwise the better baseline is shown, labelled &quot;no model skill, showing baseline&quot;.</li>
              <li>A trend baseline that loses to no-change on the held-out years falls back to no-change.</li>
            </ul>
            <h3>Uncertainty</h3>
            <p>{run?.summary.uncertainty ?? "Empirical rolling-origin residual quantiles per horizon."}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Backtests</p><h2>How accurate it has been</h2></div><p>Errors are in cumulative log points × 100 (about percent). Skill is the error reduction against the no-change baseline. Coverage is how often the outcome fell inside the 80% band on held-out years.</p></div>
        {bt.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Target</th><th className="r">Horizon</th><th>Method shipped</th><th className="r">MAE</th><th className="r">No-change MAE</th><th className="r">Skill</th><th className="r">80% coverage</th><th className="r">Origins</th><th>Status</th></tr></thead>
              <tbody>{bt.map((b) => (
                <tr key={`${b.target}${b.horizon}`}>
                  <td>{TARGET_NAMES[b.target] ?? b.target}</td><td className="r">{b.horizon}y</td><td>{b.method}</td>
                  <td className="r">{fmt(b.mae, 2)}</td><td className="r">{fmt(b.baseline_mae, 2)}</td>
                  <td className={`r ${b.skill_pct > 0 ? "pos" : b.skill_pct < 0 ? "neg" : ""}`}>{fmt(b.skill_pct, 1)}%</td>
                  <td className="r">{fmt(b.coverage80, 1)}%</td><td className="r">{b.n_origins}</td>
                  <td><span className={`badge ${b.status.startsWith("out") ? "badge--t1" : "badge--warn"}`}>{b.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="note">No backtests stored yet.</p>}
        {bt.length ? <p className="note">{bt[0].basis}. Long horizons rest on fewer origins: read the Origins column before trusting a 10-year skill figure.</p> : null}
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Rate toggle</p><h2>Interest-rate sensitivity</h2></div><p>Change in cumulative real growth (log points × 100) for a sustained +1 percentage point move in the policy rate. Two estimates are kept side by side: an association from the pooled ridge model, and a causal estimate from identified monetary-policy shocks.</p></div>
        {(() => {
          const ridge = sens.filter((s) => !s.target.includes("causal"));
          const causal = sens.filter((s) => s.target.includes("causal"));
          return (
            <>
              <h3 style={{ margin: "8px 0" }}>Association (pooled ridge model)</h3>
              {ridge.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Target</th><th className="r">Horizon</th><th className="r">Effect per +1pp</th><th>Toggle</th><th>Note</th></tr></thead>
                    <tbody>{ridge.filter((s) => [1, 3, 5, 10].includes(s.horizon)).map((s) => (
                      <tr key={`${s.target}${s.horizon}`}>
                        <td>{TARGET_NAMES[s.target] ?? s.target}</td><td className="r">{s.horizon}y</td><td className="r">{fmt(s.coef, 2)} ± {fmt(s.se, 2)}</td>
                        <td>{s.valid ? <span className="badge badge--t1">on</span> : <span className="badge badge--warn">off</span>}</td><td className="note">{s.note}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="note">No sensitivities stored yet.</p>}
              <h3 style={{ margin: "20px 0 8px" }}>Causal estimate (monetary-policy shocks)</h3>
              <p className="note" style={{ marginTop: 0 }}>Local projections of quarterly real house prices on the Jarociński–Karadi (2020) monetary-policy shocks, which strip out the information a central bank reveals about the economy. United States with Fed shocks; euro-area members pooled with ECB shocks and country fixed effects. Four lags of price growth and of the shock as controls; Newey–West / Driscoll–Kraay standard errors. The response is scaled to a +1 percentage point policy-rate move by the policy rate&apos;s own peak response to the same shock. The toggle switches to this estimate only where it is statistically clear and the rate response is clearly identified; otherwise the association above is used.</p>
              {causal.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Area</th><th className="r">Horizon</th><th className="r">Effect per +1pp</th><th>Used</th><th>Note</th></tr></thead>
                    <tbody>{causal.filter((s) => [1, 2, 3, 5, 10].includes(s.horizon)).map((s) => (
                      <tr key={`${s.target}${s.horizon}`}>
                        <td>{s.target.endsWith("_us") ? "United States" : "Euro area"}</td><td className="r">{s.horizon}y</td><td className="r">{fmt(s.coef, 2)} ± {fmt(s.se, 2)}</td>
                        <td>{s.valid ? <span className="badge badge--t1">yes</span> : <span className="badge badge--warn">no</span>}</td><td className="note">{s.note}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="note">The causal estimate has not been computed for this run.</p>}
            </>
          );
        })()}
        <p className="note">Prices must fall when rates rise; an estimate counts only when it is statistically clear and correctly signed, and the last reliable effect is held forward as a level shift. Rents keep the association, estimated freely: higher rates can push households into renting.</p>
      </section>

      <section className="section" id="analysis">
        <div className="section-title"><div><p className="eyebrow">Written analysis</p><h2>How each country page explains its numbers</h2></div></div>
        <div className="prose">
          <p>The analysis beside each chart is generated from the stored figures, so every number in it can be traced to the database. Three layers give it country-specific reasoning.</p>
          <p><strong>What drives the projection.</strong> The ridge model&apos;s prediction is additive: an intercept, the average outcome across the pooled history, plus one term per driver, the driver&apos;s standardised distance from the sample mean times its coefficient. Each country page splits its 3- and 10-year projections into these parts (scaled so they sum to the headline percentage) and names the drivers that lift or weigh on the path, measured against the typical market year. These shares describe what the model leans on, not proven causes. Where a driver&apos;s sign runs against intuition, the page says so rather than inventing a mechanism.</p>
          <p><strong>Price history in phases.</strong> Turning points are found with an 8% reversal rule, so the text describes booms and corrections (with nominal changes where inflation explains a real fall), not annual noise.</p>
          <p><strong>Market structure and policy.</strong> Curated notes on how mortgages reset, lending rules, housing programmes, supply, demand and what the official index covers. Each note cites the official or reputable source it was checked against, and the sources are listed under the section that uses them. Notes are tagged by how they bear on the outlook (supporting or restraining prices, raising or lowering rate sensitivity), and the outlook weighs that balance against the projection.</p>
        </div>
      </section>

      <section className="section" id="live">
        <div className="section-title"><div><p className="eyebrow">Live layer</p><h2>Daily adjustments from rates and events</h2></div><p>Every morning a cloud job reads policy rates, mortgage rates, news events, disaster alerts, exchange rates and land-registry sales, then adjusts the stored projections.</p></div>
        <div className="grid-2">
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Rates</h3>
            <p>The change in each country&apos;s policy rate since its projection origin year is applied through the same sensitivity as the rate toggle. Gulf currencies pegged to the US dollar use the US policy rate, labelled as a proxy.</p>
            <h3>Events</h3>
            <p>Armed conflict escalations, regional conflict spillovers, Red-alert natural disasters, currency crises and sales slumps are detected automatically. An event moves a projection only if past episodes of its class show a statistically clear effect (at least 1.64 standard errors) relative to what the model expected; otherwise it is shown without an adjustment. Long-running wars already in the training data apply no extra shift.</p>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Sales slumps</h3>
            <p>A slump is registered sales over three months at least 25% below a year earlier, and at least 10% below two years earlier so tax-holiday reversals are not counted. Calibrated on {(run?.summary as unknown as { slumpEpisodes?: unknown[] })?.slumpEpisodes?.length ?? "past"} episodes in the UK, the Netherlands and Ireland; the effect is listed on the <a href="/live">live page</a>.</p>
            <h3>Scenarios</h3>
            <p>The <a href="/scenario">scenario builder</a> combines the rate sensitivity with pooled sensitivities to unemployment, real wages and real GDP growth. Only statistically clear effects count; the others are set to zero and listed. These are model-implied associations, not causal forecasts.</p>
          </div>
        </div>
      </section>

      <section className="section" id="affordability">
        <div className="section-title"><div><p className="eyebrow">Affordability</p><h2>Income ratios and mortgage stress</h2></div></div>
        <div className="panel">
          <p>Price-to-income uses a national price level divided by household income: a national median where one is published (Canada, United States), otherwise OECD household disposable income per household, otherwise GDP per head × 2.5. Each figure states its basis. Mortgage-to-income assumes an 80% loan over 25 years at the country&apos;s mortgage rate (ECB, Bank of England, Bank of Canada, Freddie Mac; elsewhere the policy rate plus 2pp, labelled).</p>
          <p>The mortgage stress index (0–100, higher is more stress) ranks five components across economies: mortgage-to-income (or price-to-income against history), household debt service against its 15-year average, the 12-month change in unemployment, three-year real wage growth (lower is worse) and household debt. It needs at least half its weight. Stress or fast-rising unemployment downgrades the buyer and investor signals and raises the seller signal.</p>
          <p>The <a href="/track-record">track record</a> page shows how the model&apos;s past backtest predictions compared with what happened, and will score published projections as they come due.</p>
        </div>
      </section>

      <section className="section" id="flags">
        <div className="section-title"><div><p className="eyebrow">Risk flags</p><h2>Rule-based thresholds</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Flag</th><th>Rule</th><th className="r">Threshold</th></tr></thead>
            <tbody>{Object.entries(run?.summary.flagRules ?? {}).map(([k, r]) => <tr key={k}><td className="mono">{k}</td><td>{r.label}</td><td className="r">{r.threshold}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="section" id="indexes">
        <div className="section-title"><div><p className="eyebrow">Indexes</p><h2>Investor, buyer, renter, seller weights</h2></div><p>Each component is ranked as a percentile across Tier 1 economies, oriented so 100 is best for that person, then weighted. Less than half the weight available means no score.</p></div>
        <div className="grid-2">
          {PERSONA_ORDER.map((k) => {
            const spec = run?.summary.personas[k];
            return spec ? (
              <div key={k} className="panel">
                <h3 style={{ marginTop: 0 }}>{spec.label}</h3>
                <p className="note">{spec.question}</p>
                <table>
                  <thead><tr><th>Component</th><th className="r">Weight</th><th>Better when</th></tr></thead>
                  <tbody>{spec.components.map((c) => <tr key={c.key}><td>{c.label}</td><td className="r">{Math.round(c.weight * 100)}%</td><td>{c.direction > 0 ? "higher" : "lower"}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null;
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Dwelling types</p><h2>Condos, houses, detached, townhouses</h2></div></div>
        <p>Type series come from the BIS detailed dataset ({Object.values(TYPE_LABELS).join(", ")}), HM Land Registry for the UK, and Zillow for US condos and single-family homes. Where both an index and a national level series exist, the longer history is used. Type paths have their own pooled model and backtest (&quot;Prices by dwelling type&quot; above). Coverage is uneven: condo and house splits exist for about 20 economies, and detached, townhouse and semi-detached for only a handful.</p>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Limits</p><h2>What this cannot tell you</h2></div></div>
        <ul>{(run?.summary.limits ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}
