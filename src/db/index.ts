import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// ---------------------------------------------------------------------------
// Drizzle client (node-postgres driver).
//
// The connection string ALWAYS comes from process.env.DATABASE_URL — Postgres
// is configured through the environment (local Docker today, Neon on Vercel
// later). We throw early with a clear message if it is missing.
//
// Serverless-safe: in dev (and under serverless function reuse) modules can be
// re-evaluated repeatedly, which would otherwise leak Pools. We cache a single
// Pool on globalThis so it is reused across reloads / warm invocations.
// ---------------------------------------------------------------------------

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Define it in your environment (.env locally, ' +
      'Neon connection string on Vercel) before using the database.',
  )
}

type GlobalWithPool = typeof globalThis & {
  __practice365Pool?: Pool
}

const globalForDb = globalThis as GlobalWithPool

export const pool =
  globalForDb.__practice365Pool ?? new Pool({ connectionString })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__practice365Pool = pool
}

export const db = drizzle(pool, { schema })

// Re-export the schema so callers can do `import { db, timeEntries } from "@/db"`.
export * from './schema'
export { schema }
