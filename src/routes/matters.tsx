import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'

import { listFirmUsers } from '@/server/matters'
import { listClients } from '@/server/clients'
import { listMattersAdmin } from '@/server/matters-admin'
import type { MatterAdminListItem } from '@/server/matters-admin'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { clientsQueryOptions } from '@/routes/clients'
import { MatterFormDialog } from '@/components/matters/MatterFormDialog'

// ===========================================================================
// /matters — matter management (PHASE 3 UI).
//
// Lists every firm matter (client, responsible attorney, status, rate) and lets
// staff open new matters or edit existing ones via MatterFormDialog. The route
// loader prefetches the matters list for SSR and also warms the clients +
// firm-users queries the form's selects need. The page reads the cache with
// useSuspenseQuery.
//
// Query keys (exported for the integration agent):
//   ['matters']            → the canonical matter list (shared with the modal)
//   ['matters','admin']    → the richer management read model used by this page
//   ['firm-users']         → responsible-attorney select options
// Invalidating ['matters'] (prefix) refreshes BOTH lists.
// ===========================================================================

/** Re-export so the form component / integration agent share one row type. */
export type MatterListItem = MatterAdminListItem

// Prefix key shared with the modal's listMatters() cache — invalidating this
// (as the form does) refreshes the modal list AND this page's admin list.
export const mattersQueryKey = ['matters'] as const

// The management read model lives under the ['matters'] prefix so a single
// invalidate(['matters']) refreshes it too.
export const mattersQueryOptions = queryOptions({
  queryKey: [...mattersQueryKey, 'admin'] as const,
  queryFn: () => listMattersAdmin(),
})

export const firmUsersQueryOptions = queryOptions({
  queryKey: ['firm-users'],
  queryFn: () => listFirmUsers(),
})

export const Route = createFileRoute('/matters')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(mattersQueryOptions),
      // Warm the form selects so opening the dialog is instant.
      context.queryClient.ensureQueryData({
        ...clientsQueryOptions,
        queryFn: () => listClients(),
      }),
      context.queryClient.ensureQueryData(firmUsersQueryOptions),
    ]),
  component: MattersPage,
})

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format a numeric-string rate ("250.00") as currency, or "—" when unset. */
function formatRate(rate: string | null): string {
  if (rate == null || rate.trim() === '') return '—'
  return currency.format(Number(rate)) + '/h'
}

function MattersPage() {
  const { data: matters } = useSuspenseQuery(mattersQueryOptions)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matters</h1>
          <p className="text-sm text-muted-foreground">
            {matters.length} matter{matters.length === 1 ? '' : 's'} · work is
            tracked and billed against these
          </p>
        </div>
        <MatterFormDialog trigger={<Button>New matter</Button>} />
      </div>

      {matters.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm font-medium">No matters yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Open a matter under a client to start tracking time and billing
            work. You&apos;ll need at least one client first.
          </p>
          <MatterFormDialog trigger={<Button>New matter</Button>} />
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Responsible attorney</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="w-0 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matters.map((matter) => (
                <TableRow key={matter.id}>
                  <TableCell className="font-medium">{matter.name}</TableCell>
                  <TableCell>
                    {matter.clientName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {matter.responsibleAttorneyName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        matter.status === 'active' ? 'default' : 'secondary'
                      }
                    >
                      {matter.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(matter.rate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <MatterFormDialog
                      matter={matter}
                      trigger={
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
