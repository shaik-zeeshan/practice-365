import { Suspense, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { CheckCircle2, Circle, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { createTask, listAgendaTasks, setTaskStatus } from '@/server/tasks'
import { listMatters } from '@/server/matters'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import type { AgendaTask } from '@/server/tasks'

// ===========================================================================
// TodaysAgendaWidget — the current user's tasks ("my agenda").
//
// Reads REAL tasks from Postgres via the `listAgendaTasks` server fn. The query
// is shared as `tasksAgendaQueryOptions` so the dashboard route loader can
// prefetch it for SSR (ensureQueryData) and the inner component reads the cache
// via useSuspenseQuery — no loading flash, real data on first paint.
//
// Each row's checkbox flips the task open/done via `setTaskStatus`; the header
// "+ Add" button opens a local Dialog with a create form (createTask). Both
// mutations invalidate the ['tasks'] prefix to refresh the agenda.
// ===========================================================================

export const tasksAgendaQueryOptions = queryOptions({
  queryKey: ['tasks', 'agenda'],
  queryFn: () => listAgendaTasks(),
})

// Sentinel option value for "no matter" (Radix Select disallows empty string).
const NO_MATTER = '__none__'

const priorityValues = ['low', 'normal', 'high'] as const

const priorityLabels: Record<(typeof priorityValues)[number], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

/** Map a task priority to a Badge variant + readable label. */
function priorityBadge(priority: AgendaTask['priority']) {
  switch (priority) {
    case 'high':
      return { label: 'High', variant: 'destructive' as const }
    case 'normal':
      return { label: 'Normal', variant: 'secondary' as const }
    case 'low':
      return { label: 'Low', variant: 'outline' as const }
  }
}

/**
 * Format a due date relative to today: a bare time ("2:30 PM") when it's today,
 * "Tomorrow" / "Yesterday" for the adjacent days, otherwise a short date.
 */
function formatDueAt(dueAt: Date | string): string {
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt
  if (Number.isNaN(due.getTime())) return ''

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round(
    (startOfDay(due) - startOfDay(new Date())) / dayMs,
  )

  const time = due.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  if (diffDays === 0) return time
  if (diffDays === 1) return `Tomorrow ${time}`
  if (diffDays === -1) return `Yesterday ${time}`
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// --- Create form -----------------------------------------------------------

const formSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  matterId: z.string(), // NO_MATTER sentinel or a uuid
  priority: z.enum(priorityValues),
  dueAt: z.string(),
  notes: z.string(),
})

type FormValues = z.infer<typeof formSchema>

function AddTaskDialog() {
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
    defaultValues: {
      title: '',
      matterId: NO_MATTER,
      priority: 'normal',
      dueAt: '',
      notes: '',
    },
  })

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      createTask({
        data: {
          title: values.title,
          matterId: values.matterId === NO_MATTER ? null : values.matterId,
          priority: values.priority,
          dueAt: values.dueAt || null,
          notes: values.notes || null,
        },
      }),
    onSuccess: () => {
      toast.success('Task added')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setOpen(false)
      form.reset()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add task')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Add a task to your agenda. It is assigned to you.
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
                    <Input placeholder="What needs doing?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {priorityValues.map((v) => (
                          <SelectItem key={v} value={v}>
                            {priorityLabels[v]}
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
                name="dueAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due</FormLabel>
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional details" {...field} />
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
                {createMutation.isPending ? 'Adding…' : 'Add task'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// --- Widget ----------------------------------------------------------------

export function TodaysAgendaSkeleton() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Today&apos;s Agenda
        </CardTitle>
        <CardDescription>Loading tasks…</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2 px-6 py-2">
              <div className="size-4 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function TodaysAgendaContent() {
  const { data: tasks } = useSuspenseQuery(tasksAgendaQueryOptions)
  const queryClient = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: AgendaTask['status'] }) =>
      setTaskStatus({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update task')
    },
  })

  const remaining = tasks.filter((t) => t.status === 'open').length

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Today&apos;s Agenda
        </CardTitle>
        <CardDescription>
          {remaining} task{remaining === 1 ? '' : 's'} remaining
        </CardDescription>
        <CardAction>
          <AddTaskDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">
            <p className="text-sm text-muted-foreground">No tasks yet</p>
            <AddTaskDialog />
          </div>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => {
              const done = task.status === 'done'
              const badge = priorityBadge(task.priority)
              return (
                <li
                  key={task.id}
                  className="flex items-start gap-2 px-6 py-2 text-sm"
                >
                  <button
                    type="button"
                    aria-label={done ? 'Mark task open' : 'Mark task done'}
                    disabled={statusMutation.isPending}
                    onClick={() =>
                      statusMutation.mutate({
                        id: task.id,
                        status: done ? 'open' : 'done',
                      })
                    }
                    className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {done ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <Circle className="size-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          done
                            ? 'truncate text-muted-foreground line-through'
                            : 'truncate font-medium'
                        }
                      >
                        {task.title}
                      </span>
                      {!done ? (
                        <Badge variant={badge.variant} className="shrink-0">
                          {badge.label}
                        </Badge>
                      ) : null}
                    </div>
                    {task.matterName ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {task.matterName}
                      </p>
                    ) : null}
                  </div>
                  {task.dueAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDueAt(task.dueAt)}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function TodaysAgendaWidget() {
  return (
    <Suspense fallback={<TodaysAgendaSkeleton />}>
      <TodaysAgendaContent />
    </Suspense>
  )
}
