# Accuracy audit (1 November 2026)

This audit asked a narrower question than the data quality audit in [DATA_QUALITY.md](DATA_QUALITY.md): is what we store and show exactly what the sources publish, and are the derived numbers computed correctly?

It covered four things:
1. Fresh source values against Turso.
2. Independent recomputation of derived figures.
3. The production pages against the database.
4. Every comparative claim in the written analysis.

## Method

1. **Adapter fidelity.** Every source adapter was re-run against the live source. A random sample of stored rows, plus the latest period of each series, was compared with the fresh values, at a tolerance of 1e-6.
2. **Independent raw checks.** The original files were parsed with separate code, not the adapters, to confirm meaning as well as matching values: units, period labels, annual averaging and summing, scaling, currency, and city mapping.
3. **Derived calculations.** These were recomputed from raw Turso rows with independent code for 14 countries (CAN, USA, GBR, AUS, DEU, FRA, ESP, NLD, IRL, SWE, NOR, JPN, NZL, CHE):
   - Affordability:
     - price-to-income
     - mortgage-to-income (80% loan, 25-year annuity)
     - income basis labels
     - price-to-income against history
     - debt-service gap
   - Labour market:
     - Sahm-style gap
     - three-year real wage growth
   - Live layer:
     - origin-year policy mean and rate delta
     - live shift (coefficient × delta)
   - Projections:
     - nominal path (real path × inflation path)
     - interpolated horizons
   - Scores:
     - risk-flag thresholds
     - persona index scores, rebuilt end to end for CAN, USA and DEU
4. **What users see.** For all 59 Tier 1 country pages, the prose, headline and hero figures were reconciled with `/api/v1/countries/ISO3` and the database. That covered 814 claim checks:
   - **Figures:** 10-year price and rent changes, policy and mortgage rates and their changes since origin, unemployment, stress score and rank, rent-to-income, and price-to-income against history.
   - **Ranks and comparisons:** the market rank, "ahead of / behind / in line with the median", and rent medians and counts.
   - **History:** decade and five-year price changes, recomputed from BIS and OECD annual series.

   City pages (Toronto, New York, Manchester, Sydney, Dubai), the cities tables, the indexes page and the live page were checked against the database too.

## Results by source

| Source | Rows checked | Match | Mismatch |
|---|---|---|---|
| BIS selected property prices, credit, gaps, policy rates | 18 + independent checks | all | 0 |
| BIS detailed prices (types, cities) | 18 | 18 | 0 (labels fixed, see below) |
| OECD house prices | independent check (rent index, price-to-income, Canada 2025) | all | 0 |
| IMF WEO | 18 + 2 independent | all | 0 |
| World Bank WDI | 18 + 1 independent | all | 0 |
| OECD labour and wages, BIS debt service | 18 | 18 | 0 |
| ECB MIR, Bank of England | 18 + 2 independent | all | 0 |
| Household income (OECD, Statistics Canada, Census) | 13 | 13 | 0 (Canada label fixed) |
| Statistics Canada / CMHC, Bank of Canada | 18 + 1 independent | all | 0 |
| FRED (Census, BLS, Freddie Mac), Case-Shiller | 18 + 4 independent | all | 0 |
| Zillow (national and metro) | 36 + 2 independent | all | 0 |
| FHFA metro | in the US metros sample | all | 0 |
| HM Land Registry (UK and cities) | 18 + 2 independent | all | 0 |
| ABS (states and capital cities) | 18 | 18 | 0 |
| Dubai Real Estate Data | 18 + 1 independent | all | 0 |
| INSEE, INE, CSO, SCB, SSB, BCB | 18 each (BCB 14) + BCB independent | all | 0 |
| CBS Netherlands | 18 | 16 | 2: Utrecht province and city merged (fixed) |
| Frankfurter FX in `live_signals` | 3 | 3 | 0 |

Unit and period semantics were confirmed on the raw sources:
- BIS annual value = mean of four complete quarters.
- US housing starts are stored ×1000 as SAAR units.
- Monthly mortgage rate = mean of weekly observations.
- Quarter labels follow FRED dates.
- Euro members use the ECB rate.
- Dollar-pegged Gulf states use the US policy rate, labelled as a proxy.

