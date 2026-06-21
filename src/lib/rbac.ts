import type { Role } from '@/lib/auth'

// ---------------------------------------------------------------------------
// RBAC STUB — minimal role/action check.
//
// Staff roles (attorney, paralegal, admin) can read and write. Portal clients
// can read but never write. Real policy comes later with Auth.js.
// ---------------------------------------------------------------------------

export type Action = 'read' | 'write'

const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  'attorney',
  'paralegal',
  'admin',
])

/** Returns whether `role` may perform `action`. */
export function can(role: Role, action: Action): boolean {
  if (action === 'write') {
    return STAFF_ROLES.has(role) // clients cannot write
  }
  // reads allowed for any authenticated role
  return true
}
