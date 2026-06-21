import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Pencil, Play, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

import { listTodayEntries, resumeTimer } from '@/server/time-entries'
import type { TimeEntryListItem } from '@/server/time-entries'
import { formatSecondsToClock } from '@/lib/rounding'

import {
  useTimerStore,
  useElapsedSeconds,
  useHasHydrated,
} from '@/stores/timer'
import type { Timer } from '@/stores/timer'
import { useModalStore } from './modal-store'

// ===========================================================================
// TimekeeperPopover — clock-icon button beside the timer (in the header). Opens
// a panel listing TODAY's time entries. For each: matter/narrative, elapsed or
// duration, and a billable badge. Actions:
//   - restart a stopped entry (resumeTimer + store.resume → resumes onto the
//     existing duration),
//   - edit (opens TimeEntryModal prefilled),
//   - create new.
// ===========================================================================

const billableVariant: Record<
  TimeEntryListItem['billable'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  billable: { label: 'Billable', variant: 'default' },
  non_billable: { label: 'Non-billable', variant: 'secondary' },
  no_charge: { label: 'No charge', variant: 'outline' },
}

export function TimekeeperPopover() {
  const queryClient = useQueryClient()
  const openNew = useModalStore((s) => s.openNew)
  const openForEntry = useModalStore((s) => s.openForEntry)

  const todayQuery = useQuery({
    queryKey: ['today-entries'],
    queryFn: () => listTodayEntries(),
  })

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeTimer({ data: { id } }),
    onSuccess: (row) => {
      // Seed/refresh the store timer with the entry's existing duration, then
      // resume — accumulation continues onto durationSeconds.
      const store = useTimerStore.getState()
      store.attach(row.id, {
        matterId: row.matterId ?? null,
        narrative: row.narrative ?? null,
        accumulatedSeconds: row.durationSeconds,
      })
      store.resume(row.id)
      queryClient.invalidateQueries({ queryKey: ['today-entries'] })
      toast.success('Timer resumed')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not resume')
    },
  })

  const entries = todayQuery.data ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Timekeeper">
          <Clock className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3">
          <div className="text-sm font-medium">Today&apos;s time</div>
          <Button
            variant="outline"
            size="xs"
            className="gap-1"
            onClick={() => openNew()}
          >
            <Plus className="size-3" />
            New
          </Button>
        </div>
        <Separator />
        <div className="max-h-80 overflow-y-auto">
          {todayQuery.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No time tracked today yet.
            </div>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <TimekeeperRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => openForEntry(entry.id)}
                  onResume={() => resumeMutation.mutate(entry.id)}
                  resuming={resumeMutation.isPending}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimekeeperRow({
  entry,
  onEdit,
  onResume,
  resuming,
}: {
  entry: TimeEntryListItem
  onEdit: () => void
  onResume: () => void
  resuming: boolean
}) {
  const hydrated = useHasHydrated()
  // Live elapsed from the store if this entry has an active timer object,
  // otherwise fall back to the persisted DB duration.
  const timer = useTimerStore((s): Timer | undefined =>
    hydrated ? s.timers[entry.id] : undefined,
  )
  const hasTimer = !!timer
  const liveElapsed = useElapsedSeconds(hasTimer ? entry.id : null)
  const isRunning = timer?.running ?? false

  const seconds = hasTimer ? liveElapsed : entry.durationSeconds
  const badge = billableVariant[entry.billable]

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {entry.matterName ?? 'No matter'}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {entry.narrative || entry.activity || 'No description'}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums">
            {formatSecondsToClock(seconds)}
          </span>
          <Badge variant={badge.variant} className="text-[10px]">
            {badge.label}
          </Badge>
          {isRunning ? (
            <Badge variant="default" className="text-[10px]">
              Running
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Restart timer"
          disabled={resuming || isRunning}
          onClick={onResume}
        >
          <Play className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit entry"
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    </li>
  )
}
