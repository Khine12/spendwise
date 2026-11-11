/**
 * Database layer.
 * - Production (Vercel): Neon serverless Postgres via DATABASE_URL.
 * - Local / tests: PGlite (real Postgres compiled to WASM), no setup needed.
 * Both speak the same SQL, so the rest of the app doesn't care which one runs.
 */
type Row = Record<string, unknown>;

export interface DB {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS expenses (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     amount NUMERIC(12,2) NOT NULL,
     currency TEXT NOT NULL DEFAULT 'USD',
     amount_usd NUMERIC(12,2) NOT NULL,
     category TEXT NOT NULL,
     merchant TEXT,
     note TEXT,
     spent_on DATE NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS expenses_user_date ON expenses (user_id, spent_on DESC)`,
  `CREATE TABLE IF NOT EXISTS budgets (
     user_id TEXT NOT NULL,
     category TEXT NOT NULL,
     monthly_limit NUMERIC(12,2) NOT NULL,
     PRIMARY KEY (user_id, category)
   )`,
  `CREATE TABLE IF NOT EXISTS pending_actions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     request_id TEXT NOT NULL,
     action JSONB NOT NULL,
     summary TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     request_id TEXT,
     event TEXT NOT NULL,
     action_type TEXT,
     detail JSONB,
     status TEXT NOT NULL,
     message TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS audit_user_time ON audit_log (user_id, created_at DESC)`,
];

let dbPromise: Promise<DB> | null = null;

async function createDB(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  let db: DB;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    db = { query: async (q, p = []) => (await sql.query(q, p)) as never };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    // PGLITE_DIR="memory" gives a throwaway DB (used by tests).
    // On Vercel the project folder is read-only, so fall back to /tmp (data is NOT durable there).
    const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? "/tmp/pglite" : "./.pglite");
    if (process.env.VERCEL) console.warn("[db] DATABASE_URL not set: using temporary storage. Connect Neon for durable data.");
    const pg = dir === "memory" ? new PGlite() : new PGlite(dir);
    db = { query: async (q, p = []) => (await pg.query(q, p)).rows as never };
  }
  for (const stmt of SCHEMA) await db.query(stmt);
  return db;
}

export function getDB(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = createDB().catch((err) => {
      dbPromise = null; // allow retry on next request
      throw err;
    });
  }
  return dbPromise;
}
