import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Ban, Check, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { listInvoices, updateInvoiceStatus } from '@/server/bills'
import type { InvoiceListItem } from '@/server/bills'
import { billsSummaryQueryOptions } from '@/components/dashboard/BillsWidget'
import { InvoiceFormDialog } from '@/components/dashboard/NewInvoiceDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TablePagination } from '@/components/ui/pagination'
import { usePagination } from '@/hooks/use-pagination'

// ===========================================================================
// /bills — firm invoices & receivables (the drill-in for the dashboard Bills
// and Billing-metrics widgets).
//
// Reads REAL invoices via `listInvoices` (GET createServerFn, no validator →
// called with zero args), prefetched in the loader for SSR and read via
// useSuspenseQuery. The summary cards reuse `billsSummaryQueryOptions` from the
// BillsWidget so the numbers match the dashboard exactly. The active status
// filter lives in the `?status=` search param so the page is linkable
// (e.g. /bills?status=overdue from the Billing-metrics widget). Money amounts
// are numeric strings → wrapped with Number() before formatting.
// ===========================================================================

/** The firm's recent invoices — shared key with createInvoice's invalidate. */
export const invoicesQueryOptions = queryOptions({
  queryKey: ['invoices'],
  queryFn: () => listInvoices(),
})

// The status filter values. 'all' shows everything; 'overdue' is the DERIVED
// subset (overdue === true) rather than a stored invoice status.
const statusFilters = [
  'all',
  'draft',
  'pending',
  'unpaid',
  'overdue',
  'paid',
] as const
type StatusFilter = (typeof statusFilters)[number]

const statusFilterLabels: Record<StatusFilter, string> = {
  all: 'All',
  draft: 'Draft',
  pending: 'Pending',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  paid: 'Paid',
}

interface BillsSearch {
  status: StatusFilter
}

export const Route = createFileRoute('/bills')({
  validateSearch: (search: Record<string, unknown>): BillsSearch => {
    const status = search.status
    return {
      status:
        typeof status === 'string' &&
        (statusFilters as ReadonlyArray<string>).includes(status)
          ? (status as StatusFilter)
          : 'all',
    }
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(invoicesQueryOptions),
      context.queryClient.ensureQueryData(billsSummaryQueryOptions),
    ]),
  component: BillsPage,
})

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const currency0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Format a numeric-string amount ("1234.50") as currency. */
function formatAmount(amount: string): string {
  return currency.format(Number(amount))
}

function formatDate(value: Date | string | null): string {
  if (value == null) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadge(status: InvoiceListItem['status']): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} {
  switch (status) {
    case 'paid':
      return { label: 'Paid', variant: 'default' }
    case 'unpaid':
      return { label: 'Unpaid', variant: 'secondary' }
    case 'pending':
      return { label: 'Pending', variant: 'outline' }
    case 'draft':
      return { label: 'Draft', variant: 'outline' }
    case 'void':
      return { label: 'Void', variant: 'secondary' }
  }
}

type InvoiceStatus = InvoiceListItem['status']

// Human labels for every stored status (used by the toast + status submenu).
const statusLabels: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  unpaid: 'Unpaid (issued)',
  paid: 'Paid',
  void: 'Void',
}

// The explicit "Change status →" submenu list. 'void' is excluded — it's the
// dedicated destructive action (with confirmation) instead. 'overdue' is never
// here: it's a derived view of unpaid, not a stored status.
const changeableStatuses: ReadonlyArray<InvoiceStatus> = [
  'draft',
  'pending',
  'unpaid',
  'paid',
]

// Statuses that still owe money → the inline "Mark paid" quick button applies.
const payableStatuses: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'draft',
  'pending',
  'unpaid',
])

/** Contextual primary actions for a row, driven by its current status. */
function smartActionsFor(
  status: InvoiceStatus,
): ReadonlyArray<{ to: InvoiceStatus; label: string }> {
  switch (status) {
    case 'draft':
    case 'pending':
      return [
        { to: 'unpaid', label: 'Issue invoice' },
        { to: 'paid', label: 'Mark as paid' },
      ]
    case 'unpaid':
      return [{ to: 'paid', label: 'Mark as paid' }]
    case 'paid':
      return [{ to: 'unpaid', label: 'Reopen as unpaid' }]
    case 'void':
      return [{ to: 'draft', label: 'Restore to draft' }]
  }
}

/** Does an invoice belong in the given filter bucket? */
function matchesFilter(
  invoice: InvoiceListItem,
  filter: StatusFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'overdue') return invoice.overdue
  return invoice.status === filter
}

