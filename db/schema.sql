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
