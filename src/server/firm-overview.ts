import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { timeEntries, firms, users, matters, invoices } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { computeAmount, roundToBilledHours, toCents } from '@/lib/services/billing'
import { monthsOfYearForYear } from '@/lib/periods'

// ===========================================================================
// Firm Overview server function (TanStack Start createServerFn).
//
// Powers the Clio-Manage-style "Firm Overview" screen: three side-by-side
// donut + stacked-bar sections — Utilization, Realization and Collection —
// each with a Year and Role filter, a $/Hr/% unit toggle, and a 12-month
// breakdown. Like the dashboard, this reads REAL `time_entries` / `invoices`
// (no mock) and follows the same money discipline:
//   - resolve { firmId } from the (stub) session,
//   - SCOPE EVERY QUERY by firmId (tenant isolation, STACK.md §6) — the client
//     never supplies a firmId; the year/role/rateBasis it does send only ever
//     NARROW within the firm,
//   - derive billed hours / money with the firm's REAL minuteIncrement via the
//     pure billing helpers (integer-cent money math, never floats),
//   - roll up in JS into 12 calendar months (Jan→Dec) using the period helper
//     `monthsOfYearForYear(year, now)` for per-month business-day capacity and
//     past/future flags.
//
// The three sections, conceptually:
//   - UTILIZATION  (hours): billable vs non-billable vs untracked time against
//     the filtered users' capacity (Σ targetBillableHoursPerDay × businessDays,
//     0 for future months). Donut = billable / capacity.
//   - REALIZATION  (hours): of the billable work logged, how much has been
//     issued on an invoice (unpaid/paid) vs still unbilled/draft. Donut =
//     billed / worked. (No discount model yet → the "discounted" series is 0.)
//   - COLLECTION   ($):     of the money actually billed to clients (unpaid +
//     paid invoices), how much has been collected (paid). Donut = collected /
//     billed. Collection is firm-wide only — invoices carry no user dimension,
//     so it is NOT role-scoped.
//
// Rate basis (the `$` value of a time entry, hours/% are unaffected):
//   - 'bill'      → entry.rate, else matter.rate, else user.defaultRate.
//   - 'standard'  → always user.defaultRate.
// Billed hours always come from roundToBilledHours(durationSeconds, increment)
// regardless of rate basis, so the Hr and % units never move when the $ basis
// toggles.
//
// All money is kept in INTEGER CENTS internally AND surfaced as plain `number`
// cents in the exported types (NOT numeric strings) — the downstream UI does
// the formatting.
// ===========================================================================

// --- Exported domain types (downstream phases import these verbatim) -------

export type RateBasis = 'bill' | 'standard'
export type FirmUnit = 'hours' | 'value' | 'rate' // Hr / $ / %

/** A legend/stack series within a section. */
export interface FirmSeries {
  key: string
  label: string
}

/** One month's values for every series, in every unit. */
export interface FirmMonthlyPoint {
  monthIndex: number // 0–11
  label: string // "Jan" .. "Dec"
  hours: Record<string, number> // series key -> billed hours that month
  valueCents: Record<string, number> // series key -> $ value that month, integer cents
  rate: number // section's rate for that month, 0..1 (for % unit)
}

/** A totals-row chip (one per legend series). */
export interface FirmTotal {
  key: string
  label: string
  hours: number // hours total (decimal)
  valueCents: number // $ total, integer cents
}

export interface FirmSection {
  rate: number // overall rate for the donut, 0..1
  avg: number // mean of monthly rates over months WITH data, 0..1
  units: Array<FirmUnit> // which units the Hr/$/% toggle offers, in order
  totalsUnit: FirmUnit // 'hours' for util/realization, 'value' for collection
  series: Array<FirmSeries> // legend / stacked series (order = stack order, bottom first)
  totals: Array<FirmTotal> // one per series
  monthly: Array<FirmMonthlyPoint> // exactly 12, Jan→Dec
}

export interface FirmOverview {
  refreshedAt: string // ISO timestamp (new Date().toISOString())
  availableYears: Array<number> // DESCENDING; always includes current year
  availableRoles: Array<string> // e.g. ['all','attorney','paralegal','admin']
  utilization: FirmSection
  realization: FirmSection
  collection: FirmSection
}

// --- Input schema ----------------------------------------------------------

const inputSchema = z.object({
  year: z.coerce.number().int(),
  role: z.string(), // 'all' or a specific role
  rateBasis: z.enum(['bill', 'standard']),
})

export type FirmOverviewInput = z.infer<typeof inputSchema>

