import { create } from 'zustand'

// ===========================================================================
// TimeEntryModal control store.
//
// The modal is mounted ONCE in __root.tsx so it is globally available from the
// header timer, the timekeeper popover, and anywhere else. Opening it is just a
// matter of setting this store's state. It is NOT persisted (transient UI).
//
// `entryId` is the DB time_entries.id to load/save against:
//   - set when reviewing a stopped timer or editing a today entry,
//   - undefined for a fresh manual entry (saveTimeEntry will insert).
// ===========================================================================

export interface TimeEntryModalState {
  open: boolean
  /** DB entry id being edited/reviewed; undefined → new manual entry. */
  entryId?: string
  /** When true the modal seeds quantity from the timer's live elapsed. */
  fromTimer: boolean
  /**
   * When true the modal was opened by PAUSING a running timer. The footer then
   * offers "Resume timer" (continue tracking) alongside "Save entry".
   */
  fromPause: boolean

  /** Open for a fresh manual entry. */
  openNew: () => void
  /** Open to review/edit a specific DB entry. */
  openForEntry: (
    entryId: string,
    opts?: { fromTimer?: boolean; fromPause?: boolean },
  ) => void
  /** Close the modal. */
  close: () => void
}

export const useModalStore = create<TimeEntryModalState>()((set) => ({
  open: false,
  entryId: undefined,
  fromTimer: false,
  fromPause: false,

  openNew: () =>
    set({ open: true, entryId: undefined, fromTimer: false, fromPause: false }),
  openForEntry: (entryId, opts) =>
    set({
      open: true,
      entryId,
      fromTimer: opts?.fromTimer ?? false,
      fromPause: opts?.fromPause ?? false,
    }),
  close: () => set({ open: false, fromPause: false }),
}))
