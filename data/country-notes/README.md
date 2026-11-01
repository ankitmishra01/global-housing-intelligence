# Country notes

Curated, sourced context for each Tier 1 market: how mortgages work, the policies in force,
supply and demand conditions, and what the official price index measures. One JSON file per
country (`<ISO3>.json`). `sync/notes.js` loads them into the Turso table `country_notes`, and the
country page weaves them into the written analysis with their sources.

Every note cites at least one official or reputable source that was opened when it was written.
Notes are reviewed when a source changes; `asOf` is the date of the last review.
