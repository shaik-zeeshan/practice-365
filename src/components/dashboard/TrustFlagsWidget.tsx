import { Suspense, useEffect, useState } from 'react'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, Plus, ShieldAlert, ShieldCheck } from 'lucide-react'

import {
  createTrustAccount,
  createTrustTransaction,
  getTrustFlags,
  listTrustAccounts,
} from '@/server/trust'
import { listMatters } from '@/server/matters'
import { listClients } from '@/server/clients'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TrustFlag } from '@/server/trust'

// ===========================================================================
// TrustFlagsWidget — trust-accounting compliance alerts (LIVE data).
//
// Reads REAL derived trust flags via `getTrustFlags` and surfaces in-app forms
// to create trust accounts and record transactions (createTrustAccount /
// createTrustTransaction). Both query options are exported so the dashboard
// route loader can prefetch them for SSR (ensureQueryData) and the inner
// component reads the cache via useSuspenseQuery — real data on first paint.
//
// Query keys: ['trust','flags'], ['trust','accounts']. After any mutation we
// invalidate the ['trust'] prefix so flags + account balances both refresh.
// ===========================================================================

export const trustFlagsQueryOptions = queryOptions({
  queryKey: ['trust', 'flags'],
  queryFn: () => getTrustFlags(),
})

export const trustAccountsQueryOptions = queryOptions({
  queryKey: ['trust', 'accounts'],
  queryFn: () => listTrustAccounts(),
})

// Sentinel option value for "no matter/client" (Radix Select disallows "").
const NONE = '__none__'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format a numeric money string ("1250.00") as "$1,250.00". */
function money(value: string): string {
  return currency.format(Number(value))
}

export function TrustFlagsWidget() {
  const [accountOpen, setAccountOpen] = useState(false)
  const [transactionOpen, setTransactionOpen] = useState(false)

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" />
          Trust Flags
        </CardTitle>
        <CardDescription>Trust-account compliance (live data)</CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="size-4" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
                New trust account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTransactionOpen(true)}>
                Record transaction
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <Suspense fallback={<TrustSkeleton />}>
          <TrustFlagsList />
        </Suspense>
      </CardContent>

      <NewTrustAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <RecordTransactionDialog
        open={transactionOpen}
        onOpenChange={setTransactionOpen}
      />
    </Card>
  )
}

/** Inner list — reads the live flags from the suspense cache. */
function TrustFlagsList() {
  const { data: flags } = useSuspenseQuery(trustFlagsQueryOptions)

  if (flags.length === 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-4">
        <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />
        <div>
          <p className="text-sm font-medium">
            All trust accounts in good standing
          </p>
          <p className="text-xs text-muted-foreground">
            No balances below their configured minimum.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {flags.map((flag) => (
        <TrustFlagRow key={flag.accountId} flag={flag} />
      ))}
    </ul>
  )
}

function TrustFlagRow({ flag }: { flag: TrustFlag }) {
  const critical = flag.severity === 'critical'
  return (
    <li className="flex items-start gap-3 px-6 py-2">
      {critical ? (
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant={critical ? 'destructive' : 'secondary'}
            className={
              critical
                ? 'shrink-0'
                : 'shrink-0 border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }
          >
            {critical ? 'Critical' : 'Warning'}
          </Badge>
          <span className="truncate text-sm font-medium">
            {flag.accountName}
          </span>
        </div>
        {flag.matterName ? (
          <p className="truncate text-xs text-muted-foreground">
            {flag.matterName}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          Balance {money(flag.balance)} of {money(flag.minimumBalance)} minimum
          (short {money(flag.shortfall)})
        </p>
      </div>
    </li>
  )
}

/** Skeleton shown while the live flags hydrate. */
function TrustSkeleton() {
  return (
    <ul className="divide-y">
      {Array.from({ length: 2 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-6 py-2">
          <div className="mt-0.5 size-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-56 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// New trust account dialog
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  matterId: z.string(), // NONE sentinel or a uuid
  clientId: z.string(), // NONE sentinel or a uuid
  // Numeric money string; default "0".
  minimumBalance: z
    .string()
    .refine((v) => v.trim() === '' || Number.isFinite(Number(v)), {
      message: 'Enter a valid amount',
    }),
})

type AccountFormValues = z.infer<typeof accountSchema>

function NewTrustAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const mattersQuery = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters(),
    enabled: open,
  })
  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => listClients(),
    enabled: open,
  })

  const matters = mattersQuery.data ?? []
  const clients = clientsQuery.data ?? []

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: '',
      matterId: NONE,
      clientId: NONE,
      minimumBalance: '0',
    },
  })

  const { reset } = form
  useEffect(() => {
    if (open) {
      reset({ name: '', matterId: NONE, clientId: NONE, minimumBalance: '0' })
    }
  }, [open, reset])

  const createMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      createTrustAccount({
        data: {
          name: values.name,
          matterId: values.matterId === NONE ? null : values.matterId,
          clientId: values.clientId === NONE ? null : values.clientId,
          minimumBalance: values.minimumBalance.trim() || '0',
        },
      }),
    onSuccess: () => {
      toast.success('Trust account created')
      queryClient.invalidateQueries({ queryKey: ['trust'] })
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create trust account',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New trust account</DialogTitle>
          <DialogDescription>
            Create a trust account to hold client funds. The balance is derived
            from its transactions.
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Acme Corp IOLTA" {...field} />
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
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
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
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
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
              name="minimumBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum balance</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create account'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Record transaction dialog
// ---------------------------------------------------------------------------

const txnTypeValues = ['deposit', 'withdrawal'] as const

const transactionSchema = z.object({
  trustAccountId: z.string().min(1, 'Select an account'),
  type: z.enum(txnTypeValues),
  amount: z.string().refine((v) => Number(v) > 0, {
    message: 'Amount must be greater than 0',
  }),
  memo: z.string(),
  occurredAt: z.string(), // datetime-local string, optional
})

type TransactionFormValues = z.infer<typeof transactionSchema>

const txnTypeLabels: Record<(typeof txnTypeValues)[number], string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
}

function RecordTransactionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const accountsQuery = useQuery({
    ...trustAccountsQueryOptions,
    enabled: open,
  })
  const accounts = accountsQuery.data ?? []

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      trustAccountId: '',
      type: 'deposit',
      amount: '',
      memo: '',
      occurredAt: '',
    },
  })

  const { reset } = form
  useEffect(() => {
    if (open) {
      reset({
        trustAccountId: '',
        type: 'deposit',
        amount: '',
        memo: '',
        occurredAt: '',
      })
    }
  }, [open, reset])

  const createMutation = useMutation({
    mutationFn: (values: TransactionFormValues) =>
      createTrustTransaction({
        data: {
          trustAccountId: values.trustAccountId,
          type: values.type,
          amount: values.amount,
          memo: values.memo || null,
          occurredAt: values.occurredAt
            ? new Date(values.occurredAt)
            : undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Transaction recorded')
      queryClient.invalidateQueries({ queryKey: ['trust'] })
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to record transaction',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record transaction</DialogTitle>
          <DialogDescription>
            Record a deposit or withdrawal against a trust account.
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
              name="trustAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Trust account</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No trust accounts yet.
                        </div>
                      ) : (
                        accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} — {money(a.balance)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {txnTypeValues.map((v) => (
                          <SelectItem key={v} value={v}>
                            {txnTypeLabels[v]}
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
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
              name="memo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Memo</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional note" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="occurredAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Recording…' : 'Record transaction'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
