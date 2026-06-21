import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// ===========================================================================
// Global timer store (Zustand, persisted to localStorage). STACK.md §5.
//
// Per §5 a single timer is `{ entryId, startedAt, accumulatedSeconds, running,
// matterId, narrative }`. We support MULTIPLE timers (each time entry is its own
// timer object) by keying timers by entryId in a map plus an `activeEntryId`.
// Pausing one and starting another is allowed; ONLY ONE accumulates at a time
// (resuming/starting a timer pauses whatever was previously running). The header
// surfaces the currently active timer.
//
// RELOAD-SURVIVING LIVE ELAPSED:
//   `startedAt` is an absolute epoch-ms timestamp. The live elapsed for a timer
//   is `accumulatedSeconds + (running ? (Date.now() - startedAt) / 1000 : 0)`.
//   On reload the persisted `running` timer keeps ticking from its persisted
//   `startedAt`, so no elapsed time is lost across a page refresh.
//
// SSR SAFETY:
//   The app SSRs. Reading persisted (localStorage) values during the first
//   client render would mismatch the server-rendered HTML. Components must gate
//   timer-derived rendering behind `useHasHydrated()` (returns false until the
//   persist middleware has rehydrated on the client). `persist` also uses
//   `createJSONStorage(() => localStorage)` guarded so it is a no-op on the
//   server (no `window`).
// ===========================================================================

/** One timer object — one per time entry. */
export interface Timer {
  /** DB time_entries.id this timer is attached to. */
  entryId: string
  /**
   * Absolute epoch-ms timestamp of when the current running segment started.
   * null when the timer is paused. Survives reload so elapsed keeps counting.
   */
  startedAt: number | null
  /** Seconds accumulated from previously-stopped running segments. */
  accumulatedSeconds: number
  /** Whether this timer is currently accumulating. */
  running: boolean
  /** Optional matter the entry is for (mirrors the DB row for quick display). */
  matterId: string | null
  /** Optional narrative (mirrors the DB row). */
  narrative: string | null
}

/** Fields a caller can seed/override when creating or attaching a timer. */
export interface TimerFields {
  matterId?: string | null
  narrative?: string | null
  accumulatedSeconds?: number
}

interface TimerState {
  timers: Record<string, Timer>
  /** entryId of the timer the header surfaces; null when none is active. */
  activeEntryId: string | null

  /**
   * Create a brand-new running timer for a freshly-created DB entry and make it
   * active. Pauses any previously-running timer first (only one accumulates).
   */
  startNew: (entryId: string, fields?: TimerFields) => void
  /**
   * Attach store state to an existing DB entry (e.g. when reviewing/editing).
   * Does NOT start it running; pass `running` via resume() afterwards.
   */
  attach: (entryId: string, fields?: TimerFields) => void
  /** Pause a timer: fold the live segment into accumulatedSeconds, stop. */
  pause: (entryId: string) => void
  /**
   * Resume (or restart) a timer: start a new running segment from now and make
   * it active. Pauses any other running timer first (only one accumulates).
   */
  resume: (entryId: string) => void
  /** Make a timer the active (header-surfaced) one without changing run state. */
  setActive: (entryId: string | null) => void
  /** Patch a timer's mirrored fields (matter/narrative/accumulated). */
  updateFields: (entryId: string, fields: TimerFields) => void
  /** Remove a timer from the store (after it's saved / discarded). */
  clear: (entryId: string) => void
  /**
   * No-op state bump used to force a re-render each tick while running. The live
   * elapsed itself is DERIVED from startedAt, so ticking only needs to nudge
   * subscribers; see `useElapsedSeconds`.
   */
  tick: () => void
  /** Internal heartbeat counter bumped by tick(). */
  _tick: number
}

/**
 * Compute live elapsed seconds for a timer (pure). Reload-safe: uses absolute
 * `startedAt`, so a running timer keeps counting from its persisted start time.
 */
export function elapsedSecondsOf(
  timer: Timer | undefined,
  now: number,
): number {
  if (!timer) return 0
  const live =
    timer.running && timer.startedAt != null
      ? (now - timer.startedAt) / 1000
      : 0
  return Math.max(0, Math.floor(timer.accumulatedSeconds + live))
}

/** Fold a running timer's live segment into accumulatedSeconds and stop it. */
function foldRunningSegment(timer: Timer, now: number): Timer {
  if (!timer.running || timer.startedAt == null) {
    return { ...timer, running: false, startedAt: null }
  }
  const extra = Math.max(0, (now - timer.startedAt) / 1000)
  return {
    ...timer,
    accumulatedSeconds: Math.floor(timer.accumulatedSeconds + extra),
    running: false,
    startedAt: null,
  }
}

/** Pause every currently-running timer (used to enforce single-accumulator). */
function pauseAll(
  timers: Record<string, Timer>,
  now: number,
): Record<string, Timer> {
  const next: Record<string, Timer> = {}
  for (const [id, t] of Object.entries(timers)) {
    next[id] = t.running ? foldRunningSegment(t, now) : t
  }
  return next
}

/**
 * Server-safe storage factory: localStorage on the client, a no-op shim on the
 * server so importing the store during SSR never throws.
 */
