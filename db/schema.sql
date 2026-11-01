-- Global Housing Intelligence: libSQL / Turso schema.
-- Every statement is idempotent so db/migrate.js can run it on each deploy.

CREATE TABLE IF NOT EXISTS countries (
  iso3          TEXT PRIMARY KEY,
  iso2          TEXT,
  name          TEXT NOT NULL,
  region        TEXT,
  income_group  TEXT,
  tier          INTEGER NOT NULL DEFAULT 2,   -- 1: house price series, 2: drivers only
  has_price     INTEGER NOT NULL DEFAULT 0,
  has_rent      INTEGER NOT NULL DEFAULT 0,
  has_national  INTEGER NOT NULL DEFAULT 0,   -- national agency adapter present
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indicators (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  unit       TEXT NOT NULL,
  source     TEXT NOT NULL,
  frequency  TEXT NOT NULL,
  description TEXT
);

-- region '' is the national series; national agencies also publish city rows.
CREATE TABLE IF NOT EXISTS observations (
  country    TEXT NOT NULL,
  indicator  TEXT NOT NULL,
  region     TEXT NOT NULL DEFAULT '',
  dwelling_type TEXT NOT NULL DEFAULT '',     -- '' all dwellings; house, detached, semi_detached, townhouse, condo
  period     TEXT NOT NULL,                  -- 2025, 2025-Q3 or 2025-09
  frequency  TEXT NOT NULL,                  -- A, Q or M
  value      REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'actual', -- actual or forecast (IMF WEO years)
  source     TEXT NOT NULL,
  vintage    TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (country, indicator, region, dwelling_type, period, frequency)
);
CREATE INDEX IF NOT EXISTS observations_indicator ON observations (indicator, frequency, period);

CREATE TABLE IF NOT EXISTS projection_runs (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  model_version TEXT NOT NULL,
  data_vintage  TEXT NOT NULL,
  summary       TEXT NOT NULL                -- JSON: methods, limits, index weights, distributions
);

CREATE TABLE IF NOT EXISTS projections (
  run_id     TEXT NOT NULL,
  country    TEXT NOT NULL,
  target     TEXT NOT NULL,   -- real_price, nominal_price, real_rent, nominal_rent, price_to_rent
  year       INTEGER NOT NULL,
  horizon    INTEGER NOT NULL,
  p10 REAL NOT NULL, p25 REAL NOT NULL, median REAL NOT NULL, p75 REAL NOT NULL, p90 REAL NOT NULL,
  method     TEXT NOT NULL,
  PRIMARY KEY (run_id, country, target, horizon)
);

CREATE TABLE IF NOT EXISTS backtests (
  run_id        TEXT NOT NULL,
  target        TEXT NOT NULL,
  horizon       INTEGER NOT NULL,
  method        TEXT NOT NULL,
  status        TEXT NOT NULL,
  mae REAL, rmse REAL, baseline_mae REAL, baseline_rmse REAL,
  skill_pct     REAL,
  coverage80    REAL,
  n_origins     INTEGER NOT NULL,
  n_records     INTEGER NOT NULL,
  basis         TEXT,
  PRIMARY KEY (run_id, target, horizon)
);

-- Pooled model-implied change in cumulative log growth (x100) per +1pp rate move.
CREATE TABLE IF NOT EXISTS rate_sensitivity (
  run_id   TEXT NOT NULL,
  target   TEXT NOT NULL,
  horizon  INTEGER NOT NULL,
  coef     REAL NOT NULL,
  se       REAL NOT NULL,
  valid    INTEGER NOT NULL,
  note     TEXT,
  PRIMARY KEY (run_id, target, horizon)
);

CREATE TABLE IF NOT EXISTS risk_flags (
  run_id    TEXT NOT NULL,
  country   TEXT NOT NULL,
  flag      TEXT NOT NULL,
  value     REAL NOT NULL,
  threshold REAL NOT NULL,
  as_of     TEXT NOT NULL,
  PRIMARY KEY (run_id, country, flag)
);

CREATE TABLE IF NOT EXISTS persona_indexes (
  run_id     TEXT NOT NULL,
  country    TEXT NOT NULL,
  persona    TEXT NOT NULL,   -- investor, buyer, renter, seller
  score      REAL NOT NULL,
  rank       INTEGER NOT NULL,
  components TEXT NOT NULL,   -- JSON: [{key, value, percentile, weight}]
  PRIMARY KEY (run_id, country, persona)
);

-- Per-country inputs the browser needs for the rate toggle and mortgage panel.
CREATE TABLE IF NOT EXISTS country_context (
  run_id          TEXT NOT NULL,
  country         TEXT NOT NULL,
  origin_year     INTEGER NOT NULL,
  rent_origin_year INTEGER,
  policy_rate     REAL,
  policy_rate_as_of TEXT,
  mortgage_rate   REAL,
  mortgage_rate_source TEXT,
  details         TEXT NOT NULL,   -- JSON
  PRIMARY KEY (run_id, country)
);

-- ── Live layer (daily): current rates, detected events, and the shifts they apply ──

-- Daily signal history per country (conflict mention counts, FX, policy rate) for baselines.
CREATE TABLE IF NOT EXISTS live_signals (
  country TEXT NOT NULL,
  signal  TEXT NOT NULL,      -- conflict_mentions, fx_usd, policy_rate
  date    TEXT NOT NULL,      -- YYYY-MM-DD
  value   REAL NOT NULL,
  PRIMARY KEY (country, signal, date)
);

-- Detected events. Applied automatically while status = 'active'.
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,          -- <iso3>:<class>:<onset>
  country    TEXT NOT NULL,
  class      TEXT NOT NULL,             -- armed_conflict, regional_conflict, natural_disaster, currency_crisis
  status     TEXT NOT NULL,             -- active, expired
  onset      TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  intensity  REAL NOT NULL,             -- z-score or alert level, see metric
  metric     TEXT NOT NULL,
  evidence   TEXT NOT NULL,             -- JSON: what triggered it (counts, alert names, FX move)
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_status ON events (status, country);

-- Historical event study per training run: how far real prices/rents moved vs the model
-- after past episodes of each class (x100 log points), shrunk toward zero for small n.
CREATE TABLE IF NOT EXISTS event_library (
  run_id     TEXT NOT NULL,
  class      TEXT NOT NULL,
  target     TEXT NOT NULL,             -- real_price, real_rent
  horizon    INTEGER NOT NULL,          -- 1, 2, 3
  effect     REAL NOT NULL,
  se         REAL NOT NULL,
  n_episodes INTEGER NOT NULL,
  episodes   TEXT NOT NULL,             -- JSON [{country, year, residual}]
  PRIMARY KEY (run_id, class, target, horizon)
);

-- Shifts applied on top of the latest projection run (x100 log points on the cumulative path).
CREATE TABLE IF NOT EXISTS live_adjustments (
  as_of    TEXT NOT NULL,
  country  TEXT NOT NULL,
  target   TEXT NOT NULL,               -- same targets as projections (incl. real_price:<type>)
  horizon  INTEGER NOT NULL,
  shift    REAL NOT NULL,
  extra_se REAL NOT NULL,
  PRIMARY KEY (as_of, country, target, horizon)
);

-- One row per country: what the live layer applied and why.
CREATE TABLE IF NOT EXISTS live_state (
  country            TEXT PRIMARY KEY,
  as_of              TEXT NOT NULL,
  run_id             TEXT NOT NULL,
  policy_rate_now    REAL,
  policy_rate_date   TEXT,
  policy_rate_origin REAL,
  rate_delta         REAL,
  events             TEXT NOT NULL,     -- JSON [{id, class, onset, intensity, metric, effect3, n_episodes}]
  shift10_price      REAL,
  shift10_rent       REAL,
  explanation        TEXT NOT NULL      -- JSON lines shown on the page
);

CREATE TABLE IF NOT EXISTS persona_indexes_live (
  as_of      TEXT NOT NULL,
  country    TEXT NOT NULL,
  persona    TEXT NOT NULL,
  score      REAL NOT NULL,
  rank       INTEGER NOT NULL,
  components TEXT NOT NULL,
  PRIMARY KEY (as_of, country, persona)
);

-- Human-readable change log for the /live page.
CREATE TABLE IF NOT EXISTS live_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT NOT NULL,
  country TEXT NOT NULL,
  kind    TEXT NOT NULL,                -- rate_change, event_start, event_end, adjustment
  message TEXT NOT NULL,
  delta10 REAL
);
CREATE INDEX IF NOT EXISTS live_log_date ON live_log (date);

