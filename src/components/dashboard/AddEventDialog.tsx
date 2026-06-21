import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
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

import { createCalendarEvent } from '@/server/calendar'
import { listMatters } from '@/server/matters'

// ===========================================================================
// AddEventDialog — local create form for the Calendar widget.
//
// react-hook-form + zodResolver → createCalendarEvent server fn. On success it
// toasts, invalidates the ['calendar'] query family, closes and resets. The
// matter <Select> is optional (a sentinel "No matter" maps to null).
// ===========================================================================

// Sentinel option value for "no matter" (Radix Select disallows empty string).
const NO_MATTER = '__none__'

const eventTypeValues = [
  'deposition',
  'hearing',
  'meeting',
  'deadline',
  'other',
] as const

const eventTypeLabels: Record<(typeof eventTypeValues)[number], string> = {
  deposition: 'Deposition',
  hearing: 'Hearing',
  meeting: 'Meeting',
  deadline: 'Deadline',
  other: 'Other',
}

const formSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  eventType: z.enum(eventTypeValues),
  startAt: z.string().min(1, 'Start date & time is required'),
  endAt: z.string(),
  matterId: z.string(), // NO_MATTER sentinel or a uuid
  location: z.string(),
  notes: z.string(),
})

type FormValues = z.infer<typeof formSchema>

const defaultValues: FormValues = {
  title: '',
  eventType: 'meeting',
  startAt: '',
  endAt: '',
  matterId: NO_MATTER,
  location: '',
  notes: '',
}

export function AddEventDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const mattersQuery = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters(),
    enabled: open,
  })
  const matters = mattersQuery.data ?? []

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      createCalendarEvent({
        data: {
          title: values.title,
          eventType: values.eventType,
          startAt: values.startAt,
          endAt: values.endAt ? values.endAt : null,
          matterId: values.matterId === NO_MATTER ? null : values.matterId,
          location: values.location ? values.location : null,
          notes: values.notes ? values.notes : null,
        },
      }),
    onSuccess: () => {
      toast.success('Event added')
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      setOpen(false)
      form.reset(defaultValues)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add event')
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) form.reset(defaultValues)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Add an upcoming deadline, hearing, or meeting to the calendar.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              createMutation.mutate(values),
            )}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Deposition — J. Carver"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {eventTypeValues.map((v) => (
                        <SelectItem key={v} value={v}>
                          {eventTypeLabels[v]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starts</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ends</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Courtroom 4B" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding…' : 'Add event'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