/**
 * getFirmOverview({ year, role, rateBasis }) → FirmOverview
 * Firm-scoped rollup for the Firm Overview screen. Fetches the firm's users,
 * its (role-filtered) time entries for the year, and its invoices for the year
 * in a handful of firm-scoped queries, then computes the three sections in JS
 * with the shared billing/period helpers so every number stays consistent.
 */
export const getFirmOverview = createServerFn({ method: 'GET' })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<FirmOverview> => {
    const { firmId } = getSession()
    const { year, role, rateBasis } = data

    // --- Firm billing config (real minuteIncrement) ------------------------
    const [firm] = await db
      .select({ minuteIncrement: firms.minuteIncrement })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)
    if (!firm) throw new Error('Firm not found')
    const minuteIncrement = firm.minuteIncrement

    // --- (1) Firm users: role filter, capacity & available roles -----------
    const allUsers = await db
      .select({
        id: users.id,
        role: users.role,
        defaultRate: users.defaultRate,
        targetBillableHoursPerDay: users.targetBillableHoursPerDay,
      })
      .from(users)
      .where(eq(users.firmId, firmId))

    // Distinct roles present in the firm, sorted, with 'all' prepended.
    const distinctRoles = Array.from(
      new Set(allUsers.map((u) => u.role)),
    ).sort()
    const availableRoles: Array<string> = ['all', ...distinctRoles]

    // The "filtered user set" drives capacity (utilization) and is the role
    // scope for the time-entry query below.
    const filteredUsers =
      role === 'all' ? allUsers : allUsers.filter((u) => u.role === role)

    // Σ of the filtered users' daily billable-hours targets — the per-business-
    // day capacity the firm "should" be logging.
    const sumDailyTarget = filteredUsers.reduce(
      (acc, u) => acc + (Number(u.targetBillableHoursPerDay) || 0),
      0,
    )

    // --- Year window (local) ----------------------------------------------
    const yearStart = new Date(year, 0, 1)
    const yearEnd = new Date(year + 1, 0, 1)

    // --- (2) Time entries for the year, role-filtered ----------------------
    // LEFT JOIN matters (per-matter rate override) + invoices (issued status);
    // INNER JOIN users (for defaultRate + the role filter).
    const entryConds = [
      eq(timeEntries.firmId, firmId),
      gte(timeEntries.date, yearStart),
      lt(timeEntries.date, yearEnd),
    ]
    if (role !== 'all') entryConds.push(eq(users.role, role))

    const entries = await db
      .select({
        date: timeEntries.date,
        billable: timeEntries.billable,
        rate: timeEntries.rate,
        durationSeconds: timeEntries.durationSeconds,
        invoiceId: timeEntries.invoiceId,
        matterRate: matters.rate,
        defaultRate: users.defaultRate,
        invStatus: invoices.status,
      })
      .from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .leftJoin(matters, eq(matters.id, timeEntries.matterId))
      .leftJoin(invoices, eq(invoices.id, timeEntries.invoiceId))
      .where(and(...entryConds))

    // --- (3) Invoices for the year (Collection — firm-wide, not role-scoped)
    const invoiceRows = await db
      .select({
        status: invoices.status,
        total: invoices.total,
        issuedAt: invoices.issuedAt,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.firmId, firmId))

    // --- (4) availableYears: earliest data year → current year, DESCENDING -
    const [entryMinRow] = await db
      .select({ min: sql<string | null>`min(${timeEntries.date})` })
      .from(timeEntries)
      .where(eq(timeEntries.firmId, firmId))
    const [invoiceMinRow] = await db
      .select({
        min: sql<string | null>`min(coalesce(${invoices.issuedAt}, ${invoices.createdAt}))`,
      })
      .from(invoices)
      .where(eq(invoices.firmId, firmId))

    const currentYear = new Date().getFullYear()
    const dataYears: Array<number> = []
    for (const minStr of [entryMinRow.min, invoiceMinRow.min]) {
      if (minStr != null) {
        const y = new Date(minStr).getFullYear()
        if (!Number.isNaN(y)) dataYears.push(y)
      }
    }
    // Earliest year across both sources; default to the current year if no data.
    const earliestYear =
      dataYears.length > 0 ? Math.min(...dataYears, currentYear) : currentYear
    const availableYears: Array<number> = []
    for (let y = currentYear; y >= earliestYear; y--) availableYears.push(y)

    // --- Month scaffolding (capacity + future flags) -----------------------
    const now = new Date()
    const months = monthsOfYearForYear(year, now)

    // ---------------------------------------------------------------------
    // Utilization (hours-based) — billable / nonBillable / untracked.
    // ---------------------------------------------------------------------
    const billableHours = new Array<number>(12).fill(0)
    const billableCents = new Array<number>(12).fill(0)
    const nonBillableHours = new Array<number>(12).fill(0)
    const nonBillableCents = new Array<number>(12).fill(0)

    // ---------------------------------------------------------------------
    // Realization (hours-based, billable entries only) — billed / discounted
    // / unbilledDraft.
    // ---------------------------------------------------------------------
    const workedHours = new Array<number>(12).fill(0)
    const workedCents = new Array<number>(12).fill(0)
    const billedHours = new Array<number>(12).fill(0)
    const billedCents = new Array<number>(12).fill(0)

    for (const row of entries) {
      const d = row.date instanceof Date ? row.date : new Date(row.date)
      const m = d.getMonth()
      const bh = roundToBilledHours(row.durationSeconds, minuteIncrement)

      // Effective rate per the rate basis (hours/% are independent of this).
      const entryRate =
        row.rate != null && row.rate !== '' ? row.rate : null
      const effectiveRate =
        rateBasis === 'standard'
          ? row.defaultRate
          : (entryRate ?? row.matterRate ?? row.defaultRate)

      const { amountCents: cents } = computeAmount({
        durationSeconds: row.durationSeconds,
        minuteIncrement,
        rate: effectiveRate,
      })

      // --- Utilization buckets --------------------------------------------
      if (row.billable === 'billable') {
        billableHours[m] += bh
        billableCents[m] += cents
      } else {
        nonBillableHours[m] += bh
        nonBillableCents[m] += cents
      }

      // --- Realization buckets (billable entries only) --------------------
      if (row.billable === 'billable') {
        workedHours[m] += bh
        workedCents[m] += cents
        const issued =
          row.invStatus === 'unpaid' || row.invStatus === 'paid'
        if (issued) {
          billedHours[m] += bh
          billedCents[m] += cents
        }
      }
    }

    // --- Utilization: capacity / untracked / rates -------------------------
    const capacityHours = new Array<number>(12).fill(0)
    const untrackedHours = new Array<number>(12).fill(0)
    const utilRate = new Array<number>(12).fill(0)
    for (let m = 0; m < 12; m++) {
      // No phantom capacity for future months.
      capacityHours[m] = months[m].isFuture
        ? 0
        : sumDailyTarget * months[m].businessDays
      untrackedHours[m] = Math.max(
        0,
        capacityHours[m] - (billableHours[m] + nonBillableHours[m]),
      )
      utilRate[m] =
        capacityHours[m] > 0 ? billableHours[m] / capacityHours[m] : 0
    }

    const totalBillableHours = sum(billableHours)
    const totalBillableCents = sum(billableCents)
    const totalNonBillableHours = sum(nonBillableHours)
    const totalNonBillableCents = sum(nonBillableCents)
    const totalUntrackedHours = sum(untrackedHours)
    const totalCapacity = sum(capacityHours)

    const utilization: FirmSection = {
      rate: totalCapacity > 0 ? totalBillableHours / totalCapacity : 0,
      avg: meanOver(utilRate, (m) => capacityHours[m] > 0),
      units: ['hours', 'value', 'rate'],
      totalsUnit: 'hours',
      series: [
        { key: 'billable', label: 'Billable' },
        { key: 'nonBillable', label: 'Non-billable' },
        { key: 'untracked', label: 'Untracked' },
      ],
      totals: [
        {
          key: 'billable',
          label: 'Billable',
          hours: totalBillableHours,
          valueCents: totalBillableCents,
        },
        {
          key: 'nonBillable',
          label: 'Non-billable',
          hours: totalNonBillableHours,
          valueCents: totalNonBillableCents,
        },
        {
          key: 'untracked',
          label: 'Untracked',
          hours: totalUntrackedHours,
          valueCents: 0,
        },
      ],
      monthly: months.map((month, m) => ({
        monthIndex: month.monthIndex,
        label: month.label,
        hours: {
          billable: billableHours[m],
          nonBillable: nonBillableHours[m],
          untracked: untrackedHours[m],
        },
        valueCents: {
          billable: billableCents[m],
          nonBillable: nonBillableCents[m],
          untracked: 0,
        },
        rate: utilRate[m],
      })),
    }

    // --- Realization: unbilled/draft = worked − billed; rates --------------
    const unbilledDraftHours = new Array<number>(12).fill(0)
    const unbilledDraftCents = new Array<number>(12).fill(0)
    const realizationRate = new Array<number>(12).fill(0)
    for (let m = 0; m < 12; m++) {
      unbilledDraftHours[m] = workedHours[m] - billedHours[m]
      unbilledDraftCents[m] = workedCents[m] - billedCents[m]
      realizationRate[m] =
        workedHours[m] > 0 ? billedHours[m] / workedHours[m] : 0
    }

    const totalWorked = sum(workedHours)
    const totalBilledHours = sum(billedHours)
    const totalBilledCents = sum(billedCents)
    const totalUnbilledDraftHours = sum(unbilledDraftHours)
    const totalUnbilledDraftCents = sum(unbilledDraftCents)

    const realization: FirmSection = {
      rate: totalWorked > 0 ? totalBilledHours / totalWorked : 0,
      avg: meanOver(realizationRate, (m) => workedHours[m] > 0),
      units: ['hours', 'value', 'rate'],
      totalsUnit: 'hours',
      series: [
        { key: 'billed', label: 'Billed Nondiscounted' },
        { key: 'discounted', label: 'Billed Discounted' },
        { key: 'unbilledDraft', label: 'Unbilled & Draft' },
      ],
      totals: [
        {
          key: 'billed',
          label: 'Billed Nondiscounted',
          hours: totalBilledHours,
          valueCents: totalBilledCents,
        },
        {
          key: 'discounted',
          label: 'Billed Discounted',
          hours: 0,
          valueCents: 0,
        },
        {
          key: 'unbilledDraft',
          label: 'Unbilled & Draft',
          hours: totalUnbilledDraftHours,
          valueCents: totalUnbilledDraftCents,
        },
      ],
      monthly: months.map((month, m) => ({
        monthIndex: month.monthIndex,
        label: month.label,
        hours: {
          billed: billedHours[m],
          discounted: 0,
          unbilledDraft: unbilledDraftHours[m],
        },
        valueCents: {
          billed: billedCents[m],
          discounted: 0,
          unbilledDraft: unbilledDraftCents[m],
        },
        rate: realizationRate[m],
      })),
    }

    // ---------------------------------------------------------------------
    // Collection ($-based) — collected (paid) / uncollected (unpaid).
    // From the firm's invoices, bucketed by issuedAt ?? createdAt, filtered to
    // the selected year. Draft/pending/void invoices are ignored.
    // ---------------------------------------------------------------------
    const collectedCents = new Array<number>(12).fill(0)
    const uncollectedCents = new Array<number>(12).fill(0)

    for (const inv of invoiceRows) {
      // createdAt is non-null in the schema, so the bucket date always exists.
      const raw = inv.issuedAt ?? inv.createdAt
      const d = raw instanceof Date ? raw : new Date(raw)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      const cents = toCents(inv.total)
      if (inv.status === 'paid') {
        collectedCents[m] += cents
      } else if (inv.status === 'unpaid') {
        uncollectedCents[m] += cents
      }
    }

    const collectionRate = new Array<number>(12).fill(0)
    for (let m = 0; m < 12; m++) {
      const billed = collectedCents[m] + uncollectedCents[m]
      collectionRate[m] = billed > 0 ? collectedCents[m] / billed : 0
    }

    const totalCollected = sum(collectedCents)
    const totalUncollected = sum(uncollectedCents)
    const totalCollectionBilled = totalCollected + totalUncollected

    const collection: FirmSection = {
      rate:
        totalCollectionBilled > 0 ? totalCollected / totalCollectionBilled : 0,
      avg: meanOver(
        collectionRate,
        (m) => collectedCents[m] + uncollectedCents[m] > 0,
      ),
      units: ['value', 'rate'],
      totalsUnit: 'value',
      series: [
        { key: 'collected', label: 'Collected' },
        { key: 'uncollected', label: 'Uncollected' },
      ],
      totals: [
        {
          key: 'collected',
          label: 'Collected',
          hours: 0,
          valueCents: totalCollected,
        },
        {
          key: 'uncollected',
          label: 'Uncollected',
          hours: 0,
          valueCents: totalUncollected,
        },
      ],
      monthly: months.map((month, m) => ({
        monthIndex: month.monthIndex,
        label: month.label,
        hours: { collected: 0, uncollected: 0 },
        valueCents: {
          collected: collectedCents[m],
          uncollected: uncollectedCents[m],
        },
        rate: collectionRate[m],
      })),
    }

    return {
      refreshedAt: new Date().toISOString(),
      availableYears,
      availableRoles,
      utilization,
      realization,
      collection,
    }
  })

// --- Local helpers ---------------------------------------------------------

/** Sum a numeric array. */
function sum(values: Array<number>): number {
  return values.reduce((acc, v) => acc + v, 0)
}

/**
 * Mean of a 12-length monthly-rate array over only the months where `include`
 * is true (i.e. months that actually have data). Returns 0 when none qualify.
 */
function meanOver(
  rates: Array<number>,
  include: (monthIndex: number) => boolean,
): number {
  let total = 0
  let count = 0
  for (let m = 0; m < 12; m++) {
    if (include(m)) {
      total += rates[m]
      count += 1
    }
  }
  return count > 0 ? total / count : 0
}
