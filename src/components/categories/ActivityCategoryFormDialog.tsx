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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { saveActivityCategory } from '@/server/activity-categories'
import type { ActivityCategory } from '@/server/activity-categories'
import { activityCategoriesQueryKey } from '@/routes/settings.categories'

// ===========================================================================
// ActivityCategoryFormDialog — create OR edit an activity category.
//
// One component drives both flows (mirrors ClientFormDialog): pass a `category`
// to edit, or omit it and pass `defaultType` to create a new one with the type
// preselected from the active tab. The category TYPE is chosen only at create
// time — on edit it is fixed (changing it would reinterpret historical money).
// ===========================================================================

// ISO 4217 codes we expose in the prototype, with their display symbols.
const CURRENCIES: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'INR', symbol: '₹', label: 'INR (₹)' },
  { code: 'CAD', symbol: '$', label: 'CAD ($)' },
  { code: 'AUD', symbol: '$', label: 'AUD ($)' },
]

const symbolFor = (code: string) =>
  CURRENCIES.find((c) => c.code === code)?.symbol ?? '$'

const formSchema = z.object({
  type: z.enum(['time_entry', 'expense']),
  name: z.string().min(1, 'Name is required'),
  currency: z.string().min(1),
  rate: z
    .string()
    .refine(
      (v) => v === '' || !Number.isNaN(Number(v)),
      'Enter a valid amount',
    ),
  permissionGroups: z.string(),
  taxTreatment: z.enum(['default', 'none']),
})

type FormValues = z.infer<typeof formSchema>

interface ActivityCategoryFormDialogProps {
  /** When provided, the dialog edits this category; otherwise it creates one. */
  category?: ActivityCategory
  /** Preselected type for the create flow (from the active tab). */
  defaultType?: 'time_entry' | 'expense'
  /** The control that opens the dialog (e.g. a Button). */
  trigger: React.ReactNode
}

function blankValues(defaultType: 'time_entry' | 'expense'): FormValues {
  return {
    type: defaultType,
    name: '',
    currency: 'USD',
    rate: '',
    permissionGroups: 'Everyone',
    taxTreatment: 'default',
  }
}

export function ActivityCategoryFormDialog({
  category,
  defaultType = 'time_entry',
  trigger,
}: ActivityCategoryFormDialogProps) {
  const isEdit = category != null
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: blankValues(defaultType),
  })

  const { reset } = form

  // Re-seed the form each time the dialog opens so an edit dialog shows current
  // values and a create dialog starts blank with the right type preselected.
  useEffect(() => {
    if (!open) return
    reset(
      category
        ? {
            type: category.type,
            name: category.name,
            currency: category.currency,
            rate: category.rate,
            permissionGroups: category.permissionGroups,
            taxTreatment: category.taxTreatment,
          }
        : blankValues(defaultType),
    )
  }, [open, category, defaultType, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      saveActivityCategory({
        data: {
          id: category?.id,
          type: values.type,
          name: values.name,
          currency: values.currency,
          rate: values.rate === '' ? '0.00' : values.rate,
          taxTreatment: values.taxTreatment,
          permissionGroups: values.permissionGroups || 'Everyone',
          archived: category?.archived ?? false,
        },
      }),
    onSuccess: () => {
      toast.success(isEdit ? 'Category updated' : 'Category created')
      queryClient.invalidateQueries({ queryKey: activityCategoriesQueryKey })
      setOpen(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save category',
      )
    },
  })

  const watchedType = form.watch('type')
  const watchedCurrency = form.watch('currency')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit activity category' : 'New activity category'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this billing activity or expense.'
              : 'Create a reusable billing activity or expense with a default rate.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="grid gap-4"
          >
            {/* Category type — chosen on create, fixed on edit. */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category type</FormLabel>
                  {isEdit ? (
                    <p className="text-sm text-muted-foreground">
                      {field.value === 'time_entry'
                        ? 'Time entry category'
                        : 'Expense category'}{' '}
                      <span className="text-xs">(cannot be changed)</span>
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['time_entry', 'Time entry category'],
                          ['expense', 'Expense category'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => field.onChange(value)}
                          className={cn(
                            'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                            field.value === value
                              ? 'border-foreground bg-muted text-foreground'
                              : 'border-input text-muted-foreground hover:bg-muted/50',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={
                        watchedType === 'expense'
                          ? 'e.g. Filing Fees'
                          : 'e.g. Drafting'
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-[1fr_1.2fr] gap-4">
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.label}
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
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {watchedType === 'expense' ? 'Price' : 'Rate'}
                    </FormLabel>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {symbolFor(watchedCurrency)}
                      </span>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="pl-7"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="permissionGroups"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Permission groups</FormLabel>
                  <FormControl>
                    <Input placeholder="Everyone" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="taxTreatment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="default">
                        (Default) Use tax applied to invoice
                      </SelectItem>
                      <SelectItem value="none">No tax</SelectItem>
                    </SelectContent>
                  </Select>
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
                    : 'Save category'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
