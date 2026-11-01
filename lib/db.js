// libSQL client shared by the sync scripts and the Next.js server.
// Production reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (set by the Vercel Marketplace
// integration). Local development and tests fall back to a file database.
import { createClient } from '@libsql/client';

export function databaseUrl() {
  return process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || 'file:local.db';
}

export function connect(url = databaseUrl()) {
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

// Multi-row INSERT OR REPLACE in chunks. libSQL caps bound parameters per statement.
export async function upsertRows(db, table, columns, rows, chunk = Math.max(1, Math.floor(900 / columns.length))) {
  if (!rows.length) return 0;
  const statements = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    statements.push({ sql: `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, args: slice.flatMap(row => columns.map(c => row[c] ?? null)) });
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50), 'write');
  return rows.length;
}
