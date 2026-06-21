import { useElementWidth, niceMax } from '../chartUtils'
import {
  CHART,
  FIRM_PALETTE,
  currency0,
  hrs,
  pct,
} from '../firmOverview'
import type { FirmMonthlyPoint, FirmSeries, FirmUnit } from '../firmOverview'

// ===========================================================================
// MonthlyBarChart — the firm-overview stacked/single bar chart.
//
// Hand-drawn SVG (no chart dependency), SSR-safe via useElementWidth, drawn at
// a 1:1 pixel scale like AnnualReportWidget so the 10px labels stay crisp.
//
//   hours / value : STACKED bars — one segment per series (bottom = series[0]).
//   rate          : a SINGLE bar per month, drawn against a fixed max of 1.
// ===========================================================================

const H = 220
const FALLBACK_W = 720 // SSR / first paint, before we can measure.
const PAD = { left: 48, right: 12, top: 12, bottom: 24 }
const PLOT_H = H - PAD.top - PAD.bottom

interface MonthlyBarChartProps {
  monthly: Array<FirmMonthlyPoint>
  series: Array<FirmSeries>
  unit: FirmUnit
}

export function MonthlyBarChart({
  monthly,
  series,
  unit,
}: MonthlyBarChartProps) {
  const [containerRef, W] = useElementWidth<HTMLDivElement>(FALLBACK_W)
  const PLOT_W = W - PAD.left - PAD.right

  const isRate = unit === 'rate'

  // Per-series value for a month, in the active unit's natural scale.
  const segValue = (point: FirmMonthlyPoint, key: string) =>
    unit === 'hours' ? point.hours[key] : point.valueCents[key] / 100

  // Month total (sum of stacked series) — used to size the y-axis.
  const monthTotal = (point: FirmMonthlyPoint) =>
    series.reduce((sum, s) => sum + segValue(point, s.key), 0)

  const maxMonthTotal = Math.max(...monthly.map(monthTotal), 0)
  const max = isRate ? 1 : niceMax(maxMonthTotal || 1)

  const baseline = PAD.top + PLOT_H
  const y = (v: number) => PAD.top + PLOT_H * (1 - v / max)

  const colW = PLOT_W / monthly.length
  const barW = colW * 0.6
  const colCenter = (i: number) => PAD.left + colW * i + colW / 2

  const ticks = [0, max / 2, max]
  const formatTick = (t: number) =>
    isRate ? pct(t) : unit === 'hours' ? hrs(t) : currency0.format(t)
  const formatVal = (v: number) =>
    isRate ? pct(v) : unit === 'hours' ? hrs(v) : currency0.format(v)

  return (
    <div ref={containerRef} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
        aria-label={`Monthly ${unit} by series for each month of the year`}
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
              {formatTick(t)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {monthly.map((point, i) => {
          const cx = colCenter(i)
          const left = cx - barW / 2

          if (isRate) {
            const v = point.rate
            const top = y(v)
            return (
              <rect
                key={point.label}
                x={left}
                y={top}
                width={barW}
                height={Math.max(baseline - top, 0)}
                rx={2}
                fill={FIRM_PALETTE.rate}
              >
                <title>{`Rate: ${formatVal(v)}`}</title>
              </rect>
            )
          }

          // Stacked segments, from the baseline up (bottom = series[0]).
          let acc = 0
          return (
            <g key={point.label}>
              {series.map((s, si) => {
                const v = segValue(point, s.key)
                const segBottom = baseline - (acc / max) * PLOT_H
                acc += v
                const segTop = baseline - (acc / max) * PLOT_H
                const height = Math.max(segBottom - segTop, 0)
                const isTop = si === series.length - 1
                return (
                  <rect
                    key={s.key}
                    x={left}
                    y={segTop}
                    width={barW}
                    height={height}
                    rx={isTop ? 2 : 0}
                    fill={FIRM_PALETTE[s.key]}
                  >
                    <title>{`${s.label}: ${formatVal(v)}`}</title>
                  </rect>
                )
              })}
            </g>
          )
        })}

        {/* X labels (month initials) */}
        {monthly.map((point, i) => (
          <text
            key={point.label}
            x={colCenter(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {point.label[0]}
          </text>
        ))}
      </svg>
    </div>
  )
}
