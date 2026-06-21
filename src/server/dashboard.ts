import { createServerFn } from '@tanstack/react-start'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/db'
import { timeEntries, firms, users, invoices } from '@/db/schema'
import { getSession } from '@/lib/auth'
import {
  computeAmount,
  roundToBilledHours,
  centsToString,
  toCents,
} from '@/lib/services/billing'
import {
  PERIOD_KEYS,
  periodRanges,
  periodProgress,
  periodTargets,
  monthsOfYear,
  businessDaysInRange,
} from '@/lib/periods'
import type { PeriodKey } from '@/lib/periods'

// ===========================================================================
// Dashboard metrics server function (TanStack Start createServerFn).
//
// Powers the Clio-Manage-style KPI bar at the top of the firm dashboard. Like
// the Activities widget, this reads REAL `time_entries` (not mock):
//   - resolve { firmId } from the (stub) session,
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - derive billed hours / money with the firm's REAL minuteIncrement via the
//     pure billing helpers (integer-cent money math, never floats).
//
// Period rule: productivity metrics (hours, realization) are month-to-date.
// WIP is a running balance (all unbilled billable work, regardless of date),
// matching how /time computes it.
// ===========================================================================

export interface DashboardMetrics {
  /** Human label for the reporting period, e.g. "Jun 2026". */
  period: string
  /** Billed hours (rounded) for billable entries, month-to-date. */
  billableHours: number
  /** Billed hours for non_billable + no_charge entries, month-to-date. */
  nonBillableHours: number
  /** Billed hours across all statuses, month-to-date. */
  totalTrackedHours: number
  /** Billed hours logged today (all statuses). */
  hoursToday: number
  /** $ value of billable work month-to-date (numeric string, "787.50"). */
  billableAmount: string
  /** Unbilled billable $ — work in progress, all dates (numeric string). */
  wipAmount: string
  /** Number of unbilled billable entries making up WIP. */
  wipEntryCount: number
  /** billableHours / totalTrackedHours, 0..1 (0 when nothing tracked). */
  realizationRate: number
}

/**
 * getDashboardMetrics() → DashboardMetrics
 * Firm-scoped KPI rollup for the dashboard metrics bar. Fetches the firm's
 * entries once and computes everything in JS with the shared billing helpers
 * so the numbers match /time exactly.
 */
export const getDashboardMetrics = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardMetrics> => {
    const { firmId } = getSession()

    const [firm] = await db
      .select({ minuteIncrement: firms.minuteIncrement })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)
    if (!firm) throw new Error('Firm not found')
    const minuteIncrement = firm.minuteIncrement

    const rows = await db
      .select({
        date: timeEntries.date,
        billable: timeEntries.billable,
        rate: timeEntries.rate,
        durationSeconds: timeEntries.durationSeconds,
        invoiceId: timeEntries.invoiceId,
      })
      .from(timeEntries)
      .where(eq(timeEntries.firmId, firmId))

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    let billableHours = 0
    let nonBillableHours = 0
    let totalTrackedHours = 0
    let hoursToday = 0
    let billableCents = 0
    let wipCents = 0
    let wipEntryCount = 0

    for (const row of rows) {
      const d = row.date instanceof Date ? row.date : new Date(row.date)
      const billedHours = roundToBilledHours(
        row.durationSeconds,
        minuteIncrement,
      )
      const { amountCents } = computeAmount({
        durationSeconds: row.durationSeconds,
        minuteIncrement,
        rate: row.rate,
      })

      // WIP = unbilled (invoiceId null) billable work, all dates — a running
      // balance, same definition the /time view uses.
      if (row.billable === 'billable' && row.invoiceId == null) {
        wipCents += amountCents
        wipEntryCount += 1
      }

      // Productivity metrics are month-to-date.
      if (d >= monthStart) {
        totalTrackedHours += billedHours
        if (row.billable === 'billable') {
          billableHours += billedHours
          billableCents += amountCents
        } else {
          nonBillableHours += billedHours
        }
        if (d >= dayStart) hoursToday += billedHours
      }
    }

    const realizationRate =
      totalTrackedHours > 0 ? billableHours / totalTrackedHours : 0

    const period = now.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })

    return {
      period,
      billableHours,
      nonBillableHours,
      totalTrackedHours,
      hoursToday,
      billableAmount: centsToString(billableCents),
      wipAmount: centsToString(wipCents),
      wipEntryCount,
      realizationRate,
    }
  },
)

