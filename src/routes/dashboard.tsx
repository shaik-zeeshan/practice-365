import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { personalDashboardQueryOptions } from '@/components/dashboard/personalDashboard'
import { HourlyMetricsWidget } from '@/components/dashboard/HourlyMetricsWidget'
import { BillingMetricsWidget } from '@/components/dashboard/BillingMetricsWidget'
import { FinancialMetricsWidget } from '@/components/dashboard/FinancialMetricsWidget'
import { AnnualReportWidget } from '@/components/dashboard/AnnualReportWidget'
import {
  FirmFeedWidget,
  firmFeedQueryOptions,
} from '@/components/dashboard/FirmFeedWidget'
import {
  TodaysAgendaWidget,
  tasksAgendaQueryOptions,
} from '@/components/dashboard/TodaysAgendaWidget'
import { FirmOverview } from '@/components/dashboard/firm-overview/FirmOverview'
import {
  firmOverviewQueryOptions,
  defaultFirmFilters,
} from '@/components/dashboard/firmOverview'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ===========================================================================
// Firm dashboard — modelled on Clio Manage's three tabs (STACK.md §2).
//
//   Personal Dashboard — LIVE per-user metrics (getPersonalDashboard): the
//     billable-hours gauge, firm billing buckets, financial actual/expected/
//     target bars, and the cumulative annual report.
//   Firm Dashboard     — the firm KPI strip (real) + supporting widgets.
//   Firm Feed          — the activity feed.
//
// The route loader prefetches every query the active-and-adjacent tabs need so
// switching tabs is instant and the first paint shows real numbers (SSR).
// ===========================================================================

export const Route = createFileRoute('/dashboard')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(personalDashboardQueryOptions),
      context.queryClient.ensureQueryData(tasksAgendaQueryOptions),
      context.queryClient.ensureQueryData(
        firmOverviewQueryOptions(defaultFirmFilters()),
      ),
      context.queryClient.ensureQueryData(firmFeedQueryOptions),
    ]),
  component: DashboardPage,
})

/** Fallback for the live Personal Dashboard sections. */
function PersonalSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-44 animate-pulse rounded-xl bg-muted" />
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
    </div>
  )
}

/** The live, per-user Clio-style sections (all read one cached query). */
function PersonalSections() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <HourlyMetricsWidget />
        <BillingMetricsWidget />
      </div>
      <FinancialMetricsWidget />
      <AnnualReportWidget />
    </div>
  )
}

function DashboardPage() {
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Firm overview &amp; personal performance
        </p>
      </div>

      <Tabs defaultValue="personal">
        {/* Scrollable on narrow screens; pb keeps the active underline
            (positioned 5px below the strip) from being clipped. */}
        <div className="mb-4 overflow-x-auto pb-1.5">
          <TabsList variant="line">
            <TabsTrigger value="personal">Personal Dashboard</TabsTrigger>
            <TabsTrigger value="firm">Firm Dashboard</TabsTrigger>
            <TabsTrigger value="feed">Firm Feed</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="personal" className="space-y-5">
          <TodaysAgendaWidget />
          <Suspense fallback={<PersonalSkeleton />}>
            <PersonalSections />
          </Suspense>
        </TabsContent>

        <TabsContent value="firm">
          <FirmOverview />
        </TabsContent>

        <TabsContent value="feed">
          <div className="max-w-2xl">
            <FirmFeedWidget />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
