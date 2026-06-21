import { Suspense, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import { Plus, Receipt } from 'lucide-react'

import { getBillsSummary } from '@/server/bills'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

import { NewInvoiceDialog } from './NewInvoiceDialog'

// ===========================================================================
// BillsWidget — outstanding A/R and work-in-progress summary.
//
// LIVE data: reads real invoices + unbilled WIP via `getBillsSummary`. The
// query is shared as `billsSummaryQueryOptions` so the dashboard route loader
// can prefetch it for SSR (ensureQueryData) and the inner component reads the
// cache via useSuspenseQuery. The "+ New invoice" button opens a local Dialog
// that writes via the `createInvoice` server fn.
// ===========================================================================

export const billsSummaryQueryOptions = queryOptions({
  queryKey: ['bills', 'summary'],
  queryFn: () => getBillsSummary(),
})

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function BillsWidget() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" />
          Bills
        </CardTitle>
        <CardDescription>Outstanding &amp; work in progress</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <Link
              to="/bills"
              search={{ status: 'all' }}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all invoices →
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="size-4" />
              New invoice
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <Suspense fallback={<BillsSkeleton />}>
          <BillsSummary />
        </Suspense>
      </CardContent>

      <NewInvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}

function BillsSummary() {
  const { data: bills } = useSuspenseQuery(billsSummaryQueryOptions)

  const outstandingAmount = Number(bills.outstanding.amount)
  const wipAmount = Number(bills.wip.amount)
  const overdueAmount = Number(bills.overdue.amount)

  const isEmpty =
    outstandingAmount === 0 &&
    wipAmount === 0 &&
    overdueAmount === 0 &&
    bills.draftCount === 0 &&
    bills.drafts.length === 0

  if (isEmpty) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No outstanding bills.
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Outstanding A/R</p>
          <p className="text-2xl font-semibold tabular-nums">
            {currency.format(outstandingAmount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {bills.outstanding.count}{' '}
            {bills.outstanding.count === 1 ? 'invoice' : 'invoices'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Unbilled WIP</p>
          <p className="text-2xl font-semibold tabular-nums">
            {currency.format(wipAmount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {bills.wip.count} {bills.wip.count === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Overdue
          {bills.overdue.count > 0 ? (
            <span className="ml-1 text-xs">({bills.overdue.count})</span>
          ) : null}
        </span>
        <span className="font-medium tabular-nums text-destructive">
          {currency.format(overdueAmount)}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Draft invoices</span>
        <span className="font-medium tabular-nums">{bills.draftCount}</span>
      </div>

      {bills.drafts.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {bills.drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{draft.number}</span>
                <span className="ml-2 truncate text-xs text-muted-foreground">
                  {draft.clientName ?? 'No client'}
                </span>
              </div>
              <span className="shrink-0 font-medium tabular-nums">
                {currency.format(Number(draft.total))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/** Skeleton shown while the live bills summary hydrates. */
function BillsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <Separator />
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-12 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-4 w-6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
