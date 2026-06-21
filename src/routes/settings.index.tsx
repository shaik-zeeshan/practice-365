import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChevronRight, Tags, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { performanceTargetsQueryOptions } from './settings.performance'
import { activityCategoriesQueryOptions } from './settings.categories'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// ===========================================================================
// /settings — Settings landing page.
//
// Discoverable hub for personal settings. Today there is a single section
// (Performance & targets); the layout maps over a sections array so more can be
// added without restructuring. Each card deep-links into its sub-page and shows
// a live summary of the current value pulled from the cache.
// ===========================================================================

export const Route = createFileRoute('/settings/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(performanceTargetsQueryOptions),
      context.queryClient.ensureQueryData(activityCategoriesQueryOptions),
    ]),
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your targets and preferences
        </p>
      </div>

      <div className="space-y-3">
        <PerformanceSettingsCard />
        <CategoriesSettingsCard />
      </div>
    </div>
  )
}

/** A settings section card: title, description, live summary + chevron. */
function SettingsSectionCard({
  to,
  icon: Icon,
  title,
  description,
  summary,
}: {
  to: string
  icon: LucideIcon
  title: string
  description: string
  summary: React.ReactNode
}) {
  return (
    <Link to={to} className="group block">
      <Card className="gap-4 py-4 transition-colors group-hover:border-foreground/20 group-hover:bg-muted/50">
        <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-x-3">
          <span className="flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
            <p className="text-xs font-medium text-foreground">{summary}</p>
          </div>
          <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </CardHeader>
      </Card>
    </Link>
  )
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Performance & targets section — reads the live goal from the cache. */
function PerformanceSettingsCard() {
  const { data } = useSuspenseQuery(performanceTargetsQueryOptions)

  const hours = `${data.targetBillableHoursPerDay.toFixed(1)} h/day`
  const revenue =
    data.targetRevenuePerMonth > 0
      ? `${usdFormatter.format(data.targetRevenuePerMonth)}/mo goal`
      : 'no revenue goal set'

  return (
    <SettingsSectionCard
      to="/settings/performance"
      icon={Target}
      title="Performance & targets"
      description="Your billable-hours and revenue goals — drive the gauge, financial charts, and annual report targets"
      summary={`Current: ${hours} · ${revenue}`}
    />
  )
}

/** Activity categories section — reads live counts from the cache. */
function CategoriesSettingsCard() {
  const { data } = useSuspenseQuery(activityCategoriesQueryOptions)
  const active = data.filter((c) => !c.archived)
  const timeCount = active.filter((c) => c.type === 'time_entry').length
  const expenseCount = active.filter((c) => c.type === 'expense').length

  return (
    <SettingsSectionCard
      to="/settings/categories"
      icon={Tags}
      title="Activity categories"
      description="Pre-configured billing activities and expenses with default rates — picked when logging time"
      summary={`${timeCount} time entry · ${expenseCount} expense`}
    />
  )
}
