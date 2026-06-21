import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { tasks, matters } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Task server functions (TanStack Start createServerFn).
//
// Backs the "Today's Agenda" dashboard widget plus task create/edit/complete
// flows.
//
// Every handler:
//   - validates write input with Zod via `.validator(schema)`,
//   - resolves { firmId, userId, role } from the (stub) session,
//   - SCOPES EVERY QUERY by firmId (tenant isolation, STACK.md §6).
//
// API (each fn is callable as `fn({ data })` from the client):
//   listAgendaTasks()                  → AgendaTask[]
//   createTask(CreateTaskInput)        → Task
//   setTaskStatus(SetTaskStatusInput)  → Task
//   updateTask(UpdateTaskInput)        → Task
// ===========================================================================

const priorityEnum = z.enum(['low', 'normal', 'high'])
const statusEnum = z.enum(['open', 'done'])

// --- Zod input schemas -----------------------------------------------------

const createTaskSchema = z.object({
  title: z.string().min(1),
  matterId: z.uuid().nullish(),
  priority: priorityEnum.default('normal'),
  dueAt: z.coerce.date().nullish(),
  notes: z.string().nullish(),
})

const setTaskStatusSchema = z.object({
  id: z.uuid(),
  status: statusEnum,
})

const updateTaskSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).optional(),
  matterId: z.uuid().nullish(),
  priority: priorityEnum.optional(),
  dueAt: z.coerce.date().nullish(),
  notes: z.string().nullish(),
})

// --- Inferred input types (exported for UI agents) -------------------------

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type SetTaskStatusInput = z.infer<typeof setTaskStatusSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// --- Return types (exported for UI agents) ---------------------------------

export type Task = typeof tasks.$inferSelect

/** A task joined with its matter name for the agenda widget. */
export interface AgendaTask {
  id: string
  title: string
  notes: string | null
  priority: Task['priority']
  status: Task['status']
  dueAt: Date | null
  completedAt: Date | null
  matterId: string | null
  matterName: string | null
}

// --- Server functions ------------------------------------------------------

/**
 * listAgendaTasks() → AgendaTask[]
 * The current user's tasks ("my agenda") for the firm, joined with matter name.
 * Open tasks first, ordered by dueAt asc (nulls last); done tasks last.
 * Capped at 20 rows for the dashboard widget.
 */
export const listAgendaTasks = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AgendaTask>> => {
    const { firmId, userId } = getSession()

    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        notes: tasks.notes,
        priority: tasks.priority,
        status: tasks.status,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
        matterId: tasks.matterId,
        matterName: matters.name,
      })
      .from(tasks)
      .leftJoin(matters, eq(matters.id, tasks.matterId))
      .where(and(eq(tasks.firmId, firmId), eq(tasks.userId, userId)))
      // status enum is ["open", "done"] → asc puts open before done.
      .orderBy(asc(tasks.status), sql`${tasks.dueAt} asc nulls last`)
      .limit(20)

    return rows
  },
)

/**
 * createTask({ title, matterId?, priority?, dueAt?, notes? }) → Task
 * Inserts an open task assigned to the current user/firm. Staff only.
 */
export const createTask = createServerFn({ method: 'POST' })
  .validator(createTaskSchema)
  .handler(async ({ data }): Promise<Task> => {
    const { firmId, userId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(tasks)
      .values({
        firmId,
        userId,
        title: data.title,
        matterId: data.matterId ?? null,
        priority: data.priority,
        dueAt: data.dueAt ?? null,
        notes: data.notes ?? null,
        status: 'open',
      })
      .returning()

    return row
  })

/**
 * setTaskStatus({ id, status }) → Task
 * Flips a task between open/done. Marking done stamps completedAt=now;
 * reopening clears it. Firm-scoped update. Staff only.
 */
export const setTaskStatus = createServerFn({ method: 'POST' })
  .validator(setTaskStatusSchema)
  .handler(async ({ data }): Promise<Task> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .update(tasks)
      .set({
        status: data.status,
        completedAt: data.status === 'done' ? new Date() : null,
      })
      .where(and(eq(tasks.id, data.id), eq(tasks.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Task not found')
    return row
  })

/**
 * updateTask({ id, title?, matterId?, priority?, dueAt?, notes? }) → Task
 * Updates the provided fields of a task. Firm-scoped. Staff only.
 */
export const updateTask = createServerFn({ method: 'POST' })
  .validator(updateTaskSchema)
  .handler(async ({ data }): Promise<Task> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const set: Partial<typeof tasks.$inferInsert> = {}
    if (data.title !== undefined) set.title = data.title
    if (data.matterId !== undefined) set.matterId = data.matterId
    if (data.priority !== undefined) set.priority = data.priority
    if (data.dueAt !== undefined) set.dueAt = data.dueAt
    if (data.notes !== undefined) set.notes = data.notes

    const [row] = await db
      .update(tasks)
      .set(set)
      .where(and(eq(tasks.id, data.id), eq(tasks.firmId, firmId)))
      .returning()

    if (!row) throw new Error('Task not found')
    return row
  })
