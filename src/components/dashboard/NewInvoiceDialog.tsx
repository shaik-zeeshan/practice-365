import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { createInvoice, updateInvoice } from '@/server/bills'
import type { InvoiceListItem } from '@/server/bills'
import { listClients } from '@/server/clients'
import { listMatters } from '@/server/matters'
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

// ===========================================================================
// InvoiceFormDialog — in-app create/edit invoice form.
//
// react-hook-form + zodResolver. With no `invoice` prop it CREATES (via
// `createInvoice`); with one it EDITS that invoice (via `updateInvoice`),
// pre-filling every field including the client/matter selects. Client/matter
// are OPTIONAL selects (a sentinel value maps to null, since Radix Select
// disallows empty string). Money stays a numeric string.
//
// `NewInvoiceDialog` is kept as a thin create-only wrapper for existing callers
// (the dashboard Bills widget).
// ===========================================================================

// Sentinel option value for "none" (Radix Select disallows empty string).
const NONE = '__none__'

const statusValues = ['draft', 'pending', 'unpaid', 'paid', 'void'] as const

const statusLabels: Record<(typeof statusValues)[number], string> = {
  draft: 'Draft',
  pending: 'Pending',
  unpaid: 'Unpaid',
  paid: 'Paid',
  void: 'Void',
}

const formSchema = z.object({
  number: z.string().min(1, 'Invoice number is required'),
  clientId: z.string(), // NONE sentinel or a uuid
  matterId: z.string(), // NONE sentinel or a uuid
  status: z.enum(statusValues),
  total: z
    .string()
    .min(1, 'Total is required')
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, {
      message: 'Enter an amount of 0 or more',
    }),
  issuedAt: z.string(),
  dueAt: z.string(),
})

type FormValues = z.infer<typeof formSchema>

const defaultValues: FormValues = {
  number: '',
  clientId: NONE,
  matterId: NONE,
  status: 'draft',
  total: '',
  issuedAt: '',
  dueAt: '',
}

/** A Date|string|null → "yyyy-mm-dd" (local) for <input type="date">. */
function toDateInput(value: Date | string | null): string {
  if (value == null) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  // Shift by the local tz offset so the displayed day matches the stored date.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

/** Build the form's values from an existing invoice (edit mode). */
function invoiceToFormValues(invoice: InvoiceListItem): FormValues {
  return {
    number: invoice.number,
    clientId: invoice.clientId ?? NONE,
    matterId: invoice.matterId ?? NONE,
    status: invoice.status,
    total: invoice.total,
    issuedAt: toDateInput(invoice.issuedAt),
    dueAt: toDateInput(invoice.dueAt),
  }
}

export function InvoiceFormDialog({
  open,
  onOpenChange,
  invoice = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit that invoice; absent/null → create a new one. */
  invoice?: InvoiceListItem | null
}) {
  const isEdit = invoice != null
  const queryClient = useQueryClient()

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => listClients(),
    enabled: open,
  })
  const mattersQuery = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters(),
    enabled: open,
  })

  const clients = clientsQuery.data ?? []
  const matters = mattersQuery.data ?? []

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  // Re-seed the form whenever the dialog opens (or the target invoice changes):
  // edit → that invoice's values, create → blanks.
  useEffect(() => {
    if (!open) return
    // form is stable from react-hook-form; open/invoice drive the reset.
    form.reset(invoice ? invoiceToFormValues(invoice) : defaultValues)
  }, [open, invoice, form])

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        number: values.number,
        clientId: values.clientId === NONE ? null : values.clientId,
        matterId: values.matterId === NONE ? null : values.matterId,
        status: values.status,
        total: values.total,
        issuedAt: values.issuedAt ? values.issuedAt : null,
        dueAt: values.dueAt ? values.dueAt : null,
      }
      return isEdit
        ? updateInvoice({ data: { ...payload, id: invoice.id } })
        : createInvoice({ data: payload })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Invoice updated' : 'Invoice created')
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onOpenChange(false)
      form.reset(defaultValues)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to ${isEdit ? 'update' : 'create'} invoice`,
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset(defaultValues)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit invoice' : 'New invoice'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this invoice. Client and matter are optional.'
              : 'Create a firm invoice. Client and matter are optional.'}
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
                name="number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice number</FormLabel>
                    <FormControl>
                      <Input placeholder="INV-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="total"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a client" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>No client</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
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
                      <SelectItem value={NONE}>No matter</SelectItem>
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
                      {statusValues.map((s) => (
                        <SelectItem key={s} value={s}>
                          {statusLabels[s]}
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
                name="issuedAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issued</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
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
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending
                  ? isEdit
                    ? 'Saving…'
                    : 'Creating…'
                  : isEdit
                    ? 'Save changes'
                    : 'Create invoice'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * NewInvoiceDialog — thin create-only wrapper around InvoiceFormDialog, kept for
 * existing callers (the dashboard Bills widget).
 */
export function NewInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return <InvoiceFormDialog open={open} onOpenChange={onOpenChange} />
}
