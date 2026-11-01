#!/usr/bin/env node
// Applies db/schema.sql (idempotent). Run: node db/migrate.js
import fs from 'node:fs';
import { connect, databaseUrl } from '../lib/db.js';

export async function migrate(db) {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.executeMultiple(sql);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = connect();
  await migrate(db);
  console.log(`Schema applied to ${databaseUrl().replace(/\?.*$/, '')}`);
}
