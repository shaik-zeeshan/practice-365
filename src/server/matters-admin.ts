import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { matters, matterClients, clients, users } from '@/db/schema'
import { getSession } from '@/lib/auth'

// ===========================================================================
// Matter "admin" read model (NEW file — does not touch src/server/matters.ts).
//
// The matter-management page (/matters) needs more per-row detail than the
// modal's MatterOption ({ id, name, clientName, rate }) carries: the linked
// client id (to pre-fill the edit form / can't-change-client note), the
// responsible attorney (id + name, to show and edit), and the matter status.
//
// Rather than widen the shared listMatters() shape (and risk the modal's
// ['matters'] cache), this exposes a dedicated, firm-scoped read model under
// its own query key. Same conventions as src/server/matters.ts:
//   - resolve { firmId } from the (stub) session,
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6).
// ===========================================================================

/** A matter row for the management table + edit form. */
export interface MatterAdminListItem {
  id: string
  name: string
  status: string
  rate: string | null // numeric column → string; null = inherit
  clientId: string | null // linked (first) client, null if somehow unlinked
  clientName: string | null
  responsibleAttorneyId: string | null
  responsibleAttorneyName: string | null
}

/**
 * listMattersAdmin() → MatterAdminListItem[]
 * Every matter for the firm, joined to its (first) client and its responsible
 * attorney. Firm-scoped, ordered by name.
 */
export const listMattersAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<MatterAdminListItem>> => {
    const { firmId } = getSession()

    const rows = await db
      .select({
        id: matters.id,
        name: matters.name,
        status: matters.status,
        rate: matters.rate,
        clientId: clients.id,
        clientName: clients.name,
        responsibleAttorneyId: matters.responsibleAttorneyId,
        responsibleAttorneyName: users.name,
      })
      .from(matters)
      .leftJoin(matterClients, eq(matterClients.matterId, matters.id))
      .leftJoin(clients, eq(clients.id, matterClients.clientId))
      .leftJoin(users, eq(users.id, matters.responsibleAttorneyId))
      .where(and(eq(matters.firmId, firmId)))
      .orderBy(asc(matters.name))

    return rows
  },
)
