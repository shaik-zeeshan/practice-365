import { useEffect, useMemo, useState } from 'react'

// ===========================================================================
// usePagination — client-side pagination over an already-loaded array.
//
// Every list page in the app fetches its full dataset via useSuspenseQuery and
// (for bills/categories) filters it client-side, so pagination is a pure UI
// concern: slice the array for display while counts/totals keep using the full
// set. The hook clamps the current page when the data shrinks (filtering,
// deletions) so the user is never stranded on an empty page, and resets to
// page 1 when `resetKey` changes (e.g. switching a status tab or typing a
// keyword filter). Pair with <TablePagination> for the controls.
// ===========================================================================

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export interface UsePaginationResult<T> {
  /** Current 1-based page, already clamped to [1, pageCount]. */
  page: number
  pageSize: number
  /** Total number of pages (at least 1, even when there are no items). */
  pageCount: number
  /** The slice of `items` for the current page. */
  pageItems: Array<T>
  totalItems: number
  /** 1-based index of the first row shown (0 when empty). */
  rangeStart: number
  /** 1-based index of the last row shown (0 when empty). */
  rangeEnd: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  canPreviousPage: boolean
  canNextPage: boolean
  previousPage: () => void
  nextPage: () => void
}

export function usePagination<T>(
  items: Array<T>,
  options?: { pageSize?: number; resetKey?: unknown },
): UsePaginationResult<T> {
  const [pageSize, setPageSizeState] = useState(
    options?.pageSize ?? DEFAULT_PAGE_SIZE,
  )
  const [page, setPageState] = useState(1)

  const totalItems = items.length
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize))

  // Derive the page actually rendered so a shrinking dataset never strands the
  // user past the last page, even before the clamping effect below runs.
  const safePage = Math.min(page, pageCount)
  useEffect(() => {
    if (page !== safePage) setPageState(safePage)
  }, [page, safePage])

  // Jump back to the first page whenever the caller's filter signal changes.
  const resetKey = options?.resetKey
  useEffect(() => {
    setPageState(1)
  }, [resetKey])

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, safePage, pageSize])

  const setPage = (next: number) =>
    setPageState(Math.min(Math.max(1, next), pageCount))

  const setPageSize = (size: number) => {
    setPageSizeState(size)
    setPageState(1)
  }

  return {
    page: safePage,
    pageSize,
    pageCount,
    pageItems,
    totalItems,
    rangeStart: totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1,
    rangeEnd: Math.min(safePage * pageSize, totalItems),
    setPage,
    setPageSize,
    canPreviousPage: safePage > 1,
    canNextPage: safePage < pageCount,
    previousPage: () => setPage(safePage - 1),
    nextPage: () => setPage(safePage + 1),
  }
}
