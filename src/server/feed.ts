import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  timeEntries,
  invoices,
  tasks,
  calendarEvents,
  trustTransactions,
  trustAccounts,
  users,
  matters,
  clients,
  firms,
} from '@/db/schema'
import { getSession } from '@/lib/auth'
import { roundToBilledHours } from '@/lib/services/billing'

// ===========================================================================
// Firm Feed server function (TanStack Start createServerFn).
//
// Drives the dashboard "Firm Feed" widget. There is NO feed table — the feed is
// DERIVED on the fly by querying recent rows across several real tables, mapping
// each to a uniform feed item, then merging + sorting by timestamp desc.
//
// Sources (each firm-scoped, fetched newest-first with a small per-source cap,
// then merged and re-sorted, final limit FEED_LIMIT):
//   - time entries   → "{user} logged {hours}h to {matter}"
//   - invoices       → "Invoice {number} ({status}) for {client}"
//   - completed tasks→ "{user} completed task: {title}"
//   - calendar events→ "Scheduled {eventType}: {title}"
//   - trust txns     → "{type} of ${amount} to trust"
//
// NOTE: the `matters` table has NO creation timestamp column, so "new matter
// created" events are intentionally SKIPPED (can't be ordered in the feed).
//
// API: getFirmFeed() → FeedItem[]
// ===========================================================================

/** How many rows to pull from each source before merging. */
const PER_SOURCE_LIMIT = 8
/** Final size of the merged feed. */
const FEED_LIMIT = 15

// --- Return type (exported for UI agents) ----------------------------------

/** A single unified activity-feed entry derived from a source table. */
export interface FeedItem {
  /** Unique across sources via a source prefix, e.g. `te-<id>`, `inv-<id>`. */
  id: string
  /** Source discriminator: time_entry | invoice | task | event | trust. */
  kind: string
  /** Who performed the action, when known (else null). */
  actorName: string | null
  /** Human-readable activity line. */
  text: string
  /** When it happened — used for the merge sort (newest first). */
  timestamp: Date
  /** Related matter name when the source row has one (else null). */
  matterName?: string | null
}

/** Coerce a possibly-string timestamp column to a Date. */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

// --- Server function -------------------------------------------------------

/**
 * getFirmFeed() → FeedItem[]
 * Builds the firm's unified recent-activity feed by querying several source
 * tables (firm-scoped), mapping each row to a FeedItem, then merging + sorting
 * by timestamp desc and trimming to FEED_LIMIT. Returns [] gracefully when the
 * firm has no activity yet.
 */
