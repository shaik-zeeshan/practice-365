// ---------------------------------------------------------------------------
// Time rounding & duration parsing/formatting — PURE, no DB/IO, unit-testable.
//
// Rounding rule (STACK.md §5):
//   billed quantity (hours) =
//     ceil( (durationSeconds / 60) / minuteIncrement ) * minuteIncrement / 60
//
// We round at BILL time and always store the raw durationSeconds.
// ---------------------------------------------------------------------------

/**
 * Round raw tracked seconds up to the firm's billing increment and express the
 * result in billed HOURS.
 *
 * Example (minuteIncrement = 6 → tenth-of-an-hour billing):
 *   30s   → ceil(0.5 / 6) * 6 / 60   = 6 min  = 0.1 h
 *   7 min → ceil(7   / 6) * 6 / 60   = 12 min = 0.2 h
 *
 * @param durationSeconds raw tracked seconds (>= 0)
 * @param minuteIncrement firm billing increment in minutes (e.g. 6)
 * @returns billed quantity in hours (decimal)
 */
export function roundToBilledHours(
  durationSeconds: number,
  minuteIncrement: number,
): number {
  if (minuteIncrement <= 0) {
    throw new Error('minuteIncrement must be a positive number')
  }
  if (durationSeconds <= 0) return 0

  const minutes = durationSeconds / 60
  const billedMinutes = Math.ceil(minutes / minuteIncrement) * minuteIncrement
  return billedMinutes / 60
}

/**
 * Round raw tracked seconds up to the firm's billing increment, expressed in
 * billed MINUTES (integer). Useful for exact integer money math downstream.
 */
export function roundToBilledMinutes(
  durationSeconds: number,
  minuteIncrement: number,
): number {
  if (minuteIncrement <= 0) {
    throw new Error('minuteIncrement must be a positive number')
  }
  if (durationSeconds <= 0) return 0

  const minutes = durationSeconds / 60
  return Math.ceil(minutes / minuteIncrement) * minuteIncrement
}

/**
 * Parse a duration into raw seconds. Accepts:
 *   - hours:minutes        — "0:30", "1:45", "12:05"      (h:mm)
 *   - hours:minutes:seconds — "0:01:30", "1:05:00"        (h:mm:ss)
 *   - decimal hours        — "0.5", "1.25", "2"
 *
 * The colon forms carry seconds because the segmented Duration input emits a
 * canonical h:mm:ss string; a leading days field is never used, so a colon
 * string can't be misread as days:hours:minutes.
 *
 * @returns seconds (integer, rounded), or null if unparseable.
 */
export function parseDurationToSeconds(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    // h:mm or h:mm:ss — two or three parts only.
    if (parts.length !== 2 && parts.length !== 3) return null

    const nums = parts.map((p) => Number(p))
    if (nums.some((n) => Number.isNaN(n) || n < 0)) return null

    const [h, m, s = 0] = nums
    if (m >= 60) return null // minutes must be a sane clock value
    if (s >= 60) return null // seconds must be a sane clock value

    return Math.round(h * 3600 + m * 60 + s)
  }

  // Decimal hours
  const hours = Number(trimmed)
  if (Number.isNaN(hours) || hours < 0) return null
  return Math.round(hours * 3600)
}

/**
 * Format raw seconds as "HH:MM:SS" (zero-padded, hours not capped).
 * Used by the live header timer display.
 */
export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Format raw seconds as a plain, unambiguous human duration (no clock-style
 * colons that could be misread as days:hours:minutes). Keeps seconds visible at
 * sub-hour scale so short sessions don't read as zero:
 *   45    → "45s"
 *   330   → "5m 30s"
 *   3930  → "1h 5m"
 * Used for the read-only "tracked" reference in the time-entry modal.
 */
export function formatSecondsToHuman(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

/**
 * Format raw seconds as decimal hours, e.g. 1800 → "0.50".
 * @param fractionDigits number of decimals (default 2)
 */
export function formatSecondsToDecimalHours(
  totalSeconds: number,
  fractionDigits = 2,
): string {
  const safe = Math.max(0, totalSeconds)
  return (safe / 3600).toFixed(fractionDigits)
}
