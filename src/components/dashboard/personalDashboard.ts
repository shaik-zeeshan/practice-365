import { queryOptions } from '@tanstack/react-query'

import { getPersonalDashboard } from '@/server/dashboard'

// ===========================================================================
// Shared query + formatters for the Clio-style Personal Dashboard.
//
// One server call (getPersonalDashboard) backs every section — the gauge, the
// billing cards, the financial bars and the annual report all read this same
// cached result via useSuspenseQuery, and the dashboard route prefetches it for
// SSR. Keeping the queryOptions here avoids each widget re-declaring the key.
// ===========================================================================

export const personalDashboardQueryOptions = queryOptions({
  queryKey: ['dashboard', 'personal'],
  queryFn: () => getPersonalDashboard(),
})

/** Whole-dollar currency, e.g. "$1,800". */
export const currency0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Decimal hours as "2.8h". */
export function hrs(n: number): string {
  return `${n.toFixed(1)}h`
}

// Shared chart palette (CSS vars from styles.css). Used as inline SVG/style
// fills so they work regardless of which Tailwind color utilities are emitted.
// Blue = actual everywhere; gray = target; amber = expected (bars only).
export const CHART = {
  actual: 'var(--chart-3)',
  expected: 'var(--chart-5)',
  target: 'var(--muted-foreground)',
  track: 'var(--border)',
} as const
