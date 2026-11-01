# Data quality audit — 1 November 2026

The audit covered every table in Turso: 226,264 observations, 217 economies, projection run `run_202611010203`, the live layer and the indexes. It also checked the production site and API. The checks it used are now permanent: [`sync/quality.js`](../sync/quality.js) runs 30 of them after every training run and the live-layer subset after every daily live run. Results are published at **[/quality](https://global-housing-intelligence.vercel.app/quality)**.

**Result after the fixes: 28 pass, 2 warn, 0 fail.** Both warnings are real gaps in what the sources publish, and they are labelled on the affected pages.

## How the audit was run

The audit ran in seven parts:

1. **Coverage.** First and last period and internal gaps for each indicator and country. Tier rule: Tier 1 if and only if a country has at least 8 annual price points. Inflation available for every country with a price index.
2. **Freshness.** Latest period per series, against a tolerance by frequency: annual 22 months, quarterly 9, monthly 5. Stale projection origins. Age of the live signals.
3. **Validity.** Plausible ranges, zero or negative prices and rents, and year-on-year real moves beyond ±30%.
4. **Consistency.**
   - BIS vs OECD real price growth.
   - BIS vs the national series: Land Registry, Census median price, StatCan NHPI, ABS.
   - IMF vs World Bank inflation.
   - Daily vs monthly policy rates.
5. **Derived outputs.**
   - The CPI chain and real rents.
   - Projection bands: finite, ordered, and widening with horizon.
   - Nominal path equals the real path plus inflation.
   - Price-to-rent equals nominal price ÷ nominal rent.
   - Per-country rate sensitivities: bounds and sign.
   - Persona scores between 0 and 100.
   - Affordability ratios within plausible bounds.
   - Live shifts and event-library sample sizes.
6. **Reality check.** The extremes of the 10-year projection distribution against the history of each country.
7. **Front end.** The visible text of 17 production pages scanned for `NaN`, `undefined`, `Infinity` and `null`. `/api/v1/projections` compared value by value with Turso for 10 countries.

## Findings and fixes

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **Look-ahead bias in the valuation features.** The model used the OECD's "price-to-income / price-to-rent as % of long-run average". That average is computed over the full sample, including years after each backtest origin. | OECD definition. Korea's ratio fell from 265 (1986) to 48 (2025) of its "average", so a backtest origin in 2005 already knew about 2025. | Replaced the feature with the gap to the country's own **trailing 20-year average**, which uses only information available at each origin (`trailingGap` in `projections.js`). The OECD gap is still shown as a descriptive metric. |
| 2 | **One country's extreme input drove an implausible path.** Korea's 10-year real price median was **+83%**. Years 1–5 were about +3%, then the long-horizon fits extrapolated a valuation gap with z = −2.8 linearly. | Comparison of Korea's feature vector with the cross-section. | Ridge features are now **winsorized at the 2.5th and 97.5th percentiles of the training samples**, in fitting and in prediction (`fitRidge`). Together with fix 1, Korea's 10-year median is now +55%, and no country is beyond ±80%. |
| 3 | **Fixes 1 and 2 improved held-out skill everywhere** (it was not just a cosmetic change). | Real price skill against no change, before → after: 1y 21.3% → **23.3%**, 3y 12.8% → **17.3%**, 5y 9.0% → **13.2%**, 10y 3.6% → **8.6%**. Rents went from no skill at 2–10 years to skill at every horizon (1y **6.4%**, 10y **2.9%**). | Engine re-selection: a direct fit is preferred whenever it passes the skill test, and carry-forward is the fallback. This removed the path that stayed flat to year 7 and then jumped at year 10. |
| 4 | **Rent paths zig-zagged.** At horizons 2 and 7 the method fell back to "no change", while horizons 1, 3, 5 and 10 used the model, so the path dipped and recovered. | Backtest table. | **Path coherence rule:** a baseline horizon between two model horizons uses the carry-forward, if that scores no worse than the baseline on held-out origins. There is no margin, so the rule only smooths the path and never adds claimed skill. |
| 5 | **Hyperinflation artefacts in self-deflated real series.** Annual-average CPI and rent indexes are timed differently, which made fake jumps: Bulgaria's real rent shows **+114% in 1998** after −33% in 1997. 15 Tier 1 economies had inflation above 50% since 1990. | `validity.jumps`, `derived.cpi_chain`. | Years with inflation above 50% are **dropped from derived real rents, dwelling-type and fallback price series**. The CPI chain itself is kept, so later levels stay consistent. 20 large real moves remain; each is a documented boom or bust (Baltics 2005–09, Hong Kong 1997–98, Türkiye 2022–24) and is kept. |
| 6 | **US rent CPI had no 2025 annual value.** The BLS never published October 2025 CPI during the federal shutdown, and the rule required all 12 months. | `RENT_CPI` annual ended in 2024 while the monthly series ran to 2026-09. | A **completed** year with exactly one missing month is now averaged. The current, in-progress year never is. US rent CPI for 2025 = 434.9. |
| 7 | **Stale projection origins were not labelled.** UAE and Saudi prices end in 2023: BIS REIDIN to April 2024, OECD to 2023. Chile's rent ends in 2023 and Russia's in 2021 (OECD). | `freshness.origins`. | Country pages now show "Price data to …" and "Rent data to …" badges, plus an explanation in the header text. This is kept as a warning because it is a gap in the sources. |

## What passed (with numbers)

- **Coverage.** All 10 gated indicators meet their minimum coverage. 59 Tier 1 and 158 Tier 2 economies, and every tier matches its price history. Every Tier 1 economy has inflation data. There are no internal gaps in the headline annual series.
- **Validity.** No stored value is outside its plausible range, and no price or rent is zero or negative.
- **Cross-source consistency**
  - BIS vs OECD real price growth across 46 countries: median correlation **0.98**, none below 0.7.
  - National series:
    - UK BIS vs Land Registry: r = **1.00** (n = 30)
    - Australia vs ABS: **0.97** (n = 13)
    - US BIS vs Census median sales price: **0.78** (n = 55); the median price reflects the mix of homes sold
    - Canada BIS vs NHPI: **0.75** (n = 44); NHPI covers new homes only, so a weaker link is expected
  - IMF vs World Bank inflation: 156 country-years since 2000 differ by more than 3pp, but only 5 of them are in Tier 1, and the IMF series is what the model uses.
  - Daily and monthly policy rates agree within 1pp in every country.
- **Projections**
  - All 3,000 rows are finite and their bands are ordered.
  - Every 80% band widens or holds with horizon.
  - Every nominal path equals its real path plus the stored inflation path.
  - Every price-to-rent point equals nominal price ÷ nominal rent.
  - Every per-country rate sensitivity is finite, within ±10, and has the right sign.
- **Indexes.**
  - Persona scores are all between 0 and 100. Coverage out of 59: investor 59, buyer 56, seller 59, renter 41 (renter needs rent data).
  - Affordability ratios are all within plausible bounds.
  - The stress index covers 32 of the 59.
- **Live layer**
  - State is current.
  - GDELT runs to 2 days ago; GDELT publishes with a lag.
  - 56 daily policy rates, 2 of them more than 3 weeks old.
  - All 3,000 live shifts are finite and within ±45 log points.
  - All 14 active events have evidence.
  - All 24 event-library rows have at least 3 episodes.
- **Front end.**
  - No `NaN`, `undefined`, `Infinity` or `null` in the visible text of 17 production pages.
  - The API matches Turso exactly for 10 countries (0 mismatches).
  - The Tier 2 API call (Niger) returns 404, as designed.

## Remaining issues and why

1. **The level of the 10-year projections is high.** Every Tier 1 economy projects a real rise, from +13.7% to +70.6%; the median is **+36%**. The historical median 10-year real change, 1995–2025, is **+26%** (25th percentile −1%, 75th percentile +55%).
   - Held-out skill is positive and the 80% band covers 85.8% of outcomes, so this is consistent with the evaluation.
   - But the held-out decade was a strong one for real house prices. Projections lean on that regime.
   - Recommendation: test shrinking the intercept toward a long-run mean of real growth, and evaluate the result on pre-2008 origins.
2. **The rate sensitivity is modest:** about −0.4% to −0.9% on real prices per +1pp. Central-bank studies typically find −2% to −6%. Rates historically rise in booms, which attenuates the estimate. This is disclosed on the methodology page; the numbers have not been inflated.
3. **Thin coverage for parts of the stress index.** BIS debt-service ratios cover 17 countries. Median household income comes from a national source only for the US; elsewhere GDP per head × 2.5 is used as a proxy, and the basis is labelled on each page.
4. **Source gaps in the Gulf** (UAE, Saudi Arabia), and **rents lagging** for Russia and Chile (warnings above).

## Recommended next sources

| Gap | Source | Notes |
|---|---|---|
| UAE prices and sales, current | Dubai Land Department transactions (Dubai Pulse open API) | Needs a free API key |
| Saudi Arabia prices, current | GASTAT Real Estate Price Index (quarterly) | Public, has a download API |
| Household income for CAN, GBR, AUS | StatCan 11-10-0190, ONS household disposable income, ABS Survey of Income and Housing | Replaces the GDP-per-head proxy |
| Debt service beyond 17 countries | National central bank financial stability reports, ECB household DSR | Widens stress-index coverage |
| Rents for Russia and Chile | Rosstat CPI rent component, INE Chile CPI housing rent | Fixes the stale rent origins |
| EU prices by dwelling type | Eurostat `prc_hpi_q` (new vs existing dwellings) | Widens the dwelling-type split |
