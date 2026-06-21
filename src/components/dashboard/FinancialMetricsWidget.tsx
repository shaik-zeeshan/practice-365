import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import {
  personalDashboardQueryOptions,
  currency0,
  CHART,
} from './personalDashboard'
import type { PeriodMetrics } from '@/server/dashboard'
import { Card, CardContent } from '@/components/ui/card'

// ===========================================================================
// FinancialMetricsWidget — "Financial Metrics for {name}".
//
// LIVE per-user data: one mini bar chart per period (Today / This Week / This
// Month / This Year), each comparing Actual vs Expected vs Target dollars.
//   Actual   = real billable $ logged (blue)
//   Expected = goal pro-rated to elapsed working days (amber)
//   Target   = goal for the whole period (gray)
// Bars are sized against the tallest of the three (usually Target).
// ===========================================================================

const SERIES: Array<{
  key: 'actualAmount' | 'expectedAmount' | 'targetAmount'
  label: string
  color: string
}> = [
  { key: 'actualAmount', label: 'Actual', color: CHART.actual },
  { key: 'expectedAmount', label: 'Expected', color: CHART.expected },
  { key: 'targetAmount', label: 'Target', color: CHART.target },
]

function PeriodChart({ period }: { period: PeriodMetrics }) {
  const values = SERIES.map((s) => Number(period[s.key]))
  const max = Math.max(...values, 1)

  return (
    <Card className="py-4">
      <CardContent className="space-y-2 px-4">
        <p className="text-center text-xs font-medium">{period.label}</p>
        <div className="flex h-28 items-end justify-around gap-2">
          {SERIES.map((s, i) => {
            const value = values[i]
            const heightPct = Math.max((value / max) * 100, value > 0 ? 4 : 1.5)
            return (
              <div
                key={s.key}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                  {currency0.format(value)}
                </span>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${heightPct}%`, backgroundColor: s.color }}
                  title={`${s.label}: ${currency0.format(value)}`}
                />
                <span className="text-[10px] text-muted-foreground">
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function FinancialMetricsWidget() {
  const { data } = useSuspenseQuery(personalDashboardQueryOptions)

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Financial Metrics for {data.userName}
          </h2>
          <Link
            to="/time"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View time entries →
          </Link>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.periods.map((p) => (
          <PeriodChart key={p.key} period={p} />
        ))}
      </div>
    </section>
  )
}
