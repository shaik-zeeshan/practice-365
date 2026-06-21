import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Load .env (via "dotenv/config" above) so the drizzle-kit CLI can read
// DATABASE_URL when running generate/migrate/push.

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