-- Data quality checks: one row per check per run of sync/quality.js (last 30 runs kept).
CREATE TABLE IF NOT EXISTS data_quality (
  run_at   TEXT NOT NULL,
  check_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,              -- pass, warn, fail
  summary  TEXT NOT NULL,
  details  TEXT NOT NULL,              -- JSON
  PRIMARY KEY (run_at, check_id)
);

-- Public API / MCP rate limiting: fixed windows per salted IP hash and bucket (api, mcp).
CREATE TABLE IF NOT EXISTS api_rate (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- ── Track record and scenario sensitivities (wave 1, engine) ──

-- Pseudo-out-of-sample backtest predictions of the shipped method, per country and origin.
CREATE TABLE IF NOT EXISTS backtest_points (
  run_id    TEXT NOT NULL,
  country   TEXT NOT NULL,
  target    TEXT NOT NULL,      -- real_price, real_rent
  horizon   INTEGER NOT NULL,   -- 1, 3, 5
  origin    INTEGER NOT NULL,
  predicted REAL NOT NULL,      -- cumulative real growth, x100 log points
  actual    REAL NOT NULL,
  method    TEXT NOT NULL,
  PRIMARY KEY (run_id, country, target, horizon, origin)
);

-- Real track record: past runs' projections scored once their target year is observed.
CREATE TABLE IF NOT EXISTS vintage_scores (
  vintage_run_id   TEXT NOT NULL,
  country          TEXT NOT NULL,
  target           TEXT NOT NULL,
  horizon          INTEGER NOT NULL,
  target_year      INTEGER NOT NULL,
  projected_median REAL NOT NULL,   -- index, origin = 100
  p10              REAL NOT NULL,
  p90              REAL NOT NULL,
  actual           REAL NOT NULL,   -- index, origin = 100
  error            REAL NOT NULL,   -- actual - projected_median, index points
  in80             INTEGER NOT NULL,
  scored_at        TEXT NOT NULL,
  PRIMARY KEY (vintage_run_id, country, target, horizon)
);

-- Pooled effect of +1 unit of a driver on cumulative real growth (x100 log), for the scenario builder.
CREATE TABLE IF NOT EXISTS feature_sensitivity (
  run_id  TEXT NOT NULL,
  target  TEXT NOT NULL,          -- real_price, real_rent
  feature TEXT NOT NULL,          -- unemployment_change, real_wage_growth, real_gdp_growth
  horizon INTEGER NOT NULL,
  coef    REAL NOT NULL,
  se      REAL NOT NULL,
  valid   INTEGER NOT NULL,
  note    TEXT,
  PRIMARY KEY (run_id, target, feature, horizon)
);

-- One row per seed run: the summary the quality checks need (sync/report.json stays local).
CREATE TABLE IF NOT EXISTS seed_runs (
  run_at            TEXT PRIMARY KEY,
  observations      INTEGER NOT NULL,
  rejected          INTEGER NOT NULL,
  tier1             INTEGER NOT NULL,
  carried_forward   TEXT NOT NULL,   -- JSON [{source, error, rows}]
  national_failures TEXT NOT NULL,   -- JSON [{iso3, error}]
  gate_failures     TEXT NOT NULL    -- JSON [string]
);
