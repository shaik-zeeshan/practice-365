import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { activityCategories } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Activity-category server functions (TanStack Start createServerFn).
//
// Activity categories are the firm's reusable, pre-configured billing items —
// time-entry activities (default hourly rate) and expenses (default unit
// price). Managed at /settings/categories and picked when logging time.
//
// Same conventions as src/server/clients.ts:
//   - reads resolve { firmId } from the (stub) session,
//   - writes resolve { firmId, role } and guard with can(role, 'write'),
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - never trust a client-supplied firmId.
//
// API (each fn is callable as `fn()` / `fn({ data })` from the client):
//   listActivityCategories()                       → ActivityCategory[]
//   saveActivityCategory(SaveActivityCategoryInput) → ActivityCategory
//   setActivityCategoryArchived(...)               → ActivityCategory
// ===========================================================================

const categoryTypeEnum = z.enum(['time_entry', 'expense'])
const taxTreatmentEnum = z.enum(['default', 'none'])

// --- Zod input schemas -----------------------------------------------------

const saveActivityCategorySchema = z.object({
  id: z.uuid().optional(),
  type: categoryTypeEnum,
  name: z.string().min(1, 'Name is required'),
  currency: z.string().min(1).default('USD'),
  // numeric column → string; defaults to "0.00" when omitted.
  rate: z.string().default('0.00'),
  taxTreatment: taxTreatmentEnum.default('default'),
  permissionGroups: z.string().default('Everyone'),
  archived: z.boolean().default(false),
})

const setArchivedSchema = z.object({
  id: z.uuid(),
  archived: z.boolean(),
})

// --- Inferred input types (exported for UI) --------------------------------

export type SaveActivityCategoryInput = z.infer<
  typeof saveActivityCategorySchema
>
export type SetActivityCategoryArchivedInput = z.infer<typeof setArchivedSchema>

// --- Return types (exported for UI) ----------------------------------------

export type ActivityCategory = typeof activityCategories.$inferSelect

// --- Server functions ------------------------------------------------------

/**
 * listActivityCategories() → ActivityCategory[]
 * Every category for the firm (both types, including archived), ordered by
 * type then name. The UI splits by type (tabs) and filters archived locally.
 */
export const listActivityCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ActivityCategory>> => {
    const { firmId } = getSession()

    return db
      .select()
      .from(activityCategories)
      .where(eq(activityCategories.firmId, firmId))
      .orderBy(asc(activityCategories.type), asc(activityCategories.name))
  },
)

/**
 * saveActivityCategory({ id?, type, name, currency, rate, taxTreatment,
 *                        permissionGroups, archived }) → ActivityCategory
 * Creates (no id) or updates (id) a category for the current firm. Staff only.
 * `type` is fixed at create time and never changed on update.
 */
export const saveActivityCategory = createServerFn({ method: 'POST' })
  .validator(saveActivityCategorySchema)
  .handler(async ({ data }): Promise<ActivityCategory> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    if (data.id) {
      const [row] = await db
        .update(activityCategories)
        .set({
          name: data.name,
          currency: data.currency,
          rate: data.rate,
          taxTreatment: data.taxTreatment,
          permissionGroups: data.permissionGroups,
          archived: data.archived,
        })
        .where(
          and(
            eq(activityCategories.id, data.id),
            eq(activityCategories.firmId, firmId),
          ),
        )
        .returning()

      if (!row) throw new Error('Activity category not found')
      return row
    }

    const [row] = await db
      .insert(activityCategories)
      .values({
        firmId,
        type: data.type,
        name: data.name,
        currency: data.currency,
        rate: data.rate,
        taxTreatment: data.taxTreatment,
        permissionGroups: data.permissionGroups,
        archived: data.archived,
      })
      .returning()

    return row
  })

/**
 * setActivityCategoryArchived({ id, archived }) → ActivityCategory
 * Archive (hide from pickers) or restore a category. Firm-scoped. Staff only.
 */
export const setActivityCategoryArchived = createServerFn({ method: 'POST' })
  .validator(setArchivedSchema)
  .handler(async ({ data }): Promise<ActivityCategory> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .update(activityCategories)
      .set({ archived: data.archived })
      .where(
        and(
          eq(activityCategories.id, data.id),
          eq(activityCategories.firmId, firmId),
        ),
      )
      .returning()

    if (!row) throw new Error('Activity category not found')
    return row
  })
