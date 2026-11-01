#!/usr/bin/env node
// Applies db/schema.sql (idempotent). Run: node db/migrate.js
import fs from 'node:fs';
import { connect, databaseUrl } from '../lib/db.js';

export async function migrate(db) {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.executeMultiple(sql);
  // Columns added after a table first shipped. SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
  const addColumn = async (table, column, ddl) => {
    const { rows } = await db.execute(`PRAGMA table_info(${table})`);
    if (!rows.some(r => r.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  await addColumn('rate_sensitivity', 'method', "method TEXT NOT NULL DEFAULT 'ridge'");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = connect();
  await migrate(db);
  console.log(`Schema applied to ${databaseUrl().replace(/\?.*$/, '')}`);
}