// ===========================================================================
// getPersonalDashboard() — the Clio-Manage "Personal Dashboard" rollup.
//
// Mirrors the real Clio screen:
//   - Hourly + Financial metrics are PER-USER ("for {name}") and split into
//     Today / This Week / This Month / This Year, each with actual vs the
//     user's goal (expected so far, and the full-period target).
//   - Billing metrics are FIRM-WIDE (Draft / Unpaid / Overdue), read from the
//     new `invoices` table.
//   - The annual report is a 12-month cumulative target vs actual series.
//
// One canonical input drives every target: users.targetBillableHoursPerDay.
// Multiplied by the user's defaultRate it yields the dollar targets too, so the
// gauge, the bar charts and the annual line all stay internally consistent.
//
// Tenant rule (STACK.md §6): every query is scoped by firmId from the session;
// per-user queries additionally scope by userId.
// ===========================================================================

export interface PeriodMetrics {
  key: PeriodKey
  label: string
  /** Real billed hours logged (billable entries) this period. */
  actualHours: number
  /** Goal pro-rated to elapsed business days of the period. */
  expectedHours: number
  /** Goal for the whole period. */
  targetHours: number
  /** Real billable $ this period (numeric string). */
  actualAmount: string
  /** expectedHours × rate (numeric string). */
  expectedAmount: string
  /** targetHours × rate (numeric string). */
  targetAmount: string
}

export interface BillingBucket {
  count: number
  total: string
}

export interface AnnualMonth {
  label: string
  /** Cumulative target $ through this month (numeric string). */
  cumulativeTarget: string
  /** Cumulative actual $ through this month, or null for future months. */
  cumulativeActual: string | null
}

export interface PersonalDashboard {
  userName: string
  /** "Jun 2026" — header period label. */
  periodLabel: string
  targetBillableHoursPerDay: number
  /**
   * The user's monthly revenue goal in dollars (0 when unset). When > 0 it
   * drives the Financial Metrics target/expected bars and the Annual Report
   * target line, instead of deriving them from the hours goal × rate.
   */
  targetRevenuePerMonth: number
  /** today / week / month / year, in that order. */
  periods: Array<PeriodMetrics>
  billing: {
    draft: BillingBucket
    unpaid: BillingBucket
    overdue: BillingBucket
  }
  annual: Array<AnnualMonth>
}

/**
 * getPersonalDashboard() → PersonalDashboard
 * Per-user productivity + firm-wide billing, fetched in two firm-scoped queries
 * (the user's year of entries, and the firm's invoices) and rolled up in JS with
 * the shared billing/period helpers so every number is consistent.
 */
