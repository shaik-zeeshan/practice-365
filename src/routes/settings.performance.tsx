import { createFileRoute, Link } from '@tanstack/react-router'
import {
  queryOptions,
  useSuspenseQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

import {
  getPerformanceTargets,
  updatePerformanceTargets,
} from '@/server/settings'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ===========================================================================
// /settings/performance — "Personal performance settings".
//
// Edits the one knob that drives every Personal Dashboard target: the user's
// billable-hours goal per working day. Saving invalidates the dashboard query
// so the gauge, bars and annual report immediately reflect the new goal.
// ===========================================================================

export const performanceTargetsQueryOptions = queryOptions({
  queryKey: ['settings', 'performance'],
  queryFn: () => getPerformanceTargets(),
})

export const Route = createFileRoute('/settings/performance')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(performanceTargetsQueryOptions),
  component: PerformanceSettingsPage,
})

const formSchema = z.object({
  targetBillableHoursPerDay: z
    .number({ message: 'Enter a number' })
    .min(0, 'Cannot be negative')
    .max(24, 'Must be 24 or fewer hours'),
  targetRevenuePerMonth: z
    .number({ message: 'Enter a number' })
    .min(0, 'Cannot be negative'),
})
type FormValues = z.infer<typeof formSchema>

function PerformanceSettingsPage() {
  const { data } = useSuspenseQuery(performanceTargetsQueryOptions)
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      targetBillableHoursPerDay: data.targetBillableHoursPerDay,
      targetRevenuePerMonth: data.targetRevenuePerMonth,
    },
  })

  async function onSubmit(values: FormValues) {
    const updated = await updatePerformanceTargets({ data: values })
    await Promise.all([
      // Targets drive both the personal dashboard AND the firm overview's
      // utilization capacity, so invalidate the whole 'dashboard' tree.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({
        queryKey: performanceTargetsQueryOptions.queryKey,
      }),
    ])
    reset({
      targetBillableHoursPerDay: updated.targetBillableHoursPerDay,
      targetRevenuePerMonth: updated.targetRevenuePerMonth,
    })
    toast.success('Performance goal saved')
  }

  return (
    <div className="mx-auto max-w-xl p-4 md:p-6">
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to settings
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Personal performance settings</CardTitle>
          <CardDescription>
            Set your billable-hours goal for {data.userName}. This drives the
            target on every dashboard metric — the gauge, the financial charts,
            and the annual report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="targetBillableHoursPerDay">
                Billable hours target per working day
              </Label>
              <Input
                id="targetBillableHoursPerDay"
                type="number"
                step="0.25"
                min="0"
                max="24"
                className="max-w-[12rem]"
                {...register('targetBillableHoursPerDay', {
                  valueAsNumber: true,
                })}
              />
              <p className="text-xs text-muted-foreground">
                Applied across Mon–Fri working days to compute weekly, monthly
                and annual targets.
              </p>
              {errors.targetBillableHoursPerDay && (
                <p className="text-xs text-destructive">
                  {errors.targetBillableHoursPerDay.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="targetRevenuePerMonth">
                Monthly revenue goal
              </Label>
              <div className="relative max-w-[12rem]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="targetRevenuePerMonth"
                  type="number"
                  step="100"
                  min="0"
                  className="pl-6"
                  {...register('targetRevenuePerMonth', {
                    valueAsNumber: true,
                  })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Drives the Target bars on Financial Metrics and the Annual
                Report goal line. Leave 0 to derive the target from your hours
                goal × rate.
              </p>
              {errors.targetRevenuePerMonth && (
                <p className="text-xs text-destructive">
                  {errors.targetRevenuePerMonth.message}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? 'Saving…' : 'Save goal'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
