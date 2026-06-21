import { useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import { Clock, CircleSlash, Wallet, Percent } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { getDashboardMetrics } from '@/server/dashboard'
import { Card, CardContent } from '@/components/ui/card'

// ===========================================================================
// MetricsBar — Clio-Manage-style KPI row at the top of the firm dashboard.
//
// LIVE data: reads real `time_entries` rollups via `getDashboardMetrics`. The
// query is shared as `dashboardMetricsQueryOptions` so the dashboard route
// loader can prefetch it for SSR (ensureQueryData) and this component reads the
// cache via useSuspenseQuery — no loading flash, real numbers on first paint.
// ===========================================================================

export const dashboardMetricsQueryOptions = queryOptions({
  queryKey: ['dashboard', 'metrics'],
  queryFn: () => getDashboardMetrics(),
})

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Format decimal hours as "2.8h". */
function hrs(n: number): string {
  return `${n.toFixed(1)}h`
}

interface MetricCard {
  label: string
  icon: LucideIcon
  value: string
  sub: string
  /** De-emphasise the big number (used for the non-billable card). */
  muted?: boolean
}

export function MetricsBar() {
  const { data: m } = useSuspenseQuery(dashboardMetricsQueryOptions)

  const cards: Array<MetricCard> = [
    {
      label: 'Billable Hours',
      icon: Clock,
      value: hrs(m.billableHours),
      sub: `${hrs(m.hoursToday)} logged today`,
    },
    {
      label: 'Non-Billable',
      icon: CircleSlash,
      value: hrs(m.nonBillableHours),
      sub: 'non-billable + no-charge',
      muted: true,
    },
    {
      label: 'Work in Progress',
      icon: Wallet,
      value: currency.format(Number(m.wipAmount)),
      sub: `${m.wipEntryCount} unbilled ${
        m.wipEntryCount === 1 ? 'entry' : 'entries'
      }`,
    },
    {
      label: 'Realization Rate',
      icon: Percent,
      value: `${Math.round(m.realizationRate * 100)}%`,
      sub: `${hrs(m.billableHours)} of ${hrs(m.totalTrackedHours)} tracked`,
    },
  ]

  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Firm metrics · {m.period}
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.label} className="gap-2 py-4">
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {c.label}
                  </p>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <p
                  className={`text-2xl font-semibold tabular-nums ${
                    c.muted ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {c.value}
                </p>
                <p className="text-xs text-muted-foreground">{c.sub}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/** Skeleton shown while the live metrics hydrate (matches the 4-card layout). */
export function MetricsBarSkeleton() {
  return (
    <div className="mb-4">
      <div className="mb-2 h-3 w-32 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-2 py-4">
            <CardContent className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