function BillsPage() {
  const { status } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const { data: invoices } = useSuspenseQuery(invoicesQueryOptions)
  const { data: summary } = useSuspenseQuery(billsSummaryQueryOptions)

  const [dialogOpen, setDialogOpen] = useState(false)
  // The invoice being edited (null → edit dialog closed).
  const [editTarget, setEditTarget] = useState<InvoiceListItem | null>(null)
  // The invoice pending void confirmation (null → confirm dialog closed).
  const [voidTarget, setVoidTarget] = useState<InvoiceListItem | null>(null)

  // Tracks which invoice's status update is in flight so we can disable that
  // row's actions without blocking the rest of the table.
  const [pendingId, setPendingId] = useState<string | null>(null)

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: InvoiceStatus }) =>
      updateInvoiceStatus({ data: vars }),
    onMutate: (vars) => setPendingId(vars.id),
    onSuccess: (_row, vars) => {
      toast.success(
        vars.status === 'void'
          ? 'Invoice voided'
          : `Marked ${statusLabels[vars.status]}`,
      )
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update invoice',
      )
    },
    onSettled: () => setPendingId(null),
  })

  const filtered = invoices.filter((inv) => matchesFilter(inv, status))
  // Paginate the filtered set; switching the status tab resets to page 1.
  const pagination = usePagination(filtered, { resetKey: status })

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">
            Invoices &amp; receivables
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          New invoice
        </Button>
      </div>

      {/* Summary cards — reuse the dashboard's getBillsSummary numbers. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Outstanding A/R"
          amount={summary.outstanding.amount}
          subtitle={`${summary.outstanding.count} ${
            summary.outstanding.count === 1 ? 'invoice' : 'invoices'
          }`}
        />
        <SummaryCard
          label="Unbilled WIP"
          amount={summary.wip.amount}
          subtitle={`${summary.wip.count} ${
            summary.wip.count === 1 ? 'entry' : 'entries'
          }`}
        />
        <SummaryCard
          label="Overdue"
          amount={summary.overdue.amount}
          subtitle={`${summary.overdue.count} ${
            summary.overdue.count === 1 ? 'invoice' : 'invoices'
          }`}
          danger
        />
        <SummaryCard
          label="Draft"
          amount={summary.drafts
            .reduce((sum, d) => sum + Number(d.total), 0)
            .toFixed(2)}
          subtitle={`${summary.draftCount} ${
            summary.draftCount === 1 ? 'invoice' : 'invoices'
          }`}
        />
      </div>

      {/* Status filter bound to the ?status= search param so links work. */}
      <div className="mb-4">
        <Tabs
          value={status}
          onValueChange={(value) =>
            navigate({
              search: { status: value as StatusFilter },
            })
          }
        >
          <TabsList className="max-w-full overflow-x-auto">
            {statusFilters.map((s) => (
              <TabsTrigger key={s} value={s}>
                {statusFilterLabels[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm font-medium">No invoices yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create an invoice to bill a client for work in progress and start
            tracking receivables.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New invoice
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Matter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="w-0 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No {statusFilterLabels[status].toLowerCase()} invoices.
                  </TableCell>
                </TableRow>
              ) : (
                pagination.pageItems.map((invoice) => {
                  const badge = statusBadge(invoice.status)
                  const busy = pendingId === invoice.id
                  const smart = smartActionsFor(invoice.status)
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">
                        {invoice.number}
                      </TableCell>
                      <TableCell>
                        {invoice.clientName ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {invoice.matterName ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {invoice.overdue ? (
                            <Badge variant="destructive">Overdue</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatAmount(invoice.total)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(invoice.issuedAt)}
                      </TableCell>
                      <TableCell
                        className={
                          invoice.overdue
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground'
                        }
                      >
                        {formatDate(invoice.dueAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Quick action for the common case: settle a bill. */}
                          {payableStatuses.has(invoice.status) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={busy}
                              onClick={() =>
                                statusMutation.mutate({
                                  id: invoice.id,
                                  status: 'paid',
                                })
                              }
                            >
                              Mark paid
                            </Button>
                          ) : null}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={busy}
                              >
                                <MoreHorizontal className="size-4" />
                                <span className="sr-only">
                                  Actions for {invoice.number}
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {/* Edit the invoice's details. */}
                              <DropdownMenuItem
                                onSelect={() => setEditTarget(invoice)}
                              >
                                <Pencil className="size-4" />
                                Edit details
                              </DropdownMenuItem>

                              {/* Smart, status-aware next steps. */}
                              <DropdownMenuSeparator />
                              {smart.map((action) => (
                                <DropdownMenuItem
                                  key={action.to}
                                  disabled={busy}
                                  onSelect={() =>
                                    statusMutation.mutate({
                                      id: invoice.id,
                                      status: action.to,
                                    })
                                  }
                                >
                                  {action.label}
                                </DropdownMenuItem>
                              ))}

                              {/* Full manual status control. */}
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  Change status
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {changeableStatuses.map((s) => (
                                    <DropdownMenuItem
                                      key={s}
                                      disabled={s === invoice.status || busy}
                                      onSelect={() =>
                                        statusMutation.mutate({
                                          id: invoice.id,
                                          status: s,
                                        })
                                      }
                                    >
                                      {statusLabels[s]}
                                      {s === invoice.status ? (
                                        <Check className="ml-auto size-4" />
                                      ) : null}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>

                              {/* Destructive: void (confirmed). */}
                              {invoice.status !== 'void' ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={busy}
                                    onSelect={() => setVoidTarget(invoice)}
                                  >
                                    <Ban className="size-4" />
                                    Void invoice
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          {filtered.length > 0 ? (
            <TablePagination
              pagination={pagination}
              itemLabel={['invoice', 'invoices']}
            />
          ) : null}
        </div>
      )}

      <InvoiceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <InvoiceFormDialog
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        invoice={editTarget}
      />

      <Dialog
        open={voidTarget !== null}
        onOpenChange={(o) => {
          if (!o) setVoidTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Void this invoice?</DialogTitle>
            <DialogDescription>
              {voidTarget
                ? `Invoice ${voidTarget.number} will be marked void and drop out of outstanding receivables. You can restore it to draft later.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVoidTarget(null)}
              disabled={voidTarget != null && pendingId === voidTarget.id}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidTarget != null && pendingId === voidTarget.id}
              onClick={() => {
                if (!voidTarget) return
                statusMutation.mutate(
                  { id: voidTarget.id, status: 'void' },
                  { onSuccess: () => setVoidTarget(null) },
                )
              }}
            >
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({
  label,
  amount,
  subtitle,
  danger,
}: {
  label: string
  amount: string
  subtitle: string
  danger?: boolean
}) {
  const value = Number(amount)
  const isDanger = danger && value > 0
  return (
    <Card className="py-4">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold tabular-nums ${
            isDanger ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {currency0.format(value)}
        </p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  )
}
