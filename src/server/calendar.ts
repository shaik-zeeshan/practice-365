import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq, gte } from 'drizzle-orm'
import { db } from '@/db'
import { calendarEvents, matters } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Calendar-event server functions (TanStack Start createServerFn).
//
// Backs the "Calendar" dashboard widget. Every handler:
//   - validates write input with Zod via `.validator(schema)`,
//   - resolves { firmId, role } from the (stub) session,
//   - SCOPES EVERY QUERY by firmId (tenant isolation, STACK.md §6).
//
// API (each fn is callable as `fn({ data })` from the client):
//   listUpcomingEvents()                       → UpcomingEvent[]
//   createCalendarEvent(CreateCalendarEventInput) → CalendarEvent
// ===========================================================================

const eventTypeEnum = z.enum([
  'deposition',
  'hearing',
  'meeting',
  'deadline',
  'other',
])

// --- Zod input schemas -----------------------------------------------------

const createCalendarEventSchema = z.object({
  title: z.string().min(1),
  eventType: eventTypeEnum,
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  matterId: z.uuid().nullish(),
  location: z.string().nullish(),
  notes: z.string().nullish(),
})

// --- Inferred input types (exported for UI agents) -------------------------

export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>

// --- Return types (exported for UI agents) ---------------------------------

export type CalendarEvent = typeof calendarEvents.$inferSelect

/** A calendar event joined with its (nullable) matter name for list views. */
export interface UpcomingEvent {
  id: string
  title: string
  eventType: (typeof calendarEvents.$inferSelect)['eventType']
  startAt: Date
  endAt: Date | null
  location: string | null
  notes: string | null
  matterId: string | null
  matterName: string | null
}

// --- Server functions ------------------------------------------------------

/**
 * listUpcomingEvents() → UpcomingEvent[]
 * Firm events starting today or later, ascending by startAt, capped at 12.
 * Joins matters for the (nullable) matter name. Feeds the dashboard Calendar
 * widget.
 */
export const listUpcomingEvents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<UpcomingEvent>> => {
    const { firmId } = getSession()

    // Start of today (local), computed in JS so we can use a single `gte`.
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const rows = await db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        eventType: calendarEvents.eventType,
        startAt: calendarEvents.startAt,
        endAt: calendarEvents.endAt,
        location: calendarEvents.location,
        notes: calendarEvents.notes,
        matterId: calendarEvents.matterId,
        matterName: matters.name,
      })
      .from(calendarEvents)
      .leftJoin(matters, eq(matters.id, calendarEvents.matterId))
      .where(
        and(
          eq(calendarEvents.firmId, firmId),
          gte(calendarEvents.startAt, startOfToday),
        ),
      )
      .orderBy(asc(calendarEvents.startAt))
      .limit(12)

    return rows
  },
)

/**
 * createCalendarEvent({ title, eventType, startAt, endAt?, matterId?,
 *                       location?, notes? }) → CalendarEvent
 * Inserts a firm-scoped calendar event. Staff only.
 */
export const createCalendarEvent = createServerFn({ method: 'POST' })
  .validator(createCalendarEventSchema)
  .handler(async ({ data }): Promise<CalendarEvent> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(calendarEvents)
      .values({
        firmId,
        title: data.title,
        eventType: data.eventType,
        startAt: data.startAt,
        endAt: data.endAt ?? null,
        matterId: data.matterId ?? null,
        location: data.location ?? null,
        notes: data.notes ?? null,
      })
      .returning()

    return row
  })
