import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

import { personalDashboardQueryOptions, hrs, CHART } from './personalDashboard'
import type { PeriodKey } from '@/lib/periods'
import { Card, CardContent } from '@/components/ui/card'

// ===========================================================================
// HourlyMetricsWidget — "Hourly Metrics for {name}" / Billable Hours Target.
//
// LIVE per-user data. A Today/Week/Month/Year toggle picks which period the
// donut shows; all four periods are already in the cached payload, so toggling
// is instant (no refetch). The ring is actual vs target; the amber tick marks
// where the user is "expected" to be by now (goal pro-rated to elapsed days).
// ===========================================================================

const TOGGLE: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
]

interface DonutProps {
  actualHours: number
  expectedHours: number
  targetHours: number
}

/** SVG progress ring: fill = actual/target, amber tick = expected/target. */
function Donut({ actualHours, expectedHours, targetHours }: DonutProps) {
  const size = 180
  const stroke = 16
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  const hasTarget = targetHours > 0
  const pct = hasTarget ? Math.min(actualHours / targetHours, 1) : 0
  const expPct = hasTarget ? Math.min(expectedHours / targetHours, 1) : 0
  const dash = circumference * pct

  // Expected tick position on the ring (start at 12 o'clock, clockwise).
  const theta = expPct * 2 * Math.PI - Math.PI / 2
  const tickInner = r - stroke / 2 - 2
  const tickOuter = r + stroke / 2 + 2
  const tx1 = cx + tickInner * Math.cos(theta)
  const ty1 = cy + tickInner * Math.sin(theta)
  const tx2 = cx + tickOuter * Math.cos(theta)
  const ty2 = cy + tickOuter * Math.sin(theta)

  const onTrack = actualHours >= expectedHours

  return (
    <div className="relative mx-auto h-44 w-44">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={CHART.track}
            strokeWidth={stroke}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={CHART.actual}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </g>
        {targetHours > 0 && (
          <line
            x1={tx1}
            y1={ty1}
            x2={tx2}
            y2={ty2}
            stroke={CHART.expected}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-semibold tabular-nums"
          style={{ color: CHART.actual }}
        >
          {hrs(actualHours)}
        </span>
        {hasTarget ? (
          <>
            <span className="text-xs text-muted-foreground">
              of {hrs(targetHours)} target
            </span>
            <span
              className={`mt-1 text-[11px] font-medium ${
                onTrack ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {onTrack ? 'On track' : `${hrs(expectedHours)} expected`}
            </span>
          </>
        ) : (
          <span className="mt-1 text-xs text-muted-foreground">
            Non-working day
          </span>
        )}
      </div>
    </div>
  )
}

export function HourlyMetricsWidget() {
  const { data } = useSuspenseQuery(personalDashboardQueryOptions)
  const [periodKey, setPeriodKey] = useState<PeriodKey>('today')
  const period =
    data.periods.find((p) => p.key === periodKey) ?? data.periods[0]

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-tight">
        Hourly Metrics for {data.userName}
      </h2>
      <Card>
        <CardContent className="space-y-4">
          <p className="text-center text-sm font-medium">
            Billable Hours Target
          </p>

          <div className="flex flex-wrap justify-center gap-1 text-xs">
            {TOGGLE.map((t) => {
              const active = t.key === periodKey
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setPeriodKey(t.key)}
                  className={
                    active
                      ? 'rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground'
                      : 'rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted'
                  }
                  aria-pressed={active}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          <Donut
            actualHours={period.actualHours}
            expectedHours={period.expectedHours}
            targetHours={period.targetHours}
          />

          <div className="flex items-center justify-center">
            <Link
              to="/settings/performance"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings className="size-3.5" />
              Personal performance settings
            </Link>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
