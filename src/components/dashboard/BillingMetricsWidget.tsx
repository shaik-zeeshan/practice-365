import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileText, Clock, AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { personalDashboardQueryOptions, currency0 } from './personalDashboard'
import type { BillingBucket } from '@/server/dashboard'
import { Card, CardContent } from '@/components/ui/card'

// ===========================================================================
// BillingMetricsWidget — "Billing Metrics for Firm".
//
// LIVE firm-wide data from the invoices table. Three buckets, matching Clio:
//   Draft   — draft + pending-approval invoices (not yet a live receivable)
//   Unpaid  — issued, awaiting payment
//   Overdue — unpaid AND past their due date (a highlighted subset of Unpaid)
// Each card shows the bill count and the dollar total in that bucket.
// ===========================================================================

interface BillCard {
  label: string
  icon: LucideIcon
  bucket: BillingBucket
  /** The /bills status filter this bucket drills into. */
  status: 'draft' | 'unpaid' | 'overdue'
  /** Emphasise in red when non-empty (overdue). */
  danger?: boolean
}

export function BillingMetricsWidget() {
  const { data } = useSuspenseQuery(personalDashboardQueryOptions)

  const cards: Array<BillCard> = [
    {
      label: 'Draft Bills',
      icon: FileText,
      bucket: data.billing.draft,
      status: 'draft',
    },
    {
      label: 'Unpaid Bills',
      icon: Clock,
      bucket: data.billing.unpaid,
      status: 'unpaid',
    },
    {
      label: 'Overdue Bills',
      icon: AlertTriangle,
      bucket: data.billing.overdue,
      status: 'overdue',
      danger: true,
    },
  ]

  return (
    <section className="flex h-full flex-col">
      <h2 className="mb-2 text-sm font-semibold tracking-tight">
        Billing Metrics for Firm
      </h2>
      <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 lg:grid-rows-3">
        {cards.map((c) => {
          const Icon = c.icon
          const isDanger = c.danger && c.bucket.count > 0
          return (
            <Link
              key={c.label}
              to="/bills"
              search={{ status: c.status }}
              className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card className="h-full justify-center py-4 transition-colors hover:bg-muted/50">
                <CardContent className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      {c.label}
                    </p>
                    <Icon
                      className={`size-4 ${
                        isDanger ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      isDanger ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {c.bucket.count}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {currency0.format(Number(c.bucket.total))} total
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