const safeStorage = createJSONStorage(() => {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
  }
  return window.localStorage
})

export const useTimerStore = create<TimerState>()(
  persist(
    (set) => ({
      timers: {},
      activeEntryId: null,
      _tick: 0,

      startNew: (entryId, fields) =>
        set((state) => {
          const now = Date.now()
          const timers = pauseAll(state.timers, now)
          timers[entryId] = {
            entryId,
            startedAt: now,
            accumulatedSeconds: fields?.accumulatedSeconds ?? 0,
            running: true,
            matterId: fields?.matterId ?? null,
            narrative: fields?.narrative ?? null,
          }
          return { timers, activeEntryId: entryId }
        }),

      attach: (entryId, fields) =>
        set((state) => {
          const existing: Timer | undefined = state.timers[entryId]
          const timers = { ...state.timers }
          timers[entryId] = {
            entryId,
            startedAt: existing?.startedAt ?? null,
            accumulatedSeconds:
              fields?.accumulatedSeconds ?? existing?.accumulatedSeconds ?? 0,
            running: existing?.running ?? false,
            matterId: fields?.matterId ?? existing?.matterId ?? null,
            narrative: fields?.narrative ?? existing?.narrative ?? null,
          }
          return { timers }
        }),

      pause: (entryId) =>
        set((state) => {
          const timer: Timer | undefined = state.timers[entryId]
          if (!timer) return state
          const now = Date.now()
          return {
            timers: {
              ...state.timers,
              [entryId]: foldRunningSegment(timer, now),
            },
          }
        }),

      resume: (entryId) =>
        set((state) => {
          const timer: Timer | undefined = state.timers[entryId]
          if (!timer) return state
          const now = Date.now()
          const timers = pauseAll(state.timers, now)
          timers[entryId] = {
            ...timers[entryId],
            running: true,
            startedAt: now,
          }
          return { timers, activeEntryId: entryId }
        }),

      setActive: (entryId) => set({ activeEntryId: entryId }),

      updateFields: (entryId, fields) =>
        set((state) => {
          const timer: Timer | undefined = state.timers[entryId]
          if (!timer) return state
          return {
            timers: {
              ...state.timers,
              [entryId]: {
                ...timer,
                ...(fields.matterId !== undefined
                  ? { matterId: fields.matterId }
                  : {}),
                ...(fields.narrative !== undefined
                  ? { narrative: fields.narrative }
                  : {}),
                ...(fields.accumulatedSeconds !== undefined
                  ? { accumulatedSeconds: fields.accumulatedSeconds }
                  : {}),
              },
            },
          }
        }),

      clear: (entryId) =>
        set((state) => {
          const timers = { ...state.timers }
          delete timers[entryId]
          const activeEntryId =
            state.activeEntryId === entryId ? null : state.activeEntryId
          return { timers, activeEntryId }
        }),

      tick: () => set((state) => ({ _tick: state._tick + 1 })),
    }),
    {
      name: 'practice365-timer',
      storage: safeStorage,
      // _tick is a transient render heartbeat — never persist it.
      partialize: (state) => ({
        timers: state.timers,
        activeEntryId: state.activeEntryId,
      }),
    },
  ),
)

// ---------------------------------------------------------------------------
// SSR-safe hydration hook.
//
// `persist` rehydrates from localStorage on the client AFTER the first render.
// Components gate timer-derived UI on this flag so SSR and the first client
// render agree (no hydration mismatch).
// ---------------------------------------------------------------------------

export function useHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    // persist may already be hydrated by the time this effect runs.
    setHydrated(useTimerStore.persist.hasHydrated())
    const unsub = useTimerStore.persist.onFinishHydration(() =>
      setHydrated(true),
    )
    return unsub
  }, [])
  return hydrated
}

// ---------------------------------------------------------------------------
// Convenience selectors / hooks.
// ---------------------------------------------------------------------------

/** The currently active timer object (or undefined). */
export function useActiveTimer(): Timer | undefined {
  return useTimerStore((s) =>
    s.activeEntryId ? s.timers[s.activeEntryId] : undefined,
  )
}

/**
 * Live elapsed seconds for a given entry, re-derived every render. Pair with a
 * 1s interval (see useTimerHeartbeat) so a running timer updates each second.
 */
export function useElapsedSeconds(entryId: string | null | undefined): number {
  // Subscribe to _tick so the value recomputes on each heartbeat.
  useTimerStore((s) => s._tick)
  const timer = useTimerStore((s) => (entryId ? s.timers[entryId] : undefined))
  return elapsedSecondsOf(timer, Date.now())
}

/**
 * Drive a 1-second heartbeat while ANY timer is running. Mount once (e.g. in the
 * header GlobalTimer). Cheap: it only bumps `_tick` to nudge derived selectors.
 */
export function useTimerHeartbeat(): void {
  const anyRunning = useTimerStore((s) =>
    Object.values(s.timers).some((t) => t.running),
  )
  const tick = useTimerStore((s) => s.tick)
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => tick(), 1000)
    return () => clearInterval(id)
  }, [anyRunning, tick])
}
