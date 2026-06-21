// ---------------------------------------------------------------------------
// Auth STUB — prototype only.
//
// STUB: replace with Auth.js (NextAuth core) session.
// Real auth resolves the session from the request inside each server fn. For
// the prototype we return a fixed demo session so every query resolves to real
// seeded rows. The seed (src/db/seed.ts) inserts the firm + primary user with
// these EXACT ids so the stub lines up with the database.
// ---------------------------------------------------------------------------

/** Fixed demo firm id — must match the firm inserted by the seed. */
export const DEMO_FIRM_ID = '00000000-0000-4000-8000-000000000001'

/** Fixed demo user id — must match the primary (attorney) user in the seed. */
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002'

export type Role = 'attorney' | 'paralegal' | 'admin' | 'client'

export interface Session {
  firmId: string
  userId: string
  role: Role
}

/**
 * STUB: replace with Auth.js session lookup.
 * Returns the fixed demo session.
 */
export function getSession(): Session {
  return {
    firmId: DEMO_FIRM_ID,
    userId: DEMO_USER_ID,
    role: 'attorney',
  }
}

/**
 * STUB: replace with Auth.js current-user resolution.
 * For the prototype this is the same shape as the session.
 */
export function getCurrentUser(): Session {
  return getSession()
}
