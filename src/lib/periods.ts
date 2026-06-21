// ---------------------------------------------------------------------------
// Period & target math — PURE, no DB/IO, unit-testable.
//
// Powers the Clio-Manage-style Personal Dashboard. Everything a user "should"
// have done (target / expected) derives from ONE input: their billable-hours
// goal per WORKING day (users.targetBillableHoursPerDay). We translate that
// into per-period hour/dollar targets using a Mon–Fri business-day model:
//
//   targetHours   = dailyTarget × businessDays in the whole period
//   expectedHours = dailyTarget × businessDays elapsed SO FAR (today counts as
//                   a fraction, by how far through the 9–5 workday we are)
//
// "Actual" always comes from real time_entries — never modelled here.
// ---------------------------------------------------------------------------

/** Workday window used to prorate the in-progress day. 9am–5pm = 8h. */
const WORKDAY_START_HOUR = 9
const WORKDAY_END_HOUR = 17

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export type PeriodKey = 'today' | 'week' | 'month' | 'year'

export const PERIOD_KEYS: ReadonlyArray<PeriodKey> = [
  'today',
  'week',
  'month',
  'year',
]

export interface PeriodRange {
  key: PeriodKey
  label: string
  /** Inclusive start (local midnight). */
  start: Date
  /** Exclusive end (local midnight). */
  end: Date
}

/** Local midnight for a given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Mon–Fri are business days. */
export function isBusinessDay(d: Date): boolean {
  const day = d.getDay() // 0 = Sun … 6 = Sat
  return day !== 0 && day !== 6
}

/**
 * Count whole business days (Mon–Fri) in the half-open range [start, end).
 * Day-granular: only the calendar date matters, not the time of day.
 */
export function businessDaysInRange(start: Date, end: Date): number {
  let count = 0
  const cursor = startOfDay(start)
  const stop = end.getTime()
  // Guard against pathological inputs; a single year is ~365 iterations.
  let guard = 0
  while (cursor.getTime() < stop && guard < 100_000) {
    if (isBusinessDay(cursor)) count += 1
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }
  return count
}

/**
 * Fraction (0..1) of the current workday that has elapsed at `now`, using the
 * 9am–5pm window. Before 9am → 0, after 5pm → 1. Caller decides whether `now`
 * is even a business day.
 */
export function workdayFractionElapsed(now: Date): number {
  const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  if (hours <= WORKDAY_START_HOUR) return 0
  if (hours >= WORKDAY_END_HOUR) return 1
  return (hours - WORKDAY_START_HOUR) / (WORKDAY_END_HOUR - WORKDAY_START_HOUR)
}

/** The four dashboard periods anchored at `now`. Weeks start on Monday. */
export function periodRanges(now: Date): Record<PeriodKey, PeriodRange> {
  const today = startOfDay(now)

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  // Monday-based week start.
  const dow = today.getDay() // 0 = Sun … 6 = Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() + mondayOffset)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const yearStart = new Date(now.getFullYear(), 0, 1)
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1)

  return {
    today: { key: 'today', label: 'Today', start: today, end: tomorrow },
    week: { key: 'week', label: 'This Week', start: weekStart, end: weekEnd },
    month: {
      key: 'month',
      label: 'This Month',
      start: monthStart,
      end: monthEnd,
    },
    year: { key: 'year', label: 'This Year', start: yearStart, end: yearEnd },
  }
}

export interface PeriodProgress {
  /** Business days in the whole period. */
  totalBusinessDays: number
  /** Business days elapsed so far, today counted as a workday fraction. */
  elapsedBusinessDays: number
}

/**
 * How far through a period we are, in business days, given `now`. The current
 * day is counted as a fraction (workdayFractionElapsed) so "expected" climbs
 * smoothly through the day rather than jumping at midnight.
 */
export function periodProgress(range: PeriodRange, now: Date): PeriodProgress {
  const total = businessDaysInRange(range.start, range.end)

  const today = startOfDay(now)
  // Whole business days strictly before today (but within the period).
  const fullElapsed = businessDaysInRange(range.start, today)

  const nowInPeriod = now >= range.start && now < range.end
  const todayFraction =
    nowInPeriod && isBusinessDay(now) ? workdayFractionElapsed(now) : 0

  const elapsed = Math.min(fullElapsed + todayFraction, total)
  return { totalBusinessDays: total, elapsedBusinessDays: elapsed }
}

export interface PeriodTargets {
  /** Goal for the whole period. */
  targetHours: number
  /** Goal pro-rated to how much of the period has elapsed. */
  expectedHours: number
}

/** Translate a daily-hours goal + period progress into hour targets. */
export function periodTargets(
  dailyTargetHours: number,
  progress: PeriodProgress,
): PeriodTargets {
  return {
    targetHours: dailyTargetHours * progress.totalBusinessDays,
    expectedHours: dailyTargetHours * progress.elapsedBusinessDays,
  }
}

export interface MonthInfo {
  monthIndex: number // 0–11
  label: string // "Jan"
  start: Date
  end: Date // exclusive
  businessDays: number
  isCurrent: boolean
  isFuture: boolean
}

/**
 * The 12 months of an arbitrary `year`, with business-day counts and
 * past/current/future flags computed relative to `now`. The year-parameterised
 * generalisation of `monthsOfYear`, powering the Firm overview's monthly charts
 * where a user can select a year other than the current one. Future months of
 * the current year are flagged so capacity math contributes 0 for them; a past
 * year has no future months and no current month.
 */
export function monthsOfYearForYear(
  year: number,
  now: Date,
): Array<MonthInfo> {
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  return MONTH_LABELS.map((label, monthIndex) => {
    const start = new Date(year, monthIndex, 1)
    const end = new Date(year, monthIndex + 1, 1)
    return {
      monthIndex,
      label,
      start,
      end,
      businessDays: businessDaysInRange(start, end),
      isCurrent: year === currentYear && monthIndex === currentMonth,
      isFuture:
        year > currentYear ||
        (year === currentYear && monthIndex > currentMonth),
    }
  })
}

/**
 * The 12 months of `now`'s calendar year, with business-day counts and
 * past/current/future flags. Drives the Detailed Annual Report: the target
 * line spans all 12 months; the actual line stops at the current month.
 */
export function monthsOfYear(now: Date): Array<MonthInfo> {
  return monthsOfYearForYear(now.getFullYear(), now)
}