## Derived calculations

185 of 185 independent recomputations matched within rounding. The persona scores agreed to 0.1 points.

## Errors found and fixed

| # | Error | Where | Fix | Test |
|---|---|---|---|---|
| 1 | **Medians were wrong for even counts.** They took the upper middle value instead of averaging the two middle values. The rent median on all 42 rent-market pages read 1.1% against a true 1.03%. | `src/lib/narrative-input.ts`, overview medians (`src/app/page.tsx`), live conflict-share median (`lib/live/detect.js`), Canada metro rent (`sync/train.js`), quality summary | True median everywhere | `accuracy.test.js` |
| 2 | **"Ahead of / behind the median" when a market *is* the median.** The Netherlands at 35.99% equals the median. | `lib/engine/narrative.js` (body and headline) | "in line with the median market" within 0.05 points | `accuracy.test.js` |
| 3 | **Utrecht province and Utrecht city merged** into one region, so city rows showed province sales. | `lib/sources/national/netherlands.js` | A province whose name matches a municipality is "Utrecht (province)" | `accuracy.test.js` |
| 4 | **BIS city series named from title fragments.** "8 cities", "127 cities", "whole country" (a national duplicate), "all dwellings. Rome", "excluding Dublin", "capital area", "rest of the country". | `lib/sources/bis.js` | `bisRegionName`: aggregates labelled, the "whole country" series dropped, remainders named ("Ireland excluding Dublin", "Rest of Croatia", "Metro Manila") | `accuracy.test.js` |
| 5 | **Raw BIS unit codes in source labels**, for example "(779)". | `lib/sources/bis.js` | `bisUnitLabel`: "index, December 2009 = 100", "AED per square metre", plus the vintage | `accuracy.test.js` |
| 6 | **Canada's income was mislabelled** "median household income". It is Statistics Canada's median total income of families and unattached individuals, in 2024 dollars. | `lib/engine/affordability.js`, `sync/train.js` | The basis now states the series | `accuracy.test.js` |
| 7 | **Canada's rent median label was wrong.** Called a median across CMHC metros, it ran over about 200 centres after the city expansion. | `sync/train.js` | Restricted to the 33 census metros (two-bedroom median C$1,598); rent-to-income for Canada is now 22.3% (was 25.5%) | covered by the recompute |
| 8 | **The overview breadcrumb read "index".** | `src/components/topbar.tsx` | Treat `/index` as the overview | n/a |

**Permanent checks** (`sync/quality.js`, Accuracy category, after every training run):
- `accuracy.source_sample`: a live re-fetch of BIS (Canada), FRED (US median price) and IMF (Canada inflation), compared with storage at 0.5% tolerance.
- `accuracy.region_names`: fails if source title fragments appear as places.
- `accuracy.unit_labels`: warns if raw BIS unit codes reappear.

All three pass on the current data.

## Rerun after the fixes

- Full pipeline rerun (seed, train, live, quality): 475,438 observations, run `run_202611010651`.
- Page reconciliation: 814 claims, no errors.
- One apparent rank difference (Poland, 18th) is a tie at the API's three decimals; at full precision Brazil is fractionally higher, so the page is right.

## Known limitations

These are not errors:
- **Placeholders on index cards.** A persona index with no data (for example the renter index where there is no rent index) shows "–".
- **Dubai prices on the cities table.** The BIS UAE city series are AED per square metre, which the cities table shows as a plain number. The source label states the unit.
- **Canada's income is in 2024 constant dollars.** Rents are current-year, which slightly understates rent-to-income.
- **Some stale or missing data.** OECD wage data were carried forward on this refresh because the OECD API returned nothing. India city coverage is limited to Delhi, Mumbai and an aggregate. Gulf price indexes end in 2023.
- **US metro names use the principal city.** For example "Arlington" is the Arlington-Alexandria-Reston, VA division. No two metros share a name.