export const getFirmFeed = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<FeedItem>> => {
    const { firmId } = getSession()

    // Need the firm's billing increment to label time entries with billed hours.
    const [firm] = await db
      .select({ minuteIncrement: firms.minuteIncrement })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)
    if (!firm) throw new Error('Firm not found')
    const minuteIncrement = firm.minuteIncrement

    // Run every source query concurrently — they are independent + firm-scoped.
    const [timeRows, invoiceRows, taskRows, eventRows, trustRows] =
      await Promise.all([
        // Time entries: "{user} logged {hours}h to {matter}".
        db
          .select({
            id: timeEntries.id,
            durationSeconds: timeEntries.durationSeconds,
            createdAt: timeEntries.createdAt,
            userName: users.name,
            matterName: matters.name,
          })
          .from(timeEntries)
          .leftJoin(users, eq(users.id, timeEntries.userId))
          .leftJoin(matters, eq(matters.id, timeEntries.matterId))
          .where(eq(timeEntries.firmId, firmId))
          .orderBy(desc(timeEntries.createdAt))
          .limit(PER_SOURCE_LIMIT),

        // Invoices: "Invoice {number} ({status}) for {client}".
        db
          .select({
            id: invoices.id,
            number: invoices.number,
            status: invoices.status,
            createdAt: invoices.createdAt,
            clientName: clients.name,
            matterName: matters.name,
          })
          .from(invoices)
          .leftJoin(clients, eq(clients.id, invoices.clientId))
          .leftJoin(matters, eq(matters.id, invoices.matterId))
          .where(eq(invoices.firmId, firmId))
          .orderBy(desc(invoices.createdAt))
          .limit(PER_SOURCE_LIMIT),

        // Completed tasks: "{user} completed task: {title}".
        db
          .select({
            id: tasks.id,
            title: tasks.title,
            completedAt: tasks.completedAt,
            userName: users.name,
            matterName: matters.name,
          })
          .from(tasks)
          .leftJoin(users, eq(users.id, tasks.userId))
          .leftJoin(matters, eq(matters.id, tasks.matterId))
          .where(and(eq(tasks.firmId, firmId), eq(tasks.status, 'done')))
          .orderBy(desc(tasks.completedAt))
          .limit(PER_SOURCE_LIMIT),

        // Calendar events: "Scheduled {eventType}: {title}".
        db
          .select({
            id: calendarEvents.id,
            title: calendarEvents.title,
            eventType: calendarEvents.eventType,
            createdAt: calendarEvents.createdAt,
            matterName: matters.name,
          })
          .from(calendarEvents)
          .leftJoin(matters, eq(matters.id, calendarEvents.matterId))
          .where(eq(calendarEvents.firmId, firmId))
          .orderBy(desc(calendarEvents.createdAt))
          .limit(PER_SOURCE_LIMIT),

        // Trust transactions: "{type} of ${amount} to trust".
        db
          .select({
            id: trustTransactions.id,
            type: trustTransactions.type,
            amount: trustTransactions.amount,
            createdAt: trustTransactions.createdAt,
            matterName: matters.name,
          })
          .from(trustTransactions)
          .leftJoin(
            trustAccounts,
            eq(trustAccounts.id, trustTransactions.trustAccountId),
          )
          .leftJoin(matters, eq(matters.id, trustAccounts.matterId))
          .where(eq(trustTransactions.firmId, firmId))
          .orderBy(desc(trustTransactions.createdAt))
          .limit(PER_SOURCE_LIMIT),
      ])

    const items: Array<FeedItem> = []

    for (const r of timeRows) {
      const hours = roundToBilledHours(r.durationSeconds, minuteIncrement)
      const matter = r.matterName ?? 'no matter'
      items.push({
        id: `te-${r.id}`,
        kind: 'time_entry',
        actorName: r.userName ?? null,
        text: `${r.userName ?? 'Someone'} logged ${hours}h to ${matter}`,
        timestamp: toDate(r.createdAt),
        matterName: r.matterName ?? null,
      })
    }

    for (const r of invoiceRows) {
      const who = r.clientName ?? 'the firm'
      items.push({
        id: `inv-${r.id}`,
        kind: 'invoice',
        actorName: null,
        text: `Invoice ${r.number} (${r.status}) for ${who}`,
        timestamp: toDate(r.createdAt),
        matterName: r.matterName ?? null,
      })
    }

    for (const r of taskRows) {
      // completedAt should be set for done tasks; skip the rare null to keep
      // the sort well-defined.
      if (r.completedAt == null) continue
      items.push({
        id: `task-${r.id}`,
        kind: 'task',
        actorName: r.userName ?? null,
        text: `${r.userName ?? 'Someone'} completed task: ${r.title}`,
        timestamp: toDate(r.completedAt),
        matterName: r.matterName ?? null,
      })
    }

    for (const r of eventRows) {
      items.push({
        id: `evt-${r.id}`,
        kind: 'event',
        actorName: null,
        text: `Scheduled ${r.eventType}: ${r.title}`,
        timestamp: toDate(r.createdAt),
        matterName: r.matterName ?? null,
      })
    }

    for (const r of trustRows) {
      items.push({
        id: `trust-${r.id}`,
        kind: 'trust',
        actorName: null,
        text: `${r.type} of $${r.amount} to trust`,
        timestamp: toDate(r.createdAt),
        matterName: r.matterName ?? null,
      })
    }

    // Merge: newest first, then trim to the feed size.
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    return items.slice(0, FEED_LIMIT)
  },
)
