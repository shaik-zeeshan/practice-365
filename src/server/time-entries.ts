import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/db'
import {
  timeEntries,
  matters,
  matterClients,
  clients,
  users,
} from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Time-entry server functions (TanStack Start createServerFn).
//
// Every handler:
//   - validates input with Zod via `.validator(schema)`,
//   - resolves { firmId, userId, role } from the (stub) session,
//   - SCOPES EVERY QUERY by firmId (tenant isolation, STACK.md §6).
//
// API (each fn is callable as `fn({ data })` from the client):
//   listTimeEntries()                              → TimeEntryListItem[]
//   listTodayEntries()                             → TimeEntryListItem[]
//   startTimer(StartTimerInput)                    → TimeEntry
//   stopTimer(StopTimerInput)                      → TimeEntry
//   resumeTimer(ResumeTimerInput)                  → TimeEntry
//   saveTimeEntry(SaveTimeEntryInput)              → TimeEntry
//
// Domain (rounding/amount) logic lives in lib/services and is applied by the
// UI / billing layer at display/bill time; these fns persist raw state.
// ===========================================================================

const billableEnum = z.enum(['billable', 'non_billable', 'no_charge'])

// --- Zod input schemas -----------------------------------------------------

const startTimerSchema = z.object({
  matterId: z.uuid().nullish(),
  narrative: z.string().nullish(),
})

const stopTimerSchema = z.object({
  id: z.uuid(),
  accumulatedSeconds: z.number().int().min(0),
})

const resumeTimerSchema = z.object({
  id: z.uuid(),
})

const saveTimeEntrySchema = z
  .object({
    id: z.uuid().optional(),
    matterId: z.uuid().nullish(),
    narrative: z.string().nullish(),
    activity: z.string().nullish(), // denormalized category name (or legacy text)
    activityCategoryId: z.uuid().nullish(), // structured link when a category was picked
    billable: billableEnum.default('billable'),
    rate: z.string().nullish(), // numeric column → string; null = resolve default
    durationSeconds: z.number().int().min(0),
  })
  // A billable entry must reference a matter to bill against; enforce here so
  // the rule holds regardless of the client (UI hint can be bypassed).
  .superRefine((val, ctx) => {
    if (val.billable === 'billable' && !val.matterId) {
      ctx.addIssue({
        code: 'custom',
        path: ['matterId'],
        message: 'A matter is required to bill this entry.',
      })
    }
  })

// --- Inferred input types (exported for UI agents) -------------------------

export type StartTimerInput = z.infer<typeof startTimerSchema>
export type StopTimerInput = z.infer<typeof stopTimerSchema>
export type ResumeTimerInput = z.infer<typeof resumeTimerSchema>
export type SaveTimeEntryInput = z.infer<typeof saveTimeEntrySchema>

// --- Return types (exported for UI agents) ---------------------------------

export type TimeEntry = typeof timeEntries.$inferSelect

/** A time entry joined with matter/client/user display names for list views. */
export interface TimeEntryListItem extends TimeEntry {
  matterName: string | null
  clientName: string | null
  userName: string | null
}

// --- Helpers ---------------------------------------------------------------

/**
 * Resolve the effective hourly rate for an entry: explicit rate wins, otherwise
 * matter.rate ?? user.defaultRate. All firm-scoped. Returns a numeric string or
 * null. Money values stay as strings (never floats).
 */
async function resolveRate(
  firmId: string,
  matterId: string | null | undefined,
  userId: string,
  explicitRate: string | null | undefined,
): Promise<string | null> {
  if (
    explicitRate !== undefined &&
    explicitRate !== null &&
    explicitRate !== ''
  ) {
    return explicitRate
  }

  if (matterId) {
    const [matter] = await db
      .select({ rate: matters.rate })
      .from(matters)
      .where(and(eq(matters.id, matterId), eq(matters.firmId, firmId)))
      .limit(1)
    if (matter?.rate != null) return matter.rate
  }

  const [user] = await db
    .select({ defaultRate: users.defaultRate })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1)

  return user?.defaultRate ?? null
}

/**
 * Shared firm-scoped select that joins matter/client/user names. Pass extra
 * conditions to AND with the firm filter (single `.where()`, never chained).
 */
function listQuery(firmId: string, ...extra: Array<SQL>) {
  return db
    .select({
      id: timeEntries.id,
      firmId: timeEntries.firmId,
      matterId: timeEntries.matterId,
      userId: timeEntries.userId,
      date: timeEntries.date,
      narrative: timeEntries.narrative,
      activity: timeEntries.activity,
      activityCategoryId: timeEntries.activityCategoryId,
      billable: timeEntries.billable,
      rate: timeEntries.rate,
      durationSeconds: timeEntries.durationSeconds,
      startedAt: timeEntries.startedAt,
      running: timeEntries.running,
      invoiceId: timeEntries.invoiceId,
      createdAt: timeEntries.createdAt,
      matterName: matters.name,
      clientName: clients.name,
      userName: users.name,
    })
    .from(timeEntries)
    .leftJoin(matters, eq(matters.id, timeEntries.matterId))
    .leftJoin(matterClients, eq(matterClients.matterId, matters.id))
    .leftJoin(clients, eq(clients.id, matterClients.clientId))
    .leftJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.firmId, firmId), ...extra))
}

