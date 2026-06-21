import { getSession } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Tenant resolution.
//
// GUARDRAIL (STACK.md §6): every DB query MUST filter by this firmId, which
// comes from the session — NEVER from client-supplied input. Do not accept a
// firmId from the request body/params.
// ---------------------------------------------------------------------------

/** The current tenant's firm id, taken from the (stub) session. */
export function getFirmId(): string {
  return getSession().firmId
}
