import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'

import { listClients } from '@/server/clients'
import { Button } from '@/components/ui/button'
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
import { ClientFormDialog } from '@/components/clients/ClientFormDialog'

// ===========================================================================
// /clients — client management (PHASE 3 UI).
//
// Lists every firm client (listClients → name + linked matter count) and lets
// staff create new clients or rename existing ones via ClientFormDialog. The
// route loader prefetches the list for SSR; the page reads the cache with
// useSuspenseQuery. The integration agent reuses clientsQueryOptions /
// clientsQueryKey, both exported below.
// ===========================================================================

export const clientsQueryKey = ['clients'] as const

export const clientsQueryOptions = queryOptions({
  queryKey: clientsQueryKey,
  queryFn: () => listClients(),
})

export const Route = createFileRoute('/clients')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(clientsQueryOptions),
  component: ClientsPage,
})

function ClientsPage() {
  const { data: clients } = useSuspenseQuery(clientsQueryOptions)
  const pagination = usePagination(clients)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {clients.length} client{clients.length === 1 ? '' : 's'} · the
            foundational records matters and time are billed against
          </p>
        </div>
        <ClientFormDialog trigger={<Button>New client</Button>} />
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm font-medium">No clients yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Clients are the top of the hierarchy — create one to start opening
            matters and tracking billable time.
          </p>
          <ClientFormDialog trigger={<Button>New client</Button>} />
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right"># Matters</TableHead>
                <TableHead className="w-0 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {client.matterCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <ClientFormDialog
                      client={client}
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
          <TablePagination
            pagination={pagination}
            itemLabel={['client', 'clients']}
          />
        </div>
      )}
    </div>
  )
}