// --- Server functions ------------------------------------------------------

/**
 * listTimeEntries() → TimeEntryListItem[]
 * All entries for the firm, joined with matter/client/user names, date desc.
 * Feeds the /time list view.
 */
export const listTimeEntries = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<TimeEntryListItem>> => {
    const { firmId } = getSession()
    const rows = await listQuery(firmId).orderBy(desc(timeEntries.date))
    return rows
  },
)

/**
 * listTodayEntries() → TimeEntryListItem[]
 * Today's entries for the firm (Timekeeper popover + dashboard Activities).
 */
export const listTodayEntries = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<TimeEntryListItem>> => {
    const { firmId } = getSession()

    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    const rows = await listQuery(
      firmId,
      gte(timeEntries.date, start),
      lt(timeEntries.date, end),
    ).orderBy(desc(timeEntries.date))
    return rows
  },
)

/**
 * startTimer({ matterId?, narrative? }) → TimeEntry
 * Inserts a running time_entries row (running=true, startedAt=now) for the
 * current user/firm with default billable status.
 */
export const startTimer = createServerFn({ method: 'POST' })
  .validator(startTimerSchema)
  .handler(async ({ data }): Promise<TimeEntry> => {
    const { firmId, userId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(timeEntries)
      .values({
        firmId,
        userId,
        matterId: data.matterId ?? null,
        narrative: data.narrative ?? null,
        running: true,
        startedAt: new Date(),
        durationSeconds: 0,
        billable: 'billable',
      })
      .returning()

    return row
  })

/**
 * stopTimer({ id, accumulatedSeconds }) → TimeEntry
 * Stops a running entry: running=false, durationSeconds=accumulatedSeconds,
 * startedAt cleared. Firm-scoped update.
 */
export const stopTimer = createServerFn({ method: 'POST' })
  .validator(stopTimerSchema)
  .handler(async ({ data }): Promise<TimeEntry> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .update(timeEntries)
      .set({
        running: false,
        durationSeconds: data.accumulatedSeconds,
        startedAt: null,
      })
      .where(and(eq(timeEntries.id, data.id), eq(timeEntries.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Time entry not found')
    return row
  })

/**
 * resumeTimer({ id }) → TimeEntry
 * Restarts a stopped entry: running=true, startedAt=now. Firm-scoped.
 * The client keeps accumulating onto the existing durationSeconds and writes it
 * back on the next stopTimer.
 */
export const resumeTimer = createServerFn({ method: 'POST' })
  .validator(resumeTimerSchema)
  .handler(async ({ data }): Promise<TimeEntry> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .update(timeEntries)
      .set({
        running: true,
        startedAt: new Date(),
      })
      .where(and(eq(timeEntries.id, data.id), eq(timeEntries.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Time entry not found')
    return row
  })

/**
 * saveTimeEntry({ id?, matterId, narrative, activity, billable, rate?,
 *                 durationSeconds }) → TimeEntry
 * Creates (no id) or updates (id) a manual/edited entry. If rate is omitted it
 * is resolved from matter.rate ?? user.defaultRate. invoiceId stays null
 * (unbilled WIP). Firm-scoped.
 */
export const saveTimeEntry = createServerFn({ method: 'POST' })
  .validator(saveTimeEntrySchema)
  .handler(async ({ data }): Promise<TimeEntry> => {
    const { firmId, userId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const rate = await resolveRate(firmId, data.matterId, userId, data.rate)

    if (data.id) {
      const [row] = await db
        .update(timeEntries)
        .set({
          matterId: data.matterId ?? null,
          narrative: data.narrative ?? null,
          activity: data.activity ?? null,
          activityCategoryId: data.activityCategoryId ?? null,
          billable: data.billable,
          rate,
          durationSeconds: data.durationSeconds,
          // A saved entry is finalized WIP, not a live timer. Clear any running
          // state (e.g. when saving straight from a paused timer).
          running: false,
          startedAt: null,
        })
        .where(and(eq(timeEntries.id, data.id), eq(timeEntries.firmId, firmId)))
        .returning()

      if (!row) throw new Error('Time entry not found')
      return row
    }

    const [row] = await db
      .insert(timeEntries)
      .values({
        firmId,
        userId,
        matterId: data.matterId ?? null,
        narrative: data.narrative ?? null,
        activity: data.activity ?? null,
        activityCategoryId: data.activityCategoryId ?? null,
        billable: data.billable,
        rate,
        durationSeconds: data.durationSeconds,
        running: false,
        invoiceId: null,
      })
      .returning()

    return row
  })
