import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { matters, matterClients, clients, firms, users } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Matter server functions (TanStack Start createServerFn).
//
// Same conventions as src/server/time-entries.ts:
//   - reads resolve { firmId } from the (stub) session,
//   - writes resolve { firmId, userId, role } and guard with can(role,'write'),
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - never trust a client-supplied firmId.
//
// The read-only lookups feed the TimeEntryModal's matter <Select> and the
// derived-amount calculation (firm minuteIncrement). The write fns back the
// in-app matter creation/editing forms.
//
// API (each fn is callable as `fn()` / `fn({ data })` from the client):
//   listMatters()                    → MatterOption[]
//   getFirmConfig()                  → FirmConfig
//   listFirmUsers()                  → FirmUser[]
//   createMatter(CreateMatterInput)  → Matter
//   updateMatter(UpdateMatterInput)  → Matter
// ===========================================================================

/** A matter for the modal's select: id + name, resolved client name + rate. */
export interface MatterOption {
  id: string
  name: string
  clientName: string | null
  rate: string | null // numeric column → string; null = fall back to user rate
}

/** Firm billing config the UI needs to derive amounts client-side. */
export interface FirmConfig {
  id: string
  name: string
  minuteIncrement: number
}

/**
 * listMatters() → MatterOption[]
 * Active-and-all matters for the firm, joined with their (first) client name and
 * per-matter rate override. Firm-scoped, ordered by name.
 */
export const listMatters = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<MatterOption>> => {
    const { firmId } = getSession()

    const rows = await db
      .select({
        id: matters.id,
        name: matters.name,
        clientName: clients.name,
        rate: matters.rate,
      })
      .from(matters)
      .leftJoin(matterClients, eq(matterClients.matterId, matters.id))
      .leftJoin(clients, eq(clients.id, matterClients.clientId))
      .where(and(eq(matters.firmId, firmId)))
      .orderBy(asc(matters.name))

    return rows
  },
)

/**
 * getFirmConfig() → FirmConfig
 * The current firm's id/name/minuteIncrement (billing rounding increment). The
 * timer modal uses minuteIncrement to derive the read-only amount client-side
 * via lib/services/billing.computeAmount. Firm-scoped.
 */
export const getFirmConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FirmConfig> => {
    const { firmId } = getSession()

    const [row] = await db
      .select({
        id: firms.id,
        name: firms.name,
        minuteIncrement: firms.minuteIncrement,
      })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)

    if (!row) throw new Error('Firm not found')
    return row
  },
)

// --- Zod input schemas -----------------------------------------------------

const createMatterSchema = z.object({
  name: z.string().min(1),
  clientId: z.uuid(),
  responsibleAttorneyId: z.uuid().nullish(),
  rate: z.string().nullish(), // numeric column → string; null = inherit
  status: z.string().default('active'),
})

const updateMatterSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).optional(),
  responsibleAttorneyId: z.uuid().nullish(),
  rate: z.string().nullish(),
  status: z.string().optional(),
})

// --- Inferred input types (exported for UI agents) -------------------------

export type CreateMatterInput = z.infer<typeof createMatterSchema>
export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

// --- Return types (exported for UI agents) ---------------------------------

export type Matter = typeof matters.$inferSelect

/** A firm user for the matter form's "responsible attorney" select. */
export interface FirmUser {
  id: string
  name: string
  role: string
}

/**
 * listFirmUsers() → FirmUser[]
 * All users in the firm (id, name, role), ordered by name. Feeds the matter
 * form's "responsible attorney" <Select>. Firm-scoped.
 */
export const listFirmUsers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<FirmUser>> => {
    const { firmId } = getSession()

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.firmId, firmId))
      .orderBy(asc(users.name))

    return rows
  },
)

/**
 * createMatter({ name, clientId, responsibleAttorneyId?, rate?, status? })
 *   → Matter
 * Inserts the matter, then links it to the given client via matter_clients.
 * responsibleAttorneyId defaults to the session user; status defaults to
 * 'active'. Staff only. Firm-scoped.
 */
export const createMatter = createServerFn({ method: 'POST' })
  .validator(createMatterSchema)
  .handler(async ({ data }): Promise<Matter> => {
    const { firmId, userId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [matter] = await db
      .insert(matters)
      .values({
        firmId,
        name: data.name,
        responsibleAttorneyId: data.responsibleAttorneyId ?? userId,
        rate: data.rate ?? null,
        status: data.status,
      })
      .returning()

    // Link the matter to its client. If this fails we let it throw.
    await db.insert(matterClients).values({
      matterId: matter.id,
      clientId: data.clientId,
    })

    return matter
  })

/**
 * updateMatter({ id, name?, responsibleAttorneyId?, rate?, status? }) → Matter
 * Firm-scoped update of the provided fields only. Staff only. Throws if no
 * matching row.
 */
export const updateMatter = createServerFn({ method: 'POST' })
  .validator(updateMatterSchema)
  .handler(async ({ data }): Promise<Matter> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const updates: Partial<typeof matters.$inferInsert> = {}
    if (data.name !== undefined) updates.name = data.name
    if (data.responsibleAttorneyId !== undefined)
      updates.responsibleAttorneyId = data.responsibleAttorneyId
    if (data.rate !== undefined) updates.rate = data.rate
    if (data.status !== undefined) updates.status = data.status

    const [row] = await db
      .update(matters)
      .set(updates)
      .where(and(eq(matters.id, data.id), eq(matters.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Matter not found')
    return row
  })
