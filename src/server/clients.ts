import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { clients, matterClients } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Client server functions (TanStack Start createServerFn).
//
// Same conventions as src/server/time-entries.ts:
//   - reads resolve { firmId } from the (stub) session,
//   - writes resolve { firmId, role } and guard with can(role, 'write'),
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - never trust a client-supplied firmId.
//
// API (each fn is callable as `fn()` / `fn({ data })` from the client):
//   listClients()                      → ClientListItem[]
//   createClient(CreateClientInput)    → Client
//   updateClient(UpdateClientInput)    → Client
// ===========================================================================

// --- Zod input schemas -----------------------------------------------------

const createClientSchema = z.object({
  name: z.string().min(1),
})

const updateClientSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
})

// --- Inferred input types (exported for UI agents) -------------------------

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>

// --- Return types (exported for UI agents) ---------------------------------

export type Client = typeof clients.$inferSelect

/** A client for list views / selects: id + name, with its linked matter count. */
export interface ClientListItem {
  id: string
  name: string
  matterCount: number
}

// --- Server functions ------------------------------------------------------

/**
 * listClients() → ClientListItem[]
 * All clients for the firm, with a count of linked matters (via matter_clients).
 * Firm-scoped, ordered by name.
 */
export const listClients = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ClientListItem>> => {
    const { firmId } = getSession()

    const rows = await db
      .select({
        id: clients.id,
        name: clients.name,
        matterCount: count(matterClients.matterId),
      })
      .from(clients)
      .leftJoin(matterClients, eq(matterClients.clientId, clients.id))
      .where(and(eq(clients.firmId, firmId)))
      .groupBy(clients.id, clients.name)
      .orderBy(asc(clients.name))

    return rows
  },
)

/**
 * createClient({ name }) → Client
 * Inserts a client for the current firm. Staff only.
 */
export const createClient = createServerFn({ method: 'POST' })
  .validator(createClientSchema)
  .handler(async ({ data }): Promise<Client> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(clients)
      .values({
        firmId,
        name: data.name,
      })
      .returning()

    return row
  })

/**
 * updateClient({ id, name }) → Client
 * Firm-scoped rename of a client. Staff only. Throws if no matching row.
 */
export const updateClient = createServerFn({ method: 'POST' })
  .validator(updateClientSchema)
  .handler(async ({ data }): Promise<Client> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .update(clients)
      .set({ name: data.name })
      .where(and(eq(clients.id, data.id), eq(clients.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Client not found')
    return row
  })
