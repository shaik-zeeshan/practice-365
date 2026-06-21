import { useSuspenseQuery } from '@tanstack/react-query'

import {
  personalDashboardQueryOptions,
  currency0,
  CHART,
} from './personalDashboard'
import { useElementWidth, niceMax } from './chartUtils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ===========================================================================
// AnnualReportWidget — "Detailed Annual Report".
//
// LIVE per-user data: cumulative billed dollars across the 12 months of the
// year. The gray dashed line is the cumulative target (goal × business days);
// the blue line is cumulative actual, stopping at the current month (the future
// is unknown). Hand-drawn SVG — no chart dependency, SSR-safe.
//
// The SVG is drawn at a 1:1 pixel scale (1 user unit = 1 CSS px) by measuring
// the card width, so its 10px labels / 2px lines stay the same size as the rest
// of the dashboard. A plain `viewBox` would scale the whole drawing up on wide
// screens, making the text and lines look oversized ("zoomed in").
// ===========================================================================

const H = 260
const FALLBACK_W = 720 // SSR / first paint, before we can measure.
const PAD = { left: 60, right: 16, top: 16, bottom: 28 }
const PLOT_H = H - PAD.top - PAD.bottom

export function AnnualReportWidget() {
  const { data } = useSuspenseQuery(personalDashboardQueryOptions)
  const annual = data.annual

  const [containerRef, W] = useElementWidth<HTMLDivElement>(FALLBACK_W)
  const PLOT_W = W - PAD.left - PAD.right

  const targetVals = annual.map((a) => Number(a.cumulativeTarget))
  const actualVals = annual.map((a) =>
    a.cumulativeActual === null ? null : Number(a.cumulativeActual),
  )
  const rawMax = Math.max(
    ...targetVals,
    ...actualVals.filter((v): v is number => v !== null),
    1,
  )
  const max = niceMax(rawMax)

  const x = (i: number) => PAD.left + (i / (annual.length - 1)) * PLOT_W
  const y = (v: number) => PAD.top + PLOT_H * (1 - v / max)
  const baseline = PAD.top + PLOT_H

  const targetPoints = targetVals.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  // Actual line only spans months with data (up to the current month).
  const actualIdx = actualVals
    .map((v, i) => (v === null ? -1 : i))
    .filter((i) => i >= 0)
  const actualPoints = actualIdx.map((i) => `${x(i)},${y(actualVals[i]!)}`)
  const actualLine = actualPoints.join(' ')
  const actualArea =
    actualIdx.length > 0
      ? `M ${x(actualIdx[0])},${baseline} L ${actualPoints.join(' L ')} L ${x(
          actualIdx[actualIdx.length - 1],
        )},${baseline} Z`
      : ''

  const ticks = [0, max / 2, max]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Detailed Annual Report</CardTitle>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ backgroundColor: CHART.target }}
            />
            Target
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ backgroundColor: CHART.actual }}
            />
            Actual
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="w-full">
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="block"
            role="img"
            aria-label="Cumulative target versus actual billed dollars by month"
          >
            {/* Horizontal gridlines + Y labels */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  y1={y(t)}
                  x2={W - PAD.right}
                  y2={y(t)}
                  stroke={CHART.track}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {currency0.format(t)}
                </text>
              </g>
            ))}

            {/* X labels (month initials) */}
            {annual.map((m, i) => (
              <text
                key={m.label}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {m.label}
              </text>
            ))}

            {/* Actual area fill */}
            {actualArea && (
              <path d={actualArea} fill={CHART.actual} opacity={0.12} />
            )}

            {/* Target line (dashed) */}
            <polyline
              points={targetPoints}
              fill="none"
              stroke={CHART.target}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />

            {/* Actual line */}
            {actualLine && (
              <polyline
                points={actualLine}
                fill="none"
                stroke={CHART.actual}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* Actual dots */}
            {actualIdx.map((i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(actualVals[i]!)}
                r={3}
                fill={CHART.actual}
              />
            ))}
          </svg>
        </div>
      </CardContent>
    </Card>
  )
}
