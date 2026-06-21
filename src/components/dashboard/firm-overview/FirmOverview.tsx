import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'

import {
  firmOverviewQueryOptions,
  defaultFirmFilters,
} from '../firmOverview'
import type { FirmFilters, RateBasis } from '../firmOverview'
import { OverviewSection } from './OverviewSection'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ===========================================================================
// FirmOverview — the Firm Dashboard tab root.
//
// One cached query (firmOverviewQueryOptions) backs all three sections. The
// Year / Role / Rate-basis Selects fold into the query key, so changing any of
// them refetches; keepPreviousData keeps the old numbers on screen meanwhile.
// The per-section Hr/$/% unit toggle is pure client-side (never refetches).
// ===========================================================================

const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  bill: 'Billable rate',
  standard: 'Standard rate',
}

function roleLabel(role: string): string {
  return role === 'all' ? 'All roles' : role[0].toUpperCase() + role.slice(1)
}

function FirmOverviewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
    </div>
  )
}

export function FirmOverview() {
  const [filters, setFilters] = useState<FirmFilters>(defaultFirmFilters)
  const { data } = useQuery({
    ...firmOverviewQueryOptions(filters),
    placeholderData: keepPreviousData,
  })

  if (!data) return <FirmOverviewSkeleton />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Firm overview
          </h2>
          <p className="text-xs text-muted-foreground">
            Data refreshed{' '}
            {new Date(data.refreshedAt).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(filters.year)}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, year: Number(v) }))
            }
          >
            <SelectTrigger size="sm" className="w-auto min-w-[7rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.availableYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.role}
            onValueChange={(v) => setFilters((f) => ({ ...f, role: v }))}
          >
            <SelectTrigger size="sm" className="w-auto min-w-[7rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.availableRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {roleLabel(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.rateBasis}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, rateBasis: v as RateBasis }))
            }
          >
            <SelectTrigger size="sm" className="w-auto min-w-[7rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['bill', 'standard'] as const).map((b) => (
                <SelectItem key={b} value={b}>
                  {RATE_BASIS_LABEL[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-5">
        <OverviewSection title="Utilization" section={data.utilization} />
        <OverviewSection title="Realization" section={data.realization} />
        <OverviewSection title="Collection" section={data.collection} />
      </div>
    </div>
  )
}
