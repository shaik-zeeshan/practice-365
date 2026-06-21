import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'

// ===========================================================================
// Personal performance settings server functions.
//
// Backs the "Personal performance settings" screen linked from the dashboard
// gauge. The only knob today is the per-working-day billable-hours goal, which
// drives every target on the Personal Dashboard. Firm-scoped + user-scoped per
// the tenant rule (STACK.md §6); never trust a client-supplied user/firm id.
// ===========================================================================

export interface PerformanceTargets {
  userName: string
  targetBillableHoursPerDay: number
  /** Dollars the user aims to bill per month. 0 = derive from the hours goal. */
  targetRevenuePerMonth: number
}

/** getPerformanceTargets() → the current user's goal (for the settings form). */
export const getPerformanceTargets = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PerformanceTargets> => {
    const { firmId, userId } = getSession()

    const [user] = await db
      .select({
        name: users.name,
        targetBillableHoursPerDay: users.targetBillableHoursPerDay,
        targetRevenuePerMonth: users.targetRevenuePerMonth,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
      .limit(1)
    if (!user) throw new Error('User not found')

    return {
      userName: user.name,
      targetBillableHoursPerDay: Number(user.targetBillableHoursPerDay) || 0,
      targetRevenuePerMonth: Number(user.targetRevenuePerMonth) || 0,
    }
  },
)

const updateSchema = z.object({
  // A daily billable-hours goal: at least 0, capped at a sane 24h.
  targetBillableHoursPerDay: z.number().min(0).max(24),
  // A monthly revenue goal in dollars; at least 0. 0 = derive from hours goal.
  targetRevenuePerMonth: z.number().min(0),
})

export type UpdatePerformanceTargetsInput = z.infer<typeof updateSchema>

/**
 * updatePerformanceTargets({ targetBillableHoursPerDay }) → PerformanceTargets
 * Persists the goal as a fixed-2 numeric string. Staff only.
 */
export const updatePerformanceTargets = createServerFn({ method: 'POST' })
  .validator(updateSchema)
  .handler(async ({ data }): Promise<PerformanceTargets> => {
    const { firmId, userId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [user] = await db
      .update(users)
      .set({
        targetBillableHoursPerDay: data.targetBillableHoursPerDay.toFixed(2),
        targetRevenuePerMonth: data.targetRevenuePerMonth.toFixed(2),
      })
      .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
      .returning({
        name: users.name,
        targetBillableHoursPerDay: users.targetBillableHoursPerDay,
        targetRevenuePerMonth: users.targetRevenuePerMonth,
      })
    if (!user) throw new Error('User not found')

    return {
      userName: user.name,
      targetBillableHoursPerDay: Number(user.targetBillableHoursPerDay) || 0,
      targetRevenuePerMonth: Number(user.targetRevenuePerMonth) || 0,
    }
  })
