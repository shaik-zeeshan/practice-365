import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

import { listMatters, getFirmConfig } from '@/server/matters'
import { listTodayEntries, saveTimeEntry } from '@/server/time-entries'
import { activityCategoriesQueryOptions } from '@/routes/settings.categories'
import { computeAmount } from '@/lib/services/billing'
import { parseDurationToSeconds } from '@/lib/rounding'

import { useModalStore } from './modal-store'
import { useTimerStore, elapsedSecondsOf } from '@/stores/timer'

// Sentinel option value for "no matter" (Radix Select disallows empty string).
const NO_MATTER = '__none__'
// Sentinel for "no activity category" (Radix Select disallows empty string).
const NO_ACTIVITY = '__no_activity__'

const billableValues = ['billable', 'non_billable', 'no_charge'] as const

const formSchema = z
  .object({
    date: z.string().min(1, 'Date is required'),
    matterId: z.string(), // NO_MATTER sentinel or a uuid
    activity: z.string(),
    narrative: z.string(),
    billable: z.enum(billableValues),
    rate: z.string(),
    // Free-text duration: hours:minutes ("1:30") or decimal hours ("1.5");
    // validated to parse into seconds.
    duration: z.string().refine((v) => parseDurationToSeconds(v) !== null, {
      message: 'Enter h:mm (e.g. 1:30) or decimal hours (e.g. 1.5)',
    }),
  })
  // A billable entry must be tied to a matter — otherwise there is nothing to
  // bill it against. (Non-billable / no-charge entries may stand alone.)
  .superRefine((val, ctx) => {
    if (val.billable === 'billable' && val.matterId === NO_MATTER) {
      ctx.addIssue({
        code: 'custom',
        path: ['matterId'],
        message: 'A matter is required to bill this entry.',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

const billableLabels: Record<(typeof billableValues)[number], string> = {
  billable: 'Billable',
  non_billable: 'Non-billable',
  no_charge: 'No charge',
}

function todayInputValue(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateToInputValue(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return todayInputValue()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function TimeEntryModal() {
  const open = useModalStore((s) => s.open)
  const entryId = useModalStore((s) => s.entryId)
  const fromTimer = useModalStore((s) => s.fromTimer)
  const fromPause = useModalStore((s) => s.fromPause)
  const close = useModalStore((s) => s.close)

  const queryClient = useQueryClient()

  const mattersQuery = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters(),
    enabled: open,
  })
  const firmConfigQuery = useQuery({
    queryKey: ['firm-config'],
    queryFn: () => getFirmConfig(),
    enabled: open,
  })
  const todayQuery = useQuery({
    queryKey: ['today-entries'],
    queryFn: () => listTodayEntries(),
    enabled: open && !!entryId,
  })
  const categoriesQuery = useQuery({
    ...activityCategoriesQueryOptions,
    enabled: open,
  })

  const matters = mattersQuery.data ?? []
  const minuteIncrement = firmConfigQuery.data?.minuteIncrement ?? 6
  // Time-entry activity categories the user can pick (expense + archived hidden).
  const activityCategories = useMemo(
    () =>
      (categoriesQuery.data ?? []).filter(
        (c) => c.type === 'time_entry' && !c.archived,
      ),
    [categoriesQuery.data],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: todayInputValue(),
      matterId: NO_MATTER,
      activity: '',
      narrative: '',
      billable: 'billable',
      rate: '',
      duration: '0:00:00',
    },
  })

  const { reset } = form

  // Seed the form whenever the modal opens (or its target entry/data changes).
  useEffect(() => {
    if (!open) return

    // Existing DB entry → prefill from today's list (popover edit / timer review).
    const existing = entryId
      ? todayQuery.data?.find((e) => e.id === entryId)
      : undefined

    // Live timer elapsed (used when reviewing a just-stopped timer).
    const timer = entryId ? useTimerStore.getState().timers[entryId] : undefined
    const timerSeconds = timer ? elapsedSecondsOf(timer, Date.now()) : 0

    const durationSeconds = fromTimer
      ? timerSeconds || existing?.durationSeconds || 0
      : (existing?.durationSeconds ?? 0)

    reset({
      date: existing?.date
        ? dateToInputValue(existing.date)
        : todayInputValue(),
      matterId: existing?.matterId ?? timer?.matterId ?? NO_MATTER,
      activity: existing?.activity ?? '',
      narrative: existing?.narrative ?? timer?.narrative ?? '',
      billable: existing?.billable ?? 'billable',
      rate: existing?.rate ?? '',
      duration: formSecondsToDuration(durationSeconds),
    })
  }, [open, entryId, fromTimer, todayQuery.data, reset])

  // Auto-fill the rate from the selected matter when the user hasn't typed one.
  const watchedMatterId = form.watch('matterId')
  useEffect(() => {
    if (!open) return
    if (watchedMatterId === NO_MATTER) return
    const matter = matters.find((m) => m.id === watchedMatterId)
    const currentRate = form.getValues('rate')
    if (matter?.rate && !currentRate) {
      form.setValue('rate', matter.rate)
    }
  }, [watchedMatterId, matters, open, form])

  // Derived, read-only amount (rounded billed hours × rate, firm increment).
  const watchedDuration = form.watch('duration')
  const watchedRate = form.watch('rate')
  const derived = useMemo(() => {
    const seconds = parseDurationToSeconds(watchedDuration) ?? 0
    return computeAmount({
      durationSeconds: seconds,
      minuteIncrement,
      rate: watchedRate || null,
    })
  }, [watchedDuration, watchedRate, minuteIncrement])

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const durationSeconds = parseDurationToSeconds(values.duration) ?? 0
      // Resolve the structured category id from the picked name (legacy
      // free-text activities have no match → null).
      const category = activityCategories.find(
        (c) => c.name === values.activity,
      )
      return saveTimeEntry({
        data: {
          id: entryId,
          matterId: values.matterId === NO_MATTER ? null : values.matterId,
          narrative: values.narrative || null,
          activity: values.activity || null,
          activityCategoryId: category?.id ?? null,
          billable: values.billable,
          rate: values.rate || null,
          durationSeconds,
        },
      })
    },
    onSuccess: () => {
      toast.success(entryId ? 'Time entry updated' : 'Time entry saved')
      queryClient.invalidateQueries({ queryKey: ['today-entries'] })
      queryClient.invalidateQueries({ queryKey: ['time-entries'] })
      // Time entries drive the personal + firm dashboards (utilization /
      // realization), so refresh them too — otherwise those charts go stale.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // Drop the timer object for this entry — it is now persisted WIP.
      if (entryId) useTimerStore.getState().clear(entryId)
      close()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save time entry',
      )
    },
  })

  const billableForBillable = form.watch('billable') === 'billable'
  const hasMatter = watchedMatterId !== NO_MATTER
  // Once a submit attempt flags the missing matter, FormMessage shows the error;
  // suppress the proactive hint then so the same text isn't shown twice.
  const matterError = form.formState.errors.matterId

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fromPause
              ? 'Timer paused'
              : entryId
                ? 'Edit time entry'
                : 'New time entry'}
          </DialogTitle>
          <DialogDescription>
            {fromPause
              ? 'Resume to keep tracking, or review and save this entry.'
              : 'Track time against a matter. Saved entries are unbilled WIP.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              saveMutation.mutate(values),
            )}
            className="grid gap-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="duration"
                render={({ field }) => <DurationField field={field} />}
              />
            </div>

            <FormField
              control={form.control}
              name="matterId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Matter</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a matter" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_MATTER}>No matter</SelectItem>
                      {matters.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          {m.clientName ? ` — ${m.clientName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {billableForBillable && !hasMatter && !matterError ? (
                    <FormDescription className="text-destructive">
                      A matter is required to bill this entry.
                    </FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="narrative"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Narrative</FormLabel>
                  <FormControl>
                    <Input placeholder="What did you work on?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="activity"
                render={({ field }) => {
                  // Preserve a legacy free-text activity that is not (or no
                  // longer) a category, so editing an old entry still shows it.
                  const isLegacy =
                    !!field.value &&
                    !activityCategories.some((c) => c.name === field.value)
                  return (
                    <FormItem>
                      <FormLabel>Activity</FormLabel>
                      <Select
                        value={field.value ? field.value : NO_ACTIVITY}
                        onValueChange={(v) => {
                          const next = v === NO_ACTIVITY ? '' : v
                          field.onChange(next)
                          // Auto-fill the rate from the category when the user
                          // hasn't already entered one (mirrors matter rate).
                          const cat = activityCategories.find(
                            (c) => c.name === next,
                          )
                          if (cat && cat.rate && !form.getValues('rate')) {
                            form.setValue('rate', cat.rate)
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select activity" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NO_ACTIVITY}>
                            No activity
                          </SelectItem>
                          {activityCategories.map((c) => (
                            <SelectItem key={c.id} value={c.name}>
                              {c.name}
                            </SelectItem>
                          ))}
                          {isLegacy ? (
                            <SelectItem value={field.value}>
                              {field.value}
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />

              <FormField
                control={form.control}
                name="billable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billable</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {billableValues.map((v) => (
                          <SelectItem key={v} value={v}>
                            {billableLabels[v]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate (per hour)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Defaults from matter / user"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Amount{' '}
                <span className="text-xs">
                  ({derived.billedHours.toFixed(2)} billed h ×{' '}
                  {watchedRate || '0'})
                </span>
              </span>
              <span className="text-lg font-semibold tabular-nums">
                ${derived.amount}
              </span>
            </div>

            <DialogFooter>
              {fromPause && entryId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    useTimerStore.getState().resume(entryId)
                    close()
                  }}
                  disabled={saveMutation.isPending}
                >
                  Resume timer
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={close}
                  disabled={saveMutation.isPending}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save entry'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// One labeled segment of the Duration input (e.g. the "m" box).
function DurationSegment({
  label,
  unit,
  value,
  onChange,
  onBlur,
}: {
  label: string
  unit: string
  value: string
  onChange: (next: string) => void
  onBlur: () => void
}) {
  return (
    <div className="relative flex-1">
      <Input
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="pr-6 text-right tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">
        {unit}
      </span>
    </div>
  )
}

/**
 * Duration entry as three explicit, labeled segments: "[h] h  [m] m  [s] s".
 *
 * The old single free-text field rendered a clock-style "0:01" that was
 * ambiguous (one minute? one second?) and forced users to know an h:mm /
 * decimal format. Three labeled boxes make the value unambiguous by
 * construction and let the user see/edit the exact seconds the timer tracked.
 * The canonical `field.value` is a normalized "h:mm:ss" string, so the form's
 * parse/validate/save path is unchanged — this is purely the input surface.
 */
function DurationField({
  field,
}: {
  field: {
    value: string
    onChange: (next: string) => void
    onBlur: () => void
  }
}) {
  const seconds = parseDurationToSeconds(field.value) ?? 0
  const seededHours = Math.floor(seconds / 3600)
  const seededMinutes = Math.floor((seconds % 3600) / 60)
  const seededSeconds = seconds % 60

  // Local input strings so a segment can sit empty mid-edit ("" not "0")
  // without fighting the user; canonical "h:mm:ss" is emitted on each keystroke.
  const [hours, setHours] = useState(String(seededHours))
  const [minutes, setMinutes] = useState(String(seededMinutes))
  const [secs, setSecs] = useState(String(seededSeconds))

  // Re-seed the segments only when the canonical value changes from OUTSIDE
  // (modal re-opened on a different entry, form reset) — never mid-edit, when
  // our own emit already composed the incoming value.
  useEffect(() => {
    const localSeconds =
      Math.floor(Number(hours) || 0) * 3600 +
      Math.floor(Number(minutes) || 0) * 60 +
      Math.floor(Number(secs) || 0)
    if (localSeconds !== seconds) {
      setHours(String(seededHours))
      setMinutes(String(seededMinutes))
      setSecs(String(seededSeconds))
    }
  }, [field.value])

  // Compose canonical "h:mm:ss", rolling overflow up (e.g. 90s → 1m 30s) so the
  // stored value is always a valid clock-style duration.
  function emit(nextHours: string, nextMinutes: string, nextSecs: string) {
    const total =
      Math.max(0, Math.floor(Number(nextHours) || 0)) * 3600 +
      Math.max(0, Math.floor(Number(nextMinutes) || 0)) * 60 +
      Math.max(0, Math.floor(Number(nextSecs) || 0))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (n: number) => n.toString().padStart(2, '0')
    field.onChange(`${h}:${pad(m)}:${pad(s)}`)
  }

  // Snap the visible segments back to the normalized value (e.g. "90" s → 1 m 30 s).
  function handleBlur() {
    setHours(String(seededHours))
    setMinutes(String(seededMinutes))
    setSecs(String(seededSeconds))
    field.onBlur()
  }

  return (
    <FormItem>
      <FormLabel>Duration</FormLabel>
      <FormControl>
        <div className="flex items-stretch gap-1.5">
          <DurationSegment
            label="Hours"
            unit="h"
            value={hours}
            onChange={(v) => {
              setHours(v)
              emit(v, minutes, secs)
            }}
            onBlur={handleBlur}
          />
          <DurationSegment
            label="Minutes"
            unit="m"
            value={minutes}
            onChange={(v) => {
              setMinutes(v)
              emit(hours, v, secs)
            }}
            onBlur={handleBlur}
          />
          <DurationSegment
            label="Seconds"
            unit="s"
            value={secs}
            onChange={(v) => {
              setSecs(v)
              emit(hours, minutes, v)
            }}
            onBlur={handleBlur}
          />
        </div>
      </FormControl>
      <FormMessage />
    </FormItem>
  )
}

/**
 * Seed the Duration field from raw seconds as "h:mm:ss" — the same shape the
 * segmented field emits, so it round-trips cleanly with parseDurationToSeconds.
 * Seconds are preserved (no minute flooring), so a short session (e.g. 12s)
 * seeds "0:00:12" and bills accurately rather than collapsing to zero.
 */
function formSecondsToDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}
