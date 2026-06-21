import { queryOptions } from '@tanstack/react-query'

import { getFirmOverview } from '@/server/firm-overview'
import type { RateBasis } from '@/server/firm-overview'

import { CHART, currency0, hrs } from './personalDashboard'

// ===========================================================================
// Shared query + formatters + palette for the Clio-style Firm Overview.
//
// One server call (getFirmOverview) backs all three sections — Utilization,
// Realization and Collection each read this same cached result, and the route
// prefetches it for SSR. Keeping the queryOptions here avoids each section
// re-declaring the key.
//
// The query key folds in the filters (year / role / rateBasis), so every
// filter combo caches separately and changing a filter REFETCHES (new key).
// The Hr / $ / % unit toggle, by contrast, is pure client-side — the server
// already returns hours, value cents and rate together in every monthly point,
// so flipping the unit never hits the network.
// ===========================================================================

/** Firm Overview filters — what the client may NARROW by (never firmId). */
export interface FirmFilters {
  year: number
  role: string // 'all' or a specific role
  rateBasis: RateBasis
}

/** Sensible initial filters: current year, all roles, billed rate basis. */
export function defaultFirmFilters(): FirmFilters {
  return { year: new Date().getFullYear(), role: 'all', rateBasis: 'bill' }
}

/**
 * Query options for the firm overview. Keyed by every filter so each combo
 * caches independently; changing a filter is a new key → a refetch.
 */
export function firmOverviewQueryOptions(filters: FirmFilters) {
  return queryOptions({
    queryKey: [
      'dashboard',
      'firm-overview',
      filters.year,
      filters.role,
      filters.rateBasis,
    ],
    queryFn: () => getFirmOverview({ data: filters }),
  })
}

// --- Formatters (shared with the personal dashboard) -----------------------

// currency0 ("$1,800") and hrs ("2.8h") are identical to the personal
// dashboard's — re-export to stay DRY.
export { currency0, hrs }

/** A rate (0..1) as a whole-percent string, e.g. "82%". For the % unit + donut. */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/**
 * Integer cents → whole-dollar currency, e.g. 180000 → "$1,800". The server
 * surfaces money as integer cents, so the UI divides by 100 before formatting.
 */
export function centsToCurrency0(cents: number): string {
  return currency0.format(cents / 100)
}

// --- Palette ---------------------------------------------------------------

// Shared chart palette (CSS vars from styles.css) — re-exported so the firm
// charts use the exact same dashboard colors.
export { CHART }

// Per-section series colors, mapping each series KEY to a chart CSS var so the
// stacked bars, legend and totals chips stay consistent. Blue (--chart-3) =
// the "actual"/primary series, amber (--chart-5) = secondary, gray (--border)
// = the track/remainder.
export const FIRM_PALETTE: Record<string, string> = {
  // utilization
  billable: 'var(--chart-3)',
  nonBillable: 'var(--chart-5)',
  untracked: 'var(--border)',
  // realization
  billed: 'var(--chart-3)',
  discounted: 'var(--chart-5)',
  unbilledDraft: 'var(--border)',
  // collection
  collected: 'var(--chart-3)',
  uncollected: 'var(--chart-5)',
  // the single % bar
  rate: 'var(--chart-3)',
}

// --- Re-exported domain types (component convenience) ----------------------

export type {
  FirmOverview,
  FirmSection,
  FirmMonthlyPoint,
  FirmTotal,
  FirmSeries,
  FirmUnit,
  RateBasis,
} from '@/server/firm-overview'
