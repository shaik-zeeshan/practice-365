import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Square } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { startTimer, stopTimer } from '@/server/time-entries'
import { formatSecondsToClock } from '@/lib/rounding'

import {
  useTimerStore,
  useActiveTimer,
  useElapsedSeconds,
  useHasHydrated,
  useTimerHeartbeat,
  elapsedSecondsOf,
} from '@/stores/timer'
import { useModalStore } from './modal-store'

// ===========================================================================
// GlobalTimer — play/pause control + live HH:MM:SS for the active timer.
//
// Lives in the header (mounted in __root.tsx) so it persists across navigation;
// state persists across reload via the Zustand `persist` store. SSR-safe: until
// the store rehydrates on the client we render a stable placeholder so the
// server HTML and first client render match.
//
// Start: when no timer is active, the play button creates a running DB row
// (startTimer) and stores the returned id in the store — it just starts ticking,
// no modal. Pause folds the live segment into the store (keeps the DB row
// running so it can resume) and opens the modal to prompt: resume the timer or
// save the entry. Stop calls stopTimer with the accumulated seconds and opens
// the modal to review/save.
// ===========================================================================

export function GlobalTimer() {
  const hydrated = useHasHydrated()
  const queryClient = useQueryClient()

  // Heartbeat: re-renders every second while any timer runs.
  useTimerHeartbeat()

  const activeTimer = useActiveTimer()
  const activeEntryId = useTimerStore((s) => s.activeEntryId)
  const elapsed = useElapsedSeconds(activeEntryId)

  const startNew = useTimerStore((s) => s.startNew)
  const pause = useTimerStore((s) => s.pause)

  const openForEntry = useModalStore((s) => s.openForEntry)

  const startMutation = useMutation({
    mutationFn: () => startTimer({ data: {} }),
    onSuccess: (row) => {
      startNew(row.id, {
        matterId: row.matterId ?? null,
        narrative: row.narrative ?? null,
        accumulatedSeconds: 0,
      })
      queryClient.invalidateQueries({ queryKey: ['today-entries'] })
      toast.success('Timer started')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not start timer')
    },
  })

  const stopMutation = useMutation({
    mutationFn: (vars: { id: string; accumulatedSeconds: number }) =>
      stopTimer({
        data: { id: vars.id, accumulatedSeconds: vars.accumulatedSeconds },
      }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ['today-entries'] })
      queryClient.invalidateQueries({ queryKey: ['time-entries'] })
      // Stopped time is now persisted, so the dashboards (personal + firm
      // utilization/realization) need to refetch to reflect it.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Timer stopped — review & save')
      openForEntry(row.id, { fromTimer: true })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not stop timer')
    },
  })

  // Pre-hydration / SSR placeholder: stable markup, no store reads rendered.
  if (!hydrated) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled className="gap-2">
          <Play className="size-4" />
          <span className="font-mono tabular-nums">00:00:00</span>
        </Button>
      </div>
    )
  }

  const isRunning = activeTimer?.running ?? false

  // No active timer → single play button that starts from anywhere.
  if (!activeTimer) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            <Play className="size-4" />
            <span className="font-mono tabular-nums">00:00:00</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Start a timer</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isRunning ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
            onClick={() => {
              if (isRunning) {
                // Fold the live segment, then prompt: resume or save the entry.
                pause(activeTimer.entryId)
                openForEntry(activeTimer.entryId, {
                  fromTimer: true,
                  fromPause: true,
                })
              } else {
                useTimerStore.getState().resume(activeTimer.entryId)
              }
            }}
          >
            {isRunning ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            <span className="font-mono tabular-nums">
              {formatSecondsToClock(elapsed)}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isRunning ? 'Pause timer' : 'Resume timer'}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={stopMutation.isPending}
            onClick={() => {
              const state = useTimerStore.getState()
              const timer = state.timers[activeTimer.entryId]
              const seconds = elapsedSecondsOf(timer, Date.now())
              // Fold the live segment so the store reflects the stopped total.
              state.pause(activeTimer.entryId)
              stopMutation.mutate({
                id: activeTimer.entryId,
                accumulatedSeconds: seconds,
              })
            }}
          >
            <Square className="size-4" />
            <span className="sr-only">Stop timer</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop &amp; save</TooltipContent>
      </Tooltip>
    </div>
  )
}
