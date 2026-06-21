import { Suspense } from 'react'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckSquare,
  Clock,
  FileText,
  Landmark,
  Rss,
} from 'lucide-react'

import { getFirmFeed } from '@/server/feed'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { FeedItem } from '@/server/feed'
import type { LucideIcon } from 'lucide-react'

// ===========================================================================
// FirmFeedWidget — recent firm-wide activity feed.
//
// REAL data: the feed is DERIVED server-side from recent rows across several
// source tables (time entries, invoices, completed tasks, calendar events,
// trust txns) by the `getFirmFeed` server fn — there is no feed table and no
// create form. The query is shared as `firmFeedQueryOptions` so the dashboard
// route loader can prefetch it for SSR (ensureQueryData) while this component
// reads the cache via useSuspenseQuery (wrapped in <Suspense>).
// ===========================================================================

export const firmFeedQueryOptions = queryOptions({
  queryKey: ['feed'],
  queryFn: () => getFirmFeed(),
})

/** Small per-kind icon, defaulting to the generic feed glyph. */
function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case 'time_entry':
      return Clock
    case 'invoice':
      return FileText
    case 'task':
      return CheckSquare
    case 'event':
      return CalendarClock
    case 'trust':
      return Landmark
    default:
      return Rss
  }
}

/**
 * Compact relative time, e.g. "just now", "5m ago", "2h ago", "3d ago".
 * No existing helper in the repo (checked src/lib), so kept local + tiny.
 */
function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function FirmFeedSkeleton() {
  return (
    <ul className="divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="px-6 py-2">
          <div className="flex items-center gap-2">
            <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  const Icon = kindIcon(item.kind)
  return (
    <li className="flex items-start gap-2 px-6 py-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span>{item.text}</span>
        {(item.actorName || item.matterName) && (
          <p className="truncate text-xs text-muted-foreground">
            {item.actorName && <span>{item.actorName}</span>}
            {item.actorName && item.matterName && <span> · </span>}
            {item.matterName && <span>{item.matterName}</span>}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  )
}

function FirmFeedList() {
  const { data: items } = useSuspenseQuery(firmFeedQueryOptions)

  if (items.length === 0) {
    return (
      <p className="px-6 text-sm text-muted-foreground">
        No recent activity yet
      </p>
    )
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <FeedRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

export function FirmFeedWidget() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="size-4 text-muted-foreground" />
          Firm Feed
        </CardTitle>
        <CardDescription>Recent activity across the firm</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Suspense fallback={<FirmFeedSkeleton />}>
          <FirmFeedList />
        </Suspense>
      </CardContent>
    </Card>
  )
}
