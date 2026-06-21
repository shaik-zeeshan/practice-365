import { useState } from 'react'

import {
  FIRM_PALETTE,
  centsToCurrency0,
  hrs,
} from '../firmOverview'
import type { FirmSection, FirmUnit } from '../firmOverview'
import { RateDonut } from './RateDonut'
import { MonthlyBarChart } from './MonthlyBarChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ===========================================================================
// OverviewSection — one card per firm metric (Utilization / Realization /
// Collection). The left column is the rate donut + totals chips; the right is
// the monthly stacked-bar chart with a client-only Hr/$/% unit toggle.
// ===========================================================================

const UNIT_LABEL: Record<FirmUnit, string> = {
  hours: 'Hr',
  value: '$',
  rate: '%',
}

interface OverviewSectionProps {
  title: string
  section: FirmSection
}

export function OverviewSection({ title, section }: OverviewSectionProps) {
  const [activeUnit, setActiveUnit] = useState<FirmUnit>(section.units[0])

  const hasData = section.totals.some(
    (t) => t.hours > 0 || t.valueCents > 0,
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            You have no data to display for this period
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
            {/* Left: donut + totals chips */}
            <div className="space-y-3">
              <p className="text-center text-xs font-medium text-muted-foreground">
                Rate average
              </p>
              <RateDonut rate={section.rate} avg={section.avg} />
              <div className="space-y-1.5">
                {section.totals.map((t) => (
                  <div
                    key={t.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: FIRM_PALETTE[t.key] }}
                      />
                      {t.label}
                    </span>
                    <span className="text-sm font-medium tabular-nums">
                      {section.totalsUnit === 'hours'
                        ? hrs(t.hours)
                        : centsToCurrency0(t.valueCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: monthly chart + unit toggle + legend */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Monthly
                </span>
                <div className="flex flex-wrap justify-end gap-1 text-xs">
                  {section.units.map((u) => {
                    const active = u === activeUnit
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setActiveUnit(u)}
                        className={
                          active
                            ? 'rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground'
                            : 'rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted'
                        }
                        aria-pressed={active}
                      >
                        {UNIT_LABEL[u]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <MonthlyBarChart
                monthly={section.monthly}
                series={section.series}
                unit={activeUnit}
              />

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {section.series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-2.5 rounded-sm"
                      style={{ backgroundColor: FIRM_PALETTE[s.key] }}
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