export const getPersonalDashboard = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PersonalDashboard> => {
    const { firmId, userId } = getSession()

    const [firm] = await db
      .select({ minuteIncrement: firms.minuteIncrement })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)
    if (!firm) throw new Error('Firm not found')
    const minuteIncrement = firm.minuteIncrement

    const [user] = await db
      .select({
        name: users.name,
        defaultRate: users.defaultRate,
        targetBillableHoursPerDay: users.targetBillableHoursPerDay,
        targetRevenuePerMonth: users.targetRevenuePerMonth,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
      .limit(1)
    if (!user) throw new Error('User not found')

    const dailyTarget = Number(user.targetBillableHoursPerDay) || 0
    const rateCents = toCents(user.defaultRate)

    const now = new Date()
    const ranges = periodRanges(now)
    const months = monthsOfYear(now)
    const yearStart = ranges.year.start

    // Optional monthly revenue goal. When set (> 0) it — not hours × rate —
    // drives the dollar targets. We spread the goal evenly across the year's
    // business days so that any period's target = dailyRevenue × its business
    // days, and the full-year target works out to 12× the monthly goal.
    const monthlyRevenueCents = toCents(user.targetRevenuePerMonth)
    const businessDaysInYear = businessDaysInRange(
      ranges.year.start,
      ranges.year.end,
    )
    const dailyRevenueCents =
      businessDaysInYear > 0
        ? (monthlyRevenueCents * 12) / businessDaysInYear
        : 0
    const useRevenueGoal = monthlyRevenueCents > 0

    // One query: the user's billable+other entries for the current year.
    const rows = await db
      .select({
        date: timeEntries.date,
        billable: timeEntries.billable,
        rate: timeEntries.rate,
        durationSeconds: timeEntries.durationSeconds,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.firmId, firmId),
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, yearStart),
        ),
      )

    // --- Per-period actuals (billable only) --------------------------------
    const actualHoursByPeriod: Record<PeriodKey, number> = {
      today: 0,
      week: 0,
      month: 0,
      year: 0,
    }
    const actualCentsByPeriod: Record<PeriodKey, number> = {
      today: 0,
      week: 0,
      month: 0,
      year: 0,
    }
    // Billable actual $ per calendar month (for the cumulative annual series).
    const actualCentsByMonth = new Array<number>(12).fill(0)

    for (const row of rows) {
      if (row.billable !== 'billable') continue
      const d = row.date instanceof Date ? row.date : new Date(row.date)
      const billedHours = roundToBilledHours(
        row.durationSeconds,
        minuteIncrement,
      )
      const { amountCents } = computeAmount({
        durationSeconds: row.durationSeconds,
        minuteIncrement,
        rate: row.rate,
      })

      for (const key of PERIOD_KEYS) {
        const r = ranges[key]
        if (d >= r.start && d < r.end) {
          actualHoursByPeriod[key] += billedHours
          actualCentsByPeriod[key] += amountCents
        }
      }
      if (d >= yearStart) actualCentsByMonth[d.getMonth()] += amountCents
    }

    const periods: Array<PeriodMetrics> = PERIOD_KEYS.map((key) => {
      const range = ranges[key]
      const progress = periodProgress(range, now)
      const { targetHours, expectedHours } = periodTargets(
        dailyTarget,
        progress,
      )
      // Dollar targets: from the revenue goal when set, else hours × rate.
      // Hours fields and actuals are unaffected either way.
      const expectedAmount = useRevenueGoal
        ? centsToString(
            Math.round(dailyRevenueCents * progress.elapsedBusinessDays),
          )
        : centsToString(Math.round(expectedHours * rateCents))
      const targetAmount = useRevenueGoal
        ? centsToString(
            Math.round(dailyRevenueCents * progress.totalBusinessDays),
          )
        : centsToString(Math.round(targetHours * rateCents))
      return {
        key,
        label: range.label,
        actualHours: actualHoursByPeriod[key],
        expectedHours,
        targetHours,
        actualAmount: centsToString(actualCentsByPeriod[key]),
        expectedAmount,
        targetAmount,
      }
    })

    // --- Annual report: cumulative target vs actual, month by month --------
    let cumTargetCents = 0
    let cumActualCents = 0
    const annual: Array<AnnualMonth> = months.map((m) => {
      cumTargetCents += useRevenueGoal
        ? Math.round(dailyRevenueCents * m.businessDays)
        : Math.round(dailyTarget * m.businessDays * rateCents)
      cumActualCents += actualCentsByMonth[m.monthIndex]
      return {
        label: m.label,
        cumulativeTarget: centsToString(cumTargetCents),
        // The actual line stops at the current month (future is unknown).
        cumulativeActual: m.isFuture ? null : centsToString(cumActualCents),
      }
    })

    // --- Firm-wide billing buckets (from invoices) -------------------------
    const invoiceRows = await db
      .select({
        status: invoices.status,
        total: invoices.total,
        dueAt: invoices.dueAt,
      })
      .from(invoices)
      .where(eq(invoices.firmId, firmId))

    let draftCount = 0
    let draftCents = 0
    let unpaidCount = 0
    let unpaidCents = 0
    let overdueCount = 0
    let overdueCents = 0

    for (const inv of invoiceRows) {
      const cents = toCents(inv.total)
      // "Draft" card groups not-yet-issued work: draft + pending approval.
      if (inv.status === 'draft' || inv.status === 'pending') {
        draftCount += 1
        draftCents += cents
      } else if (inv.status === 'unpaid') {
        unpaidCount += 1
        unpaidCents += cents
        const due = inv.dueAt
          ? inv.dueAt instanceof Date
            ? inv.dueAt
            : new Date(inv.dueAt)
          : null
        if (due && due < now) {
          overdueCount += 1
          overdueCents += cents
        }
      }
    }

    const periodLabel = now.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })

    return {
      userName: user.name,
      periodLabel,
      targetBillableHoursPerDay: dailyTarget,
      targetRevenuePerMonth: Number(user.targetRevenuePerMonth) || 0,
      periods,
      billing: {
        draft: { count: draftCount, total: centsToString(draftCents) },
        unpaid: { count: unpaidCount, total: centsToString(unpaidCents) },
        overdue: { count: overdueCount, total: centsToString(overdueCents) },
      },
      annual,
    }
  },
)
