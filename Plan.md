# Firm Dashboard → Clio-style "Firm overview"

## Context

The **Firm Dashboard** tab (`/dashboard`, `firm` tab) currently renders a 4-card KPI
strip (`MetricsBar`) plus a widget grid (Activities / Bills / Calendar / Trust Flags).
The target screenshots show Clio Manage's real **Firm overview**: a filtered header
followed by three stacked analytics sections — **Utilization → Realization →
Collection** — each a "Rate average" donut + a "Monthly" bar chart + a totals row + a
legend. We're replacing the firm tab's contents with this overview. Personal Dashboard
and Firm Feed tabs are untouched.

Decisions (confirmed): **replace** the firm tab entirely · all three header filters
(**year**, **role**, **rate basis**) are functional · monthly charts show **current-year
bars with a working Hr / $ / % unit toggle** (no prior-year comparison bars).

This is a real backend+frontend feature, built to the repo's existing conventions:
firm-scoped `createServerFn` rollups (STACK §6), shared `queryOptions` read via
TanStack Query, and hand-drawn SSR-safe SVG charts (no chart dependency — same approach
as `AnnualReportWidget`/`HourlyMetricsWidget`).

## The three sections — exact definitions

All metrics are **firm-scoped** (firmId from session, never trusted from client) and
computed in JS with the existing billing helpers (`roundToBilledHours`, `computeAmount`,
`toCents`, `centsToString` in `src/lib/services/billing.ts`) so numbers match `/time`.
Billed hours use the firm's `minuteIncrement`. `$` values use the **rate basis** filter:
`bill` → the entry's own `rate` (fallback matter rate → user default); `standard` →
the user's `defaultRate`.

**Utilization** (hours-based; donut = utilization rate):
- `billableHours` = Σ billed hours, `billable === 'billable'`
- `nonBillableHours` = Σ billed hours, `billable in (non_billable, no_charge)`
- `capacityHours` = Σ over filtered users of `targetBillableHoursPerDay × businessDays(month)`
  (future months in the current year contribute 0 — no phantom capacity)
- `untrackedHours` = max(0, capacity − (billable + nonBillable))
- `utilizationRate` = capacity > 0 ? billable / capacity : 0
- Totals row: **Billable / Non-billable / Untracked** (hours) — matches screenshot.

**Realization** (hours-based; donut = realization rate):
- `workedBillableHours` = Σ billed hours of billable entries
- `billedHours` = those whose invoice is **issued** (`unpaid`|`paid`)
- `unbilledDraftHours` = worked − billed (WIP with no invoice + draft/pending/void)
- `realizationRate` = worked > 0 ? billed / worked : 0
- Totals row: **Billed Nondiscounted (= billedHours) / Billed Discounted (= 0, no discount
  model) / Unbilled & Draft (= unbilledDraftHours)** — matches screenshot.

**Collection** ($-based; donut = collection rate) — from `invoices`:
- `collectedCents` = Σ `total` where `status === 'paid'`
- `uncollectedCents` = Σ `total` where `status === 'unpaid'`
- `collectionRate` = billed(=collected+uncollected) > 0 ? collected / billed : 0
- Monthly bucket by `issuedAt` (fallback `createdAt`).
- Totals row: **Collected / Uncollected** ($).

Each section returns a **12-month array** carrying *all* unit values
(`hours`, `valueCents`, `rate`) so the Hr/$/% toggle is instant client-side. Rate-basis
and year/role changes refetch (server recomputes); the unit toggle never refetches.
Collection supports only `$` and `%` (no Hr).

## Files

**New — server**
- `src/server/firm-overview.ts` — `getFirmOverview({ year, role, rateBasis })` Zod-validated
  `createServerFn`. Two firm-scoped queries (year's time entries joined to user+matter; the
  firm's invoices), one rollup pass per section. Returns `{ refreshedAt, availableYears,
  availableRoles, utilization, realization, collection }`, each section `{ rate, avg, totals,
  monthly[] }`. Reuses billing + period helpers.

**New — lib helper**
- `src/lib/periods.ts` — add `monthsOfYearForYear(year, now)` (generalises existing
  `monthsOfYear`, which is hard-wired to `now`'s year) so an arbitrary selected year gets
  per-month business-day counts + past/current/future flags.

**New — shared query/formatters**
- `src/components/dashboard/firmOverview.ts` — `firmOverviewQueryOptions(filters)` (queryKey
  `['dashboard','firm-overview', year, role, rateBasis]`), `FirmFilters` type +
  `defaultFirmFilters()`, and `hrs`/`currency0` formatters + reused `CHART` palette.

**New — components** (`src/components/dashboard/firm-overview/`)
- `FirmOverview.tsx` — owns filter state (`useState`, seeded from defaults), runs
  `useQuery(firmOverviewQueryOptions(filters), { placeholderData: keepPreviousData })` so the
  prefetched default is instant and filter changes don't flash. Renders the header (title,
  "Data refreshed …", three shadcn `Select` filters) + three `OverviewSection`s.
- `OverviewSection.tsx` — card shell: title bar, left `RateDonut` + totals row, right
  `MonthlyBarChart` with the Hr/$/% toggle + legend. Renders the centered "You have no data
  to display for this period" empty state when the section has no data.
- `RateDonut.tsx` — SVG progress ring (rate %) with big-% + secondary-avg center label.
  Distilled from `HourlyMetricsWidget`'s `Donut`.
- `MonthlyBarChart.tsx` — SVG 12-month bars: nice-rounded y-axis, month-initial x labels,
  grouped/stacked series for the active unit. Measures width via the shared hook.

**New — shared chart utils**
- `src/components/dashboard/chartUtils.ts` — extract `useElementWidth` + `niceMax` (currently
  private in `AnnualReportWidget.tsx`) so both the new chart and the annual report share them.

**Modified**
- `src/components/dashboard/AnnualReportWidget.tsx` — import `useElementWidth`/`niceMax` from
  `chartUtils` instead of its local copies (small, safe dedup).
- `src/routes/dashboard.tsx` — replace the `firm` `TabsContent` body with `<FirmOverview />`;
  update the route `loader` to prefetch `firmOverviewQueryOptions(defaultFirmFilters())` and
  drop the now-unused firm-widget prefetches (`dashboardMetrics`, `activities`,
  `upcomingEvents`, `trustFlags`, `billsSummary`); remove the corresponding imports. Personal
  tab (personalDashboard, tasksAgenda) and Feed tab (firmFeed) prefetches stay. The removed
  widget component files are left in place (not deleted) — just no longer mounted here.

## Verification

1. `pnpm dev` → open `/dashboard` → **Firm Dashboard** tab. Confirm the three sections
   (Utilization, Realization, Collection) render with donut + monthly bars + totals + legend,
   matching the screenshots (empty sections show the "no data" state).
2. Change **Year** → all three sections recompute. Change **Role** → hours/capacity reflect the
   filtered user set. Change **Rate basis** (`bill`↔`standard`) → `$` values shift, hours/% don't.
3. Toggle **Hr / $ / %** on a section's monthly chart → instant, no network (verify in
   devtools that only filter changes refetch).
4. Sanity-check a number against `/time` (billed hours for the period tie out via the shared
   helpers). If sections are all-empty, the seed has no current-year data — reseed
   (`pnpm db:seed`) or pick a year with entries.
5. `pnpm build` (typecheck + lint clean; no unused-import errors in `dashboard.tsx`).
