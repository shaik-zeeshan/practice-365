import { useEffect, useState } from 'react'
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
  DialogTrigger,
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

import { createMatter, updateMatter } from '@/server/matters'
import { listClients } from '@/server/clients'
import type { MatterListItem } from '@/routes/matters'
import { clientsQueryOptions } from '@/routes/clients'
import { firmUsersQueryOptions, mattersQueryKey } from '@/routes/matters'

// ===========================================================================
// MatterFormDialog — create OR edit a matter.
//
// Create: name + client (required) + responsible attorney (optional, defaults
// to the current user server-side) + rate (optional) + status (default
// "active", free text). Edit: every field except client (matter→client links
// aren't editable here), pre-filled from the row.
//
// Selects are backed by queries (clients, firm users). Radix Select disallows
// an empty string value, so the optional "responsible attorney" uses a
// sentinel. Mutations invalidate ['matters']; createMatter also invalidates
// ['clients'] since a new matter changes a client's matter count. Mirrors the
// TimeEntryModal save/invalidate/toast pattern.
// ===========================================================================

// Radix Select forbids empty-string values; use a sentinel for "unset".
const UNASSIGNED = '__unassigned__'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  clientId: z.string().min(1, 'A client is required'),
  responsibleAttorneyId: z.string(), // UNASSIGNED sentinel or a uuid
  rate: z.string(),
  status: z.string().min(1, 'Status is required'),
})

type FormValues = z.infer<typeof formSchema>

interface MatterFormDialogProps {
  /** When provided, the dialog edits this matter; otherwise it creates one. */
  matter?: MatterListItem
  /** The control that opens the dialog (e.g. a Button). */
  trigger: React.ReactNode
}

export function MatterFormDialog({ matter, trigger }: MatterFormDialogProps) {
  const isEdit = matter != null
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  // Only fetch the select options while the dialog is open.
  const clientsQuery = useQuery({
    ...clientsQueryOptions,
    queryFn: () => listClients(),
    enabled: open,
  })
  const firmUsersQuery = useQuery({
    ...firmUsersQueryOptions,
    enabled: open,
  })

  const clients = clientsQuery.data ?? []
  const firmUsers = firmUsersQuery.data ?? []

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: matter?.name ?? '',
      clientId: matter?.clientId ?? '',
      responsibleAttorneyId: matter?.responsibleAttorneyId ?? UNASSIGNED,
      rate: matter?.rate ?? '',
      status: matter?.status ?? 'active',
    },
  })

  const { reset } = form

  // Re-seed whenever the dialog opens so edits show current values.
  useEffect(() => {
    if (!open) return
    reset({
      name: matter?.name ?? '',
      clientId: matter?.clientId ?? '',
      responsibleAttorneyId: matter?.responsibleAttorneyId ?? UNASSIGNED,
      rate: matter?.rate ?? '',
      status: matter?.status ?? 'active',
    })
  }, [open, matter, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const responsibleAttorneyId =
        values.responsibleAttorneyId === UNASSIGNED
          ? null
          : values.responsibleAttorneyId
      const rate = values.rate.trim() === '' ? null : values.rate.trim()

      if (isEdit) {
        return updateMatter({
          data: {
            id: matter.id,
            name: values.name,
            responsibleAttorneyId,
            rate,
            status: values.status,
          },
        })
      }
      return createMatter({
        data: {
          name: values.name,
          clientId: values.clientId,
          responsibleAttorneyId,
          rate,
          status: values.status,
        },
      })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Matter updated' : 'Matter created')
      queryClient.invalidateQueries({ queryKey: mattersQueryKey })
      // New matter changes a client's matter count.
      if (!isEdit) {
        queryClient.invalidateQueries({
          queryKey: clientsQueryOptions.queryKey,
        })
      }
      setOpen(false)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save matter')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit matter' : 'New matter'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this matter's details."
              : 'Open a matter under a client to track and bill work against it.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Series A financing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isEdit}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a client" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {clients.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No clients — create one first.
                        </div>
                      ) : (
                        clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {isEdit ? (
                    <FormDescription>
                      The matter&apos;s client can&apos;t be changed here.
                    </FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="responsibleAttorneyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsible attorney</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Defaults to you" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>
                        Default (current user)
                      </SelectItem>
                      {firmUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                          {u.role ? ` — ${u.role}` : ''}
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
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate (per hour)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Inherit"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Saving…'
                  : isEdit
                    ? 'Save changes'
                    : 'Create matter'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
