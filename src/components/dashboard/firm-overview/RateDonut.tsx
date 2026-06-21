import { CHART, pct } from '../firmOverview'

// ===========================================================================
// RateDonut — distilled from HourlyMetricsWidget's `Donut`.
//
// A pure SVG progress ring: the blue arc fills `rate` (0..1) of the circle,
// starting at 12 o'clock and sweeping clockwise (the rotate(-90) trick). The
// center overlays the rate as a big percentage with the average underneath.
// ===========================================================================

interface RateDonutProps {
  rate: number // 0..1, the main fill fraction
  avg: number // 0..1, secondary "x% avg" line
}

export function RateDonut({ rate, avg }: RateDonutProps) {
  const size = 160
  const stroke = 16
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  const fill = Math.min(Math.max(rate, 0), 1)
  const dash = circumference * fill

  return (
    <div className="relative mx-auto h-40 w-40">
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
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-semibold tabular-nums"
          style={{ color: CHART.actual }}
        >
          {pct(rate)}
        </span>
        <span className="text-xs text-muted-foreground">{pct(avg)} avg</span>
      </div>
    </div>
  )
}
