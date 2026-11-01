# Global Housing Intelligence

House prices and rents for every economy, with 10-year projections tested against history, an interest-rate toggle, prices by dwelling type, and indexes for investors, buyers, renters and sellers.

Sibling of [global-economic-intelligence](https://github.com/ankitmishra01/global-economic-intelligence). Same rules: statistical code produces every number, the browser renders them, and an LLM may explain supplied facts but never generates a projection.

## Contents

- [What it does](#what-it-does)
- [Pages](#pages)
- [Data sources and coverage](#data-sources-and-coverage)
- [Projection engine](#projection-engine)
- [Interest-rate toggle](#interest-rate-toggle)
- [Persona indexes](#persona-indexes)
- [Risk flags](#risk-flags)
- [National agency adapters](#national-agency-adapters)
- [Architecture](#architecture)
- [Run locally](#run-locally)
- [Environment variables](#environment-variables)
- [Automation](#automation)
- [Testing](#testing)
- [Known limits](#known-limits)

## What it does

- Collects house price, rent, valuation, credit, rate and demographic data for all 217 World Bank economies.
- Projects real and nominal house prices and rents 1 to 10 years ahead, with empirical 50% and 80% ranges.
- Backtests every horizon against two baselines. If the model doesn't beat them on held-out years, the baseline is what gets shown, and the UI says so.
- Lets the user move interest rates from −3 to +3 percentage points and redraws the buy and rent paths, the buy-vs-rent costs and the persona indexes.
- Splits prices by dwelling type (condos/flats, houses, detached, semi-detached, townhouses) where a source publishes it.
- Adds national agency data (CMHC, Statistics Canada, Bank of Canada, US Census/BLS/Freddie Mac, Zillow Research, HM Land Registry, ABS): local-currency prices and rents, vacancy rates, housing starts, mortgage rates and city rows.

## Pages

| Route | Purpose |
|---|---|
| `/` | Overview: world map of 10-year projected real price change, strongest and weakest outlooks, top markets by persona, risk register |
| `/countries` | All 217 economies with a tier badge |
| `/countries/[iso3]` | Price and rent fan charts, the rate toggle, dwelling types, buy-vs-rent calculator, persona cards, national data, drivers |
| `/indexes` | League tables for the investor, buyer, renter and seller indexes |
| `/compare?c=CAN,AUS,GBR` | Two to four countries side by side |
| `/methodology` | Sources, the live backtest table, rate sensitivities, flag thresholds, index weights, limits |
| `/ask` | Ask AI: explains stored facts, with a numeric guardrail |
| `/api/v1/*` | Cached JSON for countries, projections and indexes |

## Data sources and coverage

| Source | Series | Coverage |
|---|---|---|
| BIS selected residential property prices (`WS_SPP`) | Real and nominal house price index, quarterly | ~57 economies |
| BIS detailed residential property prices (`WS_DPP`) | Prices by dwelling type | ~25 economies |
| BIS total credit (`WS_TC`) and credit gaps | Household credit % of GDP, credit-to-GDP gap | ~43 |
| BIS central bank policy rates (`WS_CBPOL`) | Monthly policy rate (euro members inherit the ECB rate from their joining year) | ~58 |
| OECD Analytical House Prices | Rent index, price-to-income and price-to-rent vs long-run average, OECD price indexes | ~43 rent, ~25 valuation |
| IMF World Economic Outlook (DataMapper) | Inflation and real GDP growth, history plus ~5-year forecasts | ~194 |
| World Bank WDI | Population and urban growth, urban share, GDP per head, lending and real rates, private credit, CPI | 217 |
| National agencies | See [National agency adapters](#national-agency-adapters) | CAN, USA, GBR, AUS |

**Tiers.** Tier 1 means an official house price index exists: about 58 economies, about 43 of them with a rent index. Tier 2 is every other economy, about 159. Tier 2 pages show housing drivers only and state that no official price index is published. Nothing is invented for them.

**Dwelling types** (countries with an annual series, as of the first run): condo/flat 22, house 20, townhouse/terraced 7, detached 6, semi-detached 1 (UK). The seed report (`sync/report.json`) prints the current counts.

## Projection engine

Code: `lib/engine/projections.js`, run by `sync/train.js`.

- **Targets.** Cumulative real log growth of: the house price index (`real_price`), the OECD rent index deflated by a CPI chained from IMF inflation (`real_rent`), and each country × dwelling-type price index (`type_price`).
- **Model.** Pooled ridge regression fitted directly at horizons 1, 2, 3, 5, 7 and 10, with years in between interpolated. Features:
  - 1-year and 3-year momentum
  - price-to-income and price-to-rent gaps
  - real policy rate and its 1-year change
  - 3-year household credit change and the credit-to-GDP gap
  - population growth and real GDP growth
  - cross momentum
  - dwelling-type indicators (type model only)
  - Missing predictors are mean-imputed. Outcomes are never imputed.
- **Baselines.** No real change, and the country's own historical real trend (mean of the last 8 to 20 years).
- **Honesty rules.**
  - Rolling-origin backtests from 1995. Training only uses samples whose target year was already observed at the test origin.
  - The method is chosen on the early origins and scored on the later held-out origins.
  - The model is kept only if it beats the best baseline on both halves.
  - A trend baseline that loses to no-change on the held-out origins falls back to no-change.
  - The current skill, error and coverage figures are rendered live on `/methodology` from the `backtests` table. They are not hardcoded here.
- **Ranges.** Empirical residual quantiles per horizon (p10, p25, p75, p90), held non-decreasing so the fan never narrows with distance.
- **Nominal paths.** Real path plus IMF WEO inflation, with the last WEO year held flat to year 10.
- **Price-to-rent.** The nominal price path minus the nominal rent path, with errors combined as independent.

## Interest-rate toggle

- **Estimating the sensitivity.** For each target and horizon, the trainer stores the pooled change in cumulative real growth per +1pp sustained rate move (the sum of the ridge coefficients on the real policy rate and its change), with a cluster-bootstrap standard error (`rate_sensitivity` table).
- **Applying it in the browser.**
  - Adjusted path = base path + coefficient × Δ.
  - The band widens by the standard error × |Δ| (1.28× at the 80% edges, 0.67× at the 50% edges).
- **Sign rules.**
  - Prices must fall when rates rise. A wrong-signed estimate at any horizon disables the toggle for that target, and the page says why.
  - The rent sign is estimated freely, since higher rates can push households into renting.
- **Buy vs rent.** The monthly mortgage payment at the chosen rate (principal and interest, user-set down payment and amortisation) is compared with projected rent.
  - Default mortgage rates: Bank of Canada 5-year conventional (posted) for Canada, Freddie Mac 30-year fixed for the US.
  - Elsewhere: the policy rate plus an assumed 2.0pp spread, labelled as such.

## Persona indexes

Code: `lib/engine/indexes.js`. It's shared by the trainer, which stores scores per run, and by the browser, which recomputes them under the toggle.

- **Scoring.** Each index is a weighted average of percentile ranks across Tier 1 economies, oriented so that 100 is most favourable for that persona.
- **Missing data.** A score needs at least half its weight available.

| Persona | Components (weight, direction) |
|---|---|
| Investor | 10-year projected real price growth (0.35, higher), price-to-rent gap (0.25, lower), risk flag count (0.15, lower), household debt % GDP (0.10, lower), 15-year real price volatility (0.15, lower) |
| Buyer | Price-to-income gap (0.30, lower), 3-year change in mortgage payment burden (0.25, lower), last-year real price growth (0.20, lower), 3-year projected real price growth (0.25, higher) |
| Renter | 10-year projected real rent growth (0.40, lower), real rent growth minus real income growth over 5 years (0.30, lower), price-to-rent gap (0.30, higher) |
| Seller | Valuation vs long-run average (0.35, higher), last-year real price growth (0.20, higher), 3-year projected real price growth (0.30, lower), 12-month policy rate change (0.15, higher) |

Under the toggle, only the rate-sensitive components move: projected growth, mortgage burden and rate trend. The country is scored against the other economies at current rates.

## Risk flags

Code: `lib/engine/flags.js`. A flag is raised when:
- price-to-income or price-to-rent is more than 20% above its long-run average
- real house prices are up more than 10% year on year (latest quarter)
- the credit-to-GDP gap is above 10pp
- real rents outgrew real GDP per head three years running

## National agency adapters

`lib/sources/national/`:

| File | Country | Agencies and series |
|---|---|---|
| `canada.js` | CAN | CMHC Rental Market Survey (two-bedroom rents and vacancy, 9 metros plus the CMA total), CMHC starts, StatCan New Housing Price Index, Bank of Canada 5-year mortgage rate |
| `united-states.js` | USA | FRED: Census median sales price, BLS CPI rent, Freddie Mac 30-year rate, Census housing starts and rental vacancy |
| `zillow.js` | USA | Zillow Research ZHVI condo vs single-family values, ZORI market rent (national) |
| `united-kingdom.js` | GBR | HM Land Registry UK HPI: average price for the UK and the four nations, by detached / semi-detached / terraced / flat |
| `australia.js` | AUS | ABS mean dwelling price, national and by state |

**Adding a country:**
1. Create `lib/sources/national/<country>.js` exporting `fetchX()`, which returns rows of the form `{ country, indicator, region, dwelling_type, period, frequency, value, source }`, plus an `X_INDICATORS` list for any new indicator keys.
2. Add a range for each new indicator in `lib/validate.js`.
3. Register the adapter in `NATIONAL_ADAPTERS` in `lib/sources/national/index.js`.
4. Add a parser test on a small fixture in `tests/`.

A failing national adapter is logged and skipped. It never blocks the international refresh.

## Architecture

```text
BIS · OECD · IMF · World Bank · national agencies
                  │
            sync/seed.js         normalise, validate ranges, coverage gates
                  │
          Turso (libSQL)  ◀────  sync/train.js   projections, backtests, rate
                  │                              sensitivity, flags, indexes
                  │  @libsql/client, server only
                  ▼
      Next.js App Router on Vercel (ISR, daily revalidation)
                  │
     pages · /api/v1/* JSON · /api/agent (Ask AI)
```

The database schema is in `db/schema.sql`. It's applied idempotently by `db/migrate.js`, which runs at the start of every seed and train. Every training run writes a versioned `projection_runs` row, and the pages read the latest one.

## Run locally

```bash
npm install
node db/migrate.js
node sync/seed.js        # or: node sync/seed.js --dry-run  (no writes, writes sync/report.json)
node sync/train.js       # or: node sync/train.js --dry-run (prints the backtest table)
npm run dev
```

With `TURSO_DATABASE_URL` unset, everything uses a local file database, `file:local.db`. Set the Turso variables to work against the hosted database.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `TURSO_DATABASE_URL` | app, sync | libSQL URL (`libsql://…`). Defaults to `file:local.db` |
| `TURSO_AUTH_TOKEN` | app, sync | Turso database token |
| `AI_GATEWAY_API_KEY` | `/api/agent` | Vercel AI Gateway key for Ask AI (on Vercel, OIDC is used automatically) |

GitHub Actions secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and optionally `VERCEL_DEPLOY_HOOK_URL`. Repository variable: `PRODUCTION_URL`.

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| `ci.yml` | push, PR | Tests, typecheck, then a build against an empty migrated file database |
| `refresh.yml` | 06:17 UTC on the 3rd of each month, plus manual | Seed → train → write a new run to Turso → trigger the Vercel deploy hook; opens an issue on failure |
| `probe.yml` | every 6 hours | Checks `/api/v1/countries` serves ≥150 economies and the latest run is under 40 days old; opens one issue on failure |

## Testing

```bash
npm test
```

The tests cover:
- every source parser, on small text fixtures in `tests/fixtures/`
- validation and coverage gates
- the projection engine, on a synthetic panel with a known rate effect: rate coefficient sign and validity, band widening, and baseline fallback on a pure-noise rent series
- interpolation and band monotonicity
- the index scoring and toggle math
- the risk flags
- `buildRun` end to end
- the probe's run-date parsing

## Known limits

- Official price indexes exist for about 58 economies and rent indexes for about 43. Tier 2 economies get drivers only.
- Ten-year backtests rest on far fewer independent origins than one-year backtests, and overlapping windows make long-horizon skill noisy. Check `n_origins` on `/methodology`.
- Rate sensitivity is pooled across countries. It is a model-implied association, not a causal estimate, and it is the same for every country.
- Dwelling-type coverage is uneven. The type model is pooled across all type series and backtested separately.
- Nominal paths hold the last IMF WEO inflation forecast flat to year 10.
- The buy-vs-rent calculator ignores taxes, fees, maintenance and the return on a down payment.
- Projections are statistical estimates with published error rates, not financial advice.
