import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { createClient, updateClient } from '@/server/clients'
import type { ClientListItem } from '@/server/clients'
import { clientsQueryKey } from '@/routes/clients'

// ===========================================================================
// ClientFormDialog — create OR edit a client.
//
// One component drives both flows: pass a `client` to edit (pre-fills the form,
// calls updateClient), or omit it to create (calls createClient). Mirrors the
// TimeEntryModal pattern: shadcn Form + react-hook-form + zodResolver +
// useMutation, invalidating ['clients'] and toasting on success/error. The
// dialog closes and the form resets on success.
// ===========================================================================

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

type FormValues = z.infer<typeof formSchema>

interface ClientFormDialogProps {
  /** When provided, the dialog edits this client; otherwise it creates a new one. */
  client?: ClientListItem
  /** The control that opens the dialog (e.g. a Button). */
  trigger: React.ReactNode
}

export function ClientFormDialog({ client, trigger }: ClientFormDialogProps) {
  const isEdit = client != null
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: client?.name ?? '' },
  })

  const { reset } = form

  // Re-seed the form each time the dialog opens so an edit dialog always shows
  // the current client name (and a create dialog starts blank).
  useEffect(() => {
    if (open) reset({ name: client?.name ?? '' })
  }, [open, client?.name, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit
        ? updateClient({ data: { id: client.id, name: values.name } })
        : createClient({ data: { name: values.name } }),
    onSuccess: () => {
      toast.success(isEdit ? 'Client updated' : 'Client created')
      queryClient.invalidateQueries({ queryKey: clientsQueryKey })
      setOpen(false)
      reset({ name: '' })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save client')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit client' : 'New client'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Rename this client.'
              : 'Create a client to organise matters and bill work against.'}
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
                    <Input placeholder="e.g. Acme Corporation" {...field} />
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
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Saving…'
                  : isEdit
                    ? 'Save changes'
                    : 'Create client'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
