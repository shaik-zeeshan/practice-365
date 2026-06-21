import { useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import { Activity } from 'lucide-react'

import { listTimeEntries } from '@/server/time-entries'
import { formatSecondsToClock } from '@/lib/rounding'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { TimeEntryListItem } from '@/server/time-entries'

// ===========================================================================
// ActivitiesWidget — the ONE non-mocked dashboard widget.
//
// Reads REAL `time_entries` from Postgres via the `listTimeEntries` server fn
// (a GET createServerFn with no validator → called with zero args). The query
// is shared as `activitiesQueryOptions` so the dashboard route loader can
// prefetch it for SSR (ensureQueryData) and this component reads the cache via
// useSuspenseQuery — no loading flash, real data on first paint.
// ===========================================================================

export const activitiesQueryOptions = queryOptions({
  queryKey: ['time-entries', 'list'],
  queryFn: () => listTimeEntries(),
})

/** Map a billable status to a Badge variant + readable label. */
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

export function ActivitiesWidget() {
  const { data: entries } = useSuspenseQuery(activitiesQueryOptions)

  // Most recent activity first (server already orders date desc); show a slice.
  const recent = entries.slice(0, 6)

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          Activities
        </CardTitle>
        <CardDescription>Recent time entries (live data)</CardDescription>
        <CardAction>
          <Badge variant="outline">Live</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {recent.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No time entries yet.
          </p>
        ) : (
          <ul className="divide-y">
            {recent.map((entry) => {
              const badge = billableBadge(entry.billable)
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 px-6 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {entry.matterName ?? 'No matter'}
                      </span>
                      <Badge variant={badge.variant} className="shrink-0">
                        {badge.label}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.narrative ?? entry.activity ?? 'No description'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.userName ?? 'Unknown'} ·{' '}
                      {entry.clientName ?? 'No client'}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {formatSecondsToClock(entry.durationSeconds)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
