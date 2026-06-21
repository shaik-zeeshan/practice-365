import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, queryOptions } from '@tanstack/react-query'

import { getFirmConfig } from '@/server/matters'
import { listTimeEntries } from '@/server/time-entries'
import { formatSecondsToClock } from '@/lib/rounding'
import { computeAmount } from '@/lib/services/billing'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { TimeEntryListItem } from '@/server/time-entries'

// ===========================================================================
// /time — firm time-entries list (STACK.md §7).
//
// Reads REAL entries via `listTimeEntries` (GET createServerFn, no validator →
// called with zero args). Prefetched in the loader for SSR, read via
// useSuspenseQuery. The amount column is DERIVED with `computeAmount` using the
// firm's REAL minuteIncrement, fetched via getFirmConfig() (firms.minuteIncrement
// in the DB) — money math stays in integer cents, never floats.
// ===========================================================================

const timeEntriesQueryOptions = queryOptions({
  queryKey: ['time-entries', 'list'],
  queryFn: () => listTimeEntries(),
})

// Firm billing config (STACK.md §1, §7) — the real minuteIncrement lives on
// firms.minuteIncrement. Same query key the TimeEntryModal uses, so the cache is
// shared. Prefetched in the loader for SSR.
const firmConfigQueryOptions = queryOptions({
  queryKey: ['firm-config'],
  queryFn: () => getFirmConfig(),
})

export const Route = createFileRoute('/time')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(timeEntriesQueryOptions),
      context.queryClient.ensureQueryData(firmConfigQueryOptions),
    ]),
  component: TimePage,
})

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format a numeric-string amount ("30.00") as currency. */
function formatAmount(amount: string): string {
  return currency.format(Number(amount))
}

function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function billableBadge(status: TimeEntryListItem['billable']) {
  switch (status) {
    case 'billable':
      return { label: 'Billable', variant: 'default' as const }
    case 'non_billable':
      return { label: 'Non-billable', variant: 'secondary' as const }
    case 'no_charge':
      return { label: 'No charge', variant: 'outline' as const }
  }
}

function TimePage() {
  const { data: entries } = useSuspenseQuery(timeEntriesQueryOptions)
  const { data: firmConfig } = useSuspenseQuery(firmConfigQueryOptions)
  const minuteIncrement = firmConfig.minuteIncrement

  // Total unbilled WIP: sum of billable, unbilled (invoiceId == null) amounts.
  // Computed via computeAmount (integer cents) — accumulate cents, not floats.
  let wipCents = 0
  let billableCents = 0
  for (const entry of entries) {
    const { amountCents } = computeAmount({
      durationSeconds: entry.durationSeconds,
      minuteIncrement,
      rate: entry.rate,
    })
    if (entry.billable === 'billable') {
      billableCents += amountCents
      if (entry.invoiceId == null) wipCents += amountCents
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Time Entries
          </h1>
          <p className="text-sm text-muted-foreground">
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · amounts
            rounded to the firm&apos;s {minuteIncrement}-minute increment
          </p>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Unbilled WIP</p>
            <p className="text-2xl font-semibold tabular-nums">
              {currency.format(wipCents / 100)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total billable</p>
            <p className="text-2xl font-semibold tabular-nums">
              {currency.format(billableCents / 100)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Matter</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Narrative</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  No time entries yet.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const badge = billableBadge(entry.billable)
                const { billedHours, amount } = computeAmount({
                  durationSeconds: entry.durationSeconds,
                  minuteIncrement,
                  rate: entry.rate,
                })
                const charged = entry.billable === 'billable'
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDate(entry.date)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {entry.matterName ?? (
                          <span className="text-muted-foreground">
                            No matter
                          </span>
                        )}
                      </div>
                      {entry.clientName ? (
                        <div className="text-xs text-muted-foreground">
                          {entry.clientName}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{entry.userName ?? '—'}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate" title={entry.narrative ?? ''}>
                        {entry.narrative ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      {entry.activity ? (
                        <div className="text-xs text-muted-foreground">
                          {entry.activity}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatSecondsToClock(entry.durationSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {billedHours.toFixed(1)}h
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.rate != null ? (
                        formatAmount(entry.rate) + '/h'
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {charged ? (
                        formatAmount(amount)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          {entries.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={8} className="text-right">
                  Total billable WIP
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {currency.format(wipCents / 100)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </div>
  )
}
