import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PAGE_SIZE_OPTIONS } from '@/hooks/use-pagination'

// ===========================================================================
// TablePagination — the controls that sit under a paginated <Table>.
//
// Presentational only: it renders the "X–Y of Z" range, a rows-per-page select
// and first/prev/next/last navigation, driving the state owned by
// usePagination. Spread the hook result into `pagination` and pass an itemLabel
// for the count noun, e.g. itemLabel={['client', 'clients']}.
// ===========================================================================

interface TablePaginationProps {
  pagination: {
    page: number
    pageSize: number
    pageCount: number
    totalItems: number
    rangeStart: number
    rangeEnd: number
    canPreviousPage: boolean
    canNextPage: boolean
    setPage: (page: number) => void
    setPageSize: (size: number) => void
    previousPage: () => void
    nextPage: () => void
  }
  /** Singular/plural noun for the row count, e.g. ['matter', 'matters']. */
  itemLabel?: [string, string]
  pageSizeOptions?: ReadonlyArray<number>
  className?: string
}

export function TablePagination({
  pagination,
  itemLabel = ['item', 'items'],
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: TablePaginationProps) {
  const {
    page,
    pageSize,
    pageCount,
    totalItems,
    rangeStart,
    rangeEnd,
    canPreviousPage,
    canNextPage,
    setPage,
    setPageSize,
    previousPage,
    nextPage,
  } = pagination

  const noun = totalItems === 1 ? itemLabel[0] : itemLabel[1]

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t px-4 py-3 text-sm',
        className,
      )}
    >
      <p className="text-muted-foreground tabular-nums">
        {totalItems === 0
          ? `No ${itemLabel[1]}`
          : `Showing ${rangeStart}–${rangeEnd} of ${totalItems} ${noun}`}
      </p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-[4.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground tabular-nums">
          Page {page} of {pageCount}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage(1)}
            disabled={!canPreviousPage}
          >
            <ChevronsLeft className="size-4" />
            <span className="sr-only">First page</span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={previousPage}
            disabled={!canPreviousPage}
          >
            <ChevronLeft className="size-4" />
            <span className="sr-only">Previous page</span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={nextPage}
            disabled={!canNextPage}
          >
            <ChevronRight className="size-4" />
            <span className="sr-only">Next page</span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage(pageCount)}
            disabled={!canNextPage}
          >
            <ChevronsRight className="size-4" />
            <span className="sr-only">Last page</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
