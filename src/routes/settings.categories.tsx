import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  queryOptions,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'

import {
  listActivityCategories,
  setActivityCategoryArchived,
} from '@/server/activity-categories'
import type { ActivityCategory } from '@/server/activity-categories'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ActivityCategoryFormDialog } from '@/components/categories/ActivityCategoryFormDialog'

// ===========================================================================
// /settings/categories — Activity category management (Clio-style).
//
// Two tabs (Time entry / Expense) over the firm's pre-configured billing items.
// Each row shows the default rate, tax treatment and permission groups, and can
// be edited or archived. The route loader prefetches the list for SSR; the page
// reads the cache with useSuspenseQuery. The dialog and the timer modal reuse
// activityCategoriesQueryKey / activityCategoriesQueryOptions exported below.
// ===========================================================================

export const activityCategoriesQueryKey = ['activity-categories'] as const

export const activityCategoriesQueryOptions = queryOptions({
  queryKey: activityCategoriesQueryKey,
  queryFn: () => listActivityCategories(),
})

export const Route = createFileRoute('/settings/categories')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(activityCategoriesQueryOptions),
  component: CategoriesPage,
})

function formatMoney(rate: string, currency: string): string {
  const value = Number(rate)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(Number.isFinite(value) ? value : 0)
  } catch {
    // Unknown currency code → fall back to the raw amount + code.
    return `${rate} ${currency}`
  }
}

function CategoriesPage() {
  const { data: categories } = useSuspenseQuery(activityCategoriesQueryOptions)
  const [tab, setTab] = useState<'time_entry' | 'expense'>('time_entry')
  const [keyword, setKeyword] = useState('')

  const visible = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return categories
      .filter((c) => c.type === tab)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [categories, tab, keyword])

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to settings
      </Link>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Activity categories
          </h1>
          <p className="text-sm text-muted-foreground">
            Pre-configured billing activities and expenses with default rates —
            picked when logging time and added to bills.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="time_entry">Time entry categories</TabsTrigger>
            <TabsTrigger value="expense">Expense categories</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Filter by keyword"
              className="h-9 w-48"
            />
            <ActivityCategoryFormDialog
              defaultType={tab}
              trigger={
                <Button>
                  <Plus className="size-4" />
                  New
                </Button>
              }
            />
          </div>
        </div>

        <TabsContent value="time_entry">
          <CategoryTable rows={visible} type="time_entry" />
        </TabsContent>
        <TabsContent value="expense">
          <CategoryTable rows={visible} type="expense" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CategoryTable({
  rows,
  type,
}: {
  rows: Array<ActivityCategory>
  type: 'time_entry' | 'expense'
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm font-medium">
          No {type === 'expense' ? 'expense' : 'time entry'} categories
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {type === 'expense'
            ? 'Create reusable expenses (filing fees, copying, mileage) with a default price.'
            : 'Create reusable billing activities with a default hourly rate.'}
        </p>
        <ActivityCategoryFormDialog
          defaultType={type}
          trigger={<Button>New category</Button>}
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">
              {type === 'expense' ? 'Price' : 'Rate'}
            </TableHead>
            <TableHead>Tax</TableHead>
            <TableHead>Permission groups</TableHead>
            <TableHead className="w-0 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} className={c.archived ? 'opacity-60' : ''}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {c.name}
                  {c.archived ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(c.rate, c.currency)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.taxTreatment === 'none' ? 'No tax' : 'Invoice default'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.permissionGroups}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <ActivityCategoryFormDialog
                    category={c}
                    trigger={
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    }
                  />
                  <ArchiveButton category={c} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ArchiveButton({ category }: { category: ActivityCategory }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      setActivityCategoryArchived({
        data: { id: category.id, archived: !category.archived },
      }),
    onSuccess: () => {
      toast.success(
        category.archived ? 'Category restored' : 'Category archived',
      )
      queryClient.invalidateQueries({ queryKey: activityCategoriesQueryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    },
  })

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {category.archived ? 'Restore' : 'Archive'}
    </Button>
  )
}
