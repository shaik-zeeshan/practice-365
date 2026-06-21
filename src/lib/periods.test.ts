import { describe, it, expect } from 'vitest'
import {
  isBusinessDay,
  businessDaysInRange,
  workdayFractionElapsed,
  periodRanges,
  periodProgress,
  periodTargets,
  monthsOfYear,
  monthsOfYearForYear,
} from './periods'

// Fixed anchors (local time). 2026-06-17 is a Wednesday.
const WED_NOON = new Date(2026, 5, 17, 12, 0, 0) // 12:00 → 3h into a 9–5 day
const SATURDAY = new Date(2026, 5, 20, 10, 0, 0)

describe('isBusinessDay', () => {
  it('is true Mon–Fri, false on the weekend', () => {
    expect(isBusinessDay(new Date(2026, 5, 15))).toBe(true) // Mon
    expect(isBusinessDay(new Date(2026, 5, 19))).toBe(true) // Fri
    expect(isBusinessDay(new Date(2026, 5, 20))).toBe(false) // Sat
    expect(isBusinessDay(new Date(2026, 5, 21))).toBe(false) // Sun
  })
})

describe('businessDaysInRange', () => {
  it('counts Mon–Fri across a full week (end exclusive)', () => {
    // Mon 6/15 → Sat 6/20 (exclusive) = Mon,Tue,Wed,Thu,Fri = 5
    expect(
      businessDaysInRange(new Date(2026, 5, 15), new Date(2026, 5, 20)),
    ).toBe(5)
  })

  it('returns 0 for an empty or reversed range', () => {
    expect(
      businessDaysInRange(new Date(2026, 5, 17), new Date(2026, 5, 17)),
    ).toBe(0)
    expect(
      businessDaysInRange(new Date(2026, 5, 18), new Date(2026, 5, 17)),
    ).toBe(0)
  })

  it('skips the weekend in a Fri→Mon span', () => {
    // Fri 6/19 → Tue 6/23 (exclusive) = Fri, Mon = 2
    expect(
      businessDaysInRange(new Date(2026, 5, 19), new Date(2026, 5, 23)),
    ).toBe(2)
  })
})

describe('workdayFractionElapsed', () => {
  it('is 0 before 9am, 1 after 5pm, and prorated in between', () => {
    expect(workdayFractionElapsed(new Date(2026, 5, 17, 8))).toBe(0)
    expect(workdayFractionElapsed(new Date(2026, 5, 17, 17))).toBe(1)
    expect(workdayFractionElapsed(new Date(2026, 5, 17, 20))).toBe(1)
    // noon = 3h into an 8h workday = 0.375
    expect(workdayFractionElapsed(WED_NOON)).toBeCloseTo(0.375, 5)
  })
})

describe('periodRanges', () => {
  it('anchors a Monday-based week and correct month/year bounds', () => {
    const r = periodRanges(WED_NOON)
    expect(r.week.start.getDay()).toBe(1) // Monday
    expect(r.week.start.getDate()).toBe(15) // Mon 6/15
    expect(r.month.start.getMonth()).toBe(5) // June
    expect(r.month.start.getDate()).toBe(1)
    expect(r.year.start.getMonth()).toBe(0)
    expect(r.today.start.getDate()).toBe(17)
  })
})

describe('periodProgress + periodTargets', () => {
  it('today: target = one day, expected = workday fraction', () => {
    const r = periodRanges(WED_NOON)
    const p = periodProgress(r.today, WED_NOON)
    expect(p.totalBusinessDays).toBe(1)
    expect(p.elapsedBusinessDays).toBeCloseTo(0.375, 5)

    const t = periodTargets(8, p) // 8h/day goal
    expect(t.targetHours).toBe(8)
    expect(t.expectedHours).toBeCloseTo(3, 5) // 0.375 × 8
  })

  it('week: by Wed noon, 2 full days elapsed + a fraction of today', () => {
    const r = periodRanges(WED_NOON)
    const p = periodProgress(r.week, WED_NOON)
    expect(p.totalBusinessDays).toBe(5) // Mon–Fri
    // Mon + Tue done, Wed 0.375 in → 2.375
    expect(p.elapsedBusinessDays).toBeCloseTo(2.375, 5)
  })

  it('on a weekend, today contributes no fractional day', () => {
    const r = periodRanges(SATURDAY)
    const p = periodProgress(r.today, SATURDAY)
    expect(p.totalBusinessDays).toBe(0) // Sat is not a business day
    expect(p.elapsedBusinessDays).toBe(0)
  })
})

describe('monthsOfYear', () => {
  it('returns 12 months with current/future flags relative to now', () => {
    const months = monthsOfYear(WED_NOON) // June = index 5
    expect(months).toHaveLength(12)
    expect(months[5].isCurrent).toBe(true)
    expect(months[4].isFuture).toBe(false) // May is past
    expect(months[6].isFuture).toBe(true) // July is future
    expect(months[0].label).toBe('Jan')
    // Every month has a positive number of business days.
    expect(
      months.every((m) => m.businessDays >= 19 && m.businessDays <= 23),
    ).toBe(true)
  })
})

describe('monthsOfYearForYear', () => {
  it('returns 12 months indexed 0..11', () => {
    const months = monthsOfYearForYear(2026, WED_NOON)
    expect(months).toHaveLength(12)
    expect(months.map((m) => m.monthIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
  })

  it('flags current/future relative to now for the current year', () => {
    const months = monthsOfYearForYear(2026, WED_NOON) // June = index 5
    expect(months[5].isCurrent).toBe(true)
    expect(months[6].isFuture).toBe(true) // July is future
    expect(months[7].isFuture).toBe(true)
    expect(months[4].isFuture).toBe(false) // May is past
    expect(months[4].isCurrent).toBe(false)
    expect(months[0].isFuture).toBe(false)
    expect(months[0].isCurrent).toBe(false)
  })

  it('marks no month current or future for a past year, with business days', () => {
    const months = monthsOfYearForYear(2024, WED_NOON)
    expect(months.every((m) => !m.isFuture)).toBe(true)
    expect(months.every((m) => !m.isCurrent)).toBe(true)
    expect(months.every((m) => m.businessDays > 0)).toBe(true)
  })
})
