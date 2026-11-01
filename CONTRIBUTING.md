# Contributing to Global Housing Intelligence

Thanks for helping. This project publishes numbers that people may use to make housing decisions, so every change follows a few strict rules. Please read them before you open a pull request.

## The honesty rules

1. **Models must earn their place.** Any change to the projection engine (`lib/engine/projections.js` and friends) must win on held-out backtests. A candidate is kept only if it beats both baselines (no real change, and the country's historical trend) on the later, unseen origins by the skill margin. Include the before/after backtest table (`node sync/train.js --dry-run`) in your PR.
2. **Sources are verified and attributed.** Fetch every new endpoint live before relying on it. Check its licence and terms, credit it the way the licence asks (in the `source` string of each row, the site footer and the README), and never bypass captchas, logins or rate limits.
3. **No invented data.** If a country has no official house price index it stays Tier 2, and its page says so. Proxies (for example the US policy rate for dollar-pegged currencies) must be labelled as proxies wherever they appear.
4. **Measurement, modelling and narration stay separate.** Adapters measure, the engine models, the UI renders, and the LLM only explains numbers that already exist.

## Development setup

Requirements: Node 22 or later.

```bash
git clone https://github.com/ankitmishra01/global-housing-intelligence
cd global-housing-intelligence
npm install
```

The database is Turso (libSQL). Put credentials in `.env.local` (never commit it):

```bash
TURSO_DATABASE_URL=libsql://<db>-<org>.turso.io
TURSO_AUTH_TOKEN=<token>          # turso db tokens create <db>
AI_GATEWAY_API_KEY=<optional>     # only for Ask AI
```

With `TURSO_DATABASE_URL` unset, everything falls back to a local file database (`file:local.db`), which is fine for development. Load the variables into your shell before running the sync scripts:

```bash
set -a && . ./.env.local && set +a
```

## Running the pipeline

```bash
node db/migrate.js                # apply db/schema.sql (idempotent)
node sync/seed.js --dry-run       # fetch and validate every source, write nothing (report in sync/report.json)
node sync/seed.js                 # fetch, validate and write observations
node sync/train.js --dry-run      # train and print the backtest table, write nothing
node sync/train.js                # write a new projection run
node sync/live.js                 # daily live layer: rates, events, adjustments (--backfill 90 on a fresh database)
node sync/quality.js --dry-run    # run the data quality checks without writing
npm run dev                       # http://localhost:3000
```

## Tests and checks

```bash
npm test             # node:test suites in tests/
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

All three must pass. Parsers are tested on small text fixtures in `tests/fixtures/`, never on live network calls.

## Add a national adapter

National adapters add data the international sources do not carry: local-currency price and rent levels, city and regional rows, dwelling types, vacancy, construction, mortgage rates and sales volumes. The existing adapters in `lib/sources/national/` (`canada.js`, `united-kingdom.js`, `dubai.js` and others) are the best reference.

### 1. Write the adapter

Create `lib/sources/national/<country>.js` with two kinds of export:

- **Pure parsers** (`parseX(text)`) that turn the raw CSV/JSON/markdown into rows. These are what the tests exercise.
- **One fetcher** (`fetchX()`) that downloads with `fetchText` / `fetchJson` / `fetchBuffer` from `lib/sources/util.js` (they retry; pass `backoffMs` for flaky APIs) and returns the parsed rows.

Each row has this shape:

```js
{
  country: 'FRA',          // ISO3
  indicator: 'AVG_PRICE',  // a key with a range in lib/validate.js
  region: '',              // '' for national rows; a city or region name otherwise
  dwelling_type: '',       // '' for all dwellings; or house, detached, semi_detached, townhouse, condo
  period: '2026-09',       // YYYY, YYYY-Qn or YYYY-MM
  frequency: 'M',          // A, Q or M (must match the period format)
  value: 412345,
  source: 'Agency name, series name (licence)',
}
```

Conventions:

- Emit annual (`A`) rows as well as monthly or quarterly ones. Use `annualAverage()` from `lib/sources/util.js`, which only keeps complete years.
- Regional rows never feed the national model. Only `region: ''` rows do.
- Use an existing indicator key where the meaning matches (`AVG_PRICE`, `MEDIAN_PRICE`, `AVG_RENT`, `VACANCY_RATE`, `HOUSING_STARTS`, `MORTGAGE_RATE`, `SALES_COUNT`, `TYPE_PRICE_LEVEL` and so on). If you add a new key, export an indicator list from the adapter:

```js
export const FRANCE_INDICATORS = [
  { key: 'NEW_KEY', label: 'Readable label', unit: 'local currency', source: 'National statistics office', frequency: 'Q' },
];
```

### 2. Add plausible ranges

Add a `[min, max]` entry for every new indicator to `RANGES` in `lib/validate.js`. Values outside the range are rejected as unit or source errors.

### 3. Register it

In `lib/sources/national/index.js`, import the fetcher and indicator list, add an entry to `NATIONAL_ADAPTERS`:

```js
{ iso3: 'FRA', agencies: 'INSEE (Etalab Open Licence)', fetch: fetchFrance },
```

and add the indicator list to `NATIONAL_INDICATORS`. A failing adapter is logged and skipped; it never blocks the international refresh.

### 4. Test it

Save a few real rows of the source's response as a fixture in `tests/fixtures/` and add a test (see `tests/dubai.test.js` or `tests/sources.test.js`) that checks your parser's output: countries, indicators, periods, regions and values.

### 5. Verify end to end

```bash
node sync/seed.js --dry-run     # your rows appear in the national section, nothing rejected
```

Then check the country page locally: the national agency table and any city rows should show your data with its source.

## Add an event class

Event classes live in two places:

- **`lib/engine/events.js`:** `EVENT_CLASSES` (label and description) and `EPISODES` (curated historical episodes). The trainer estimates each class's typical effect on real prices and rents from these episodes.
- **`lib/live/detect.js`:** the rules that detect an active event from live signals (`detectEvents`, `detectSalesSlumps`).

An event only moves projections when its historical effect is statistically clear (see `lib/live/shifts.js`). Add tests for both the episode study and the detection rule.

## Pull requests

- Keep each PR to one change and explain why it is needed.
- Fill in the PR template checklist.
- Do not commit `.env*` files, database files or downloaded data.
