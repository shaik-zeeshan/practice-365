import { roundToBilledHours, roundToBilledMinutes } from '@/lib/rounding'

// ---------------------------------------------------------------------------
// Billing domain logic — PURE, no DB/IO.
//
// MONEY RULE (STACK.md §6): `numeric` columns come back as STRINGS; never use
// floats for currency.
//
// Approach for computeAmount:
//   amount = billedHours * rate
//          = (billedMinutes / 60) * rate
//
// To stay exact we do integer math:
//   - rate (a numeric string, "dollars.cents") → integer rateCents.
//   - billed time is computed as an INTEGER number of billed minutes (already
//     a whole multiple of minuteIncrement, so no fractional minutes).
//   - amountCents = round( rateCents * billedMinutes / 60 ).
//     The single division-by-60 is the only place a fraction appears; we round
//     it to the nearest cent. (e.g. 6 billed minutes at $300/h:
//     30000c * 6 / 60 = 3000c = $30.00.)
//   - return the amount as a fixed-2 numeric string ("30.00") so it round-trips
//     cleanly back into a numeric column.
// ---------------------------------------------------------------------------

export interface ComputeAmountInput {
  durationSeconds: number
  minuteIncrement: number
  /** rate per hour as a numeric string ("300.00") or number; null/"" → 0. */
  rate: string | number | null | undefined
}

export interface ComputeAmountResult {
  /** billed quantity in hours (decimal, after rounding up to increment) */
  billedHours: number
  /** billed quantity in whole minutes (multiple of minuteIncrement) */
  billedMinutes: number
  /** rate per hour expressed in integer cents */
  rateCents: number
  /** computed amount in integer cents */
  amountCents: number
  /** computed amount as a fixed-2 numeric string ("30.00") for numeric columns */
  amount: string
}

/** Convert a dollars-and-cents string/number to integer cents. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return 0
  // Round to avoid binary float artifacts (e.g. 300.1 * 100).
  return Math.round(n * 100)
}

/** Convert integer cents to a fixed-2 numeric string ("30.00"). */
export function centsToString(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')}`
}

/**
 * Compute the billed quantity (hours) AND the money amount for a time entry.
 *
 * The amount is computed entirely in integer cents and returned as a fixed-2
 * numeric string so it can be written straight into a `numeric` column.
 */
export function computeAmount(input: ComputeAmountInput): ComputeAmountResult {
  const { durationSeconds, minuteIncrement, rate } = input

  const billedHours = roundToBilledHours(durationSeconds, minuteIncrement)
  const billedMinutes = roundToBilledMinutes(durationSeconds, minuteIncrement)
  const rateCents = toCents(rate)

  // Single fractional step (÷60) → round to nearest cent.
  const amountCents = Math.round((rateCents * billedMinutes) / 60)

  return {
    billedHours,
    billedMinutes,
    rateCents,
    amountCents,
    amount: centsToString(amountCents),
  }
}

// Re-export rounding helpers so server fns can import domain logic from a single
// place (lib/services) rather than reaching into lib/rounding directly.
export {
  roundToBilledHours,
  roundToBilledMinutes,
  parseDurationToSeconds,
  formatSecondsToClock,
  formatSecondsToDecimalHours,
} from '@/lib/rounding'
