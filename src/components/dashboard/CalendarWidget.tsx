import { Suspense } from 'react'
import { useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import { CalendarDays, MapPin } from 'lucide-react'

import { listUpcomingEvents } from '@/server/calendar'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { UpcomingEvent } from '@/server/calendar'

import { AddEventDialog } from './AddEventDialog'

// ===========================================================================
// CalendarWidget — upcoming events / deadlines (LIVE data).
//
// Reads REAL `calendar_events` from Postgres via `listUpcomingEvents` (a GET
// createServerFn called with zero args). The query is shared as
// `upcomingEventsQueryOptions` so the dashboard route loader can prefetch it
// for SSR (ensureQueryData); the inner component reads the cache via
// useSuspenseQuery. The header carries an "+ Add" dialog (AddEventDialog) that
// creates events and invalidates ['calendar'].
// ===========================================================================

export const upcomingEventsQueryOptions = queryOptions({
  queryKey: ['calendar', 'upcoming'],
  queryFn: () => listUpcomingEvents(),
})

/** Tailwind classes giving each event type a distinct badge color. */
const eventTypeStyles: Record<UpcomingEvent['eventType'], string> = {
  deposition:
    'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  hearing:
    'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  meeting:
    'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  deadline:
    'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  other:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
}

const eventTypeLabels: Record<UpcomingEvent['eventType'], string> = {
  deposition: 'Deposition',
  hearing: 'Hearing',
  meeting: 'Meeting',
  deadline: 'Deadline',
  other: 'Other',
}

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

/** "9:00 AM" or "9:00 AM – 11:30 AM" when an end time is present. */
function formatTimeRange(startAt: Date, endAt: Date | null): string {
  const start = timeFormatter.format(startAt)
  if (!endAt) return start
  return `${start} – ${timeFormatter.format(endAt)}`
}

function CalendarSkeleton() {
  return (
    <ul className="divide-y">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-6 py-2">
          <div className="size-12 shrink-0 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function CalendarList() {
  const { data: events } = useSuspenseQuery(upcomingEventsQueryOptions)

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <p className="text-sm text-muted-foreground">No upcoming events</p>
        <AddEventDialog />
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {events.map((ev) => {
        const startAt = new Date(ev.startAt)
        const endAt = ev.endAt ? new Date(ev.endAt) : null
        return (
          <li key={ev.id} className="flex items-start gap-3 px-6 py-2">
            <div className="flex w-12 shrink-0 flex-col items-center rounded-md border bg-muted/40 py-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                {dayFormatter.format(startAt)}
              </span>
              <span className="text-sm font-semibold leading-none">
                {startAt.getDate()}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                {monthFormatter.format(startAt)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  className={cn('shrink-0', eventTypeStyles[ev.eventType])}
                >
                  {eventTypeLabels[ev.eventType]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatTimeRange(startAt, endAt)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm font-medium">{ev.title}</p>
              {(ev.matterName || ev.location) && (
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {ev.matterName ? <span>{ev.matterName}</span> : null}
                  {ev.matterName && ev.location ? <span>·</span> : null}
                  {ev.location ? (
                    <span className="flex min-w-0 items-center gap-0.5">
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{ev.location}</span>
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function CalendarWidget() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          Calendar
        </CardTitle>
        <CardDescription>Upcoming deadlines &amp; events</CardDescription>
        <CardAction>
          <AddEventDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarList />
        </Suspense>
      </CardContent>
    </Card>
  )
}
