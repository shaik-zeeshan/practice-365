import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  invoices,
  timeEntries,
  firms,
  clients,
  matters,
  invoiceStatus,
} from '@/db/schema'
import type { Invoice } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { computeAmount, centsToString, toCents } from '@/lib/services/billing'

// ===========================================================================
// Bills server functions (TanStack Start createServerFn).
//
// Drives the dashboard "Bills" widget: a firm-wide A/R + WIP snapshot plus a
// recent-invoice list and an invoice-create write.
//
// Every handler:
//   - resolves { firmId, role } from the (stub) session,
//   - SCOPES EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - keeps money exact in integer cents via the shared billing helpers and
//     returns numeric strings (never floats).
//
// WIP here is computed with the SAME approach as server/dashboard.ts: sum
// `computeAmount({ durationSeconds, minuteIncrement, rate }).amountCents` over
// every unbilled (invoiceId IS NULL) billable time entry, using the firm's real
// `minuteIncrement`, then `centsToString`. "Overdue" is DERIVED, not stored:
// status 'unpaid' AND dueAt < now.
//
// API (each fn is callable as `fn()` / `fn({ data })` from the client):
//   getBillsSummary()                 → BillsSummary
//   listInvoices()                    → InvoiceListItem[]
//   createInvoice(CreateInvoiceInput) → Invoice
// ===========================================================================

// --- Return types (exported for UI agents) ---------------------------------

/** A money bucket: aggregated total (numeric string) + how many rows. */
export interface BillsBucket {
  /** Sum of totals as a fixed-2 numeric string ("1234.50"). */
  amount: string
  /** Number of rows in the bucket. */
  count: number
}

/** A minimal draft-invoice row for the Bills widget's draft list. */
export interface BillsDraft {
  id: string
  number: string
  total: string
  clientName: string | null
}

/** Firm A/R + WIP snapshot powering the Bills widget. */
export interface BillsSummary {
  /** Issued-or-pending receivables: status in ('unpaid','pending'). */
  outstanding: BillsBucket
  /** Derived overdue: status 'unpaid' AND dueAt < now. */
  overdue: BillsBucket
  /** Unbilled billable work in progress (time_entries, invoiceId IS NULL). */
  wip: BillsBucket
  /** Number of draft invoices. */
  draftCount: number
  /** A small list of draft invoices for quick display. */
  drafts: Array<BillsDraft>
}

/** An invoice joined with client/matter names + a derived `overdue` flag. */
export interface InvoiceListItem {
  id: string
  number: string
  status: (typeof invoiceStatus.enumValues)[number]
  total: string
  issuedAt: Date | null
  dueAt: Date | null
  /** Raw FKs (nullable) so the edit form can pre-fill its selects. */
  clientId: string | null
  matterId: string | null
  clientName: string | null
  matterName: string | null
  /** Derived: status 'unpaid' AND dueAt < now. */
  overdue: boolean
}

// --- Server functions ------------------------------------------------------

/**
 * getBillsSummary() → BillsSummary
 * Firm-scoped A/R + WIP rollup for the Bills widget. Fetches the firm's
 * invoices and unbilled billable entries once and aggregates in JS with the
 * shared billing helpers so the numbers match /time and the dashboard exactly.
 */
export const getBillsSummary = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BillsSummary> => {
    const { firmId } = getSession()

    const firmRows = await db
      .select({ minuteIncrement: firms.minuteIncrement })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1)
    if (firmRows.length === 0) throw new Error('Firm not found')
    const minuteIncrement = firmRows[0].minuteIncrement

    const now = new Date()

    // --- A/R buckets (from invoices) ---------------------------------------
    const invoiceRows = await db
      .select({
        status: invoices.status,
        total: invoices.total,
        dueAt: invoices.dueAt,
      })
      .from(invoices)
      .where(eq(invoices.firmId, firmId))

    let outstandingCents = 0
    let outstandingCount = 0
    let overdueCents = 0
    let overdueCount = 0
    let draftCount = 0

    for (const inv of invoiceRows) {
      const cents = toCents(inv.total)

      // Outstanding receivables = unpaid + pending.
      if (inv.status === 'unpaid' || inv.status === 'pending') {
        outstandingCents += cents
        outstandingCount += 1
      }

      // Overdue is DERIVED: issued+unpaid with a past due date.
      if (inv.status === 'unpaid') {
        const due =
          inv.dueAt == null
            ? null
            : inv.dueAt instanceof Date
              ? inv.dueAt
              : new Date(inv.dueAt)
        if (due && due < now) {
          overdueCents += cents
          overdueCount += 1
        }
      }

      if (inv.status === 'draft') draftCount += 1
    }

    // --- WIP bucket (unbilled billable time, same logic as dashboard) ------
    const wipRows = await db
      .select({
        rate: timeEntries.rate,
        durationSeconds: timeEntries.durationSeconds,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.firmId, firmId),
          eq(timeEntries.billable, 'billable'),
          // invoiceId IS NULL → unbilled WIP. drizzle eq(col, null) → `IS NULL`.
          isNull(timeEntries.invoiceId),
        ),
      )

    let wipCents = 0
    for (const row of wipRows) {
      const { amountCents } = computeAmount({
        durationSeconds: row.durationSeconds,
        minuteIncrement,
        rate: row.rate,
      })
      wipCents += amountCents
    }

    // --- Draft list (small) ------------------------------------------------
    const draftRows = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        total: invoices.total,
        clientName: clients.name,
      })
      .from(invoices)
      .leftJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.firmId, firmId), eq(invoices.status, 'draft')))
      .orderBy(desc(invoices.createdAt))
      .limit(10)

    return {
      outstanding: {
        amount: centsToString(outstandingCents),
        count: outstandingCount,
      },
      overdue: { amount: centsToString(overdueCents), count: overdueCount },
      wip: { amount: centsToString(wipCents), count: wipRows.length },
      draftCount,
      drafts: draftRows.map((d) => ({
        id: d.id,
        number: d.number,
        total: d.total,
        clientName: d.clientName,
      })),
    }
  },
)

/**
 * listInvoices() → InvoiceListItem[]
 * The firm's most recent invoices (limit 15), joined with client + matter
 * names, newest first, each with a derived `overdue` flag.
 */
export const listInvoices = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<InvoiceListItem>> => {
    const { firmId } = getSession()
    const now = new Date()

    const rows = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        total: invoices.total,
        issuedAt: invoices.issuedAt,
        dueAt: invoices.dueAt,
        clientId: invoices.clientId,
        matterId: invoices.matterId,
        clientName: clients.name,
        matterName: matters.name,
      })
      .from(invoices)
      .leftJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(matters, eq(matters.id, invoices.matterId))
      .where(eq(invoices.firmId, firmId))
      .orderBy(desc(invoices.createdAt))
      .limit(15)

    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      total: r.total,
      issuedAt: r.issuedAt,
      dueAt: r.dueAt,
      clientId: r.clientId,
      matterId: r.matterId,
      clientName: r.clientName,
      matterName: r.matterName,
      overdue: r.status === 'unpaid' && r.dueAt != null && r.dueAt < now,
    }))
  },
)

// --- Zod input schema ------------------------------------------------------

const createInvoiceSchema = z.object({
  number: z.string().min(1),
  clientId: z.uuid().nullish(),
  matterId: z.uuid().nullish(),
  status: z.enum(invoiceStatus.enumValues).default('draft'),
  // Money stays a numeric string (MONEY RULE — never a float). >= 0.
  total: z
    .string()
    .refine((v) => Number(v) >= 0, { message: 'total must be >= 0' }),
  issuedAt: z.coerce.date().nullish(),
  dueAt: z.coerce.date().nullish(),
})

/** Inferred input type (exported for UI agents). */
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

/**
 * createInvoice({ number, clientId?, matterId?, status?, total, issuedAt?,
 *                 dueAt? }) → Invoice
 * Inserts a firm-scoped invoice (write-guarded) and returns the new row.
 */
export const createInvoice = createServerFn({ method: 'POST' })
  .validator(createInvoiceSchema)
  .handler(async ({ data }): Promise<Invoice> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(invoices)
      .values({
        firmId,
        clientId: data.clientId ?? null,
        matterId: data.matterId ?? null,
        number: data.number,
        status: data.status,
        total: data.total,
        issuedAt: data.issuedAt ?? null,
        dueAt: data.dueAt ?? null,
      })
      .returning()

    return row
  })

// --- Update details --------------------------------------------------------

// Same shape as create, plus the target id. Edits every field directly (status
// included), so the form is the single source of truth — no auto-stamping here.
const updateInvoiceSchema = createInvoiceSchema.extend({ id: z.uuid() })

/** Inferred input type (exported for UI agents). */
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>

/**
 * updateInvoice({ id, number, clientId?, matterId?, status?, total, issuedAt?,
 *                 dueAt? }) → Invoice
 * Edits a firm-scoped invoice's details (write-guarded). The WHERE matches on
 * id AND firmId, so a firm can never edit another firm's invoice.
 */
export const updateInvoice = createServerFn({ method: 'POST' })
  .validator(updateInvoiceSchema)
  .handler(async ({ data }): Promise<Invoice> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const rows = await db
      .update(invoices)
      .set({
        number: data.number,
        clientId: data.clientId ?? null,
        matterId: data.matterId ?? null,
        status: data.status,
        total: data.total,
        issuedAt: data.issuedAt ?? null,
        dueAt: data.dueAt ?? null,
      })
      .where(and(eq(invoices.id, data.id), eq(invoices.firmId, firmId)))
      .returning()

    if (rows.length === 0) throw new Error('Invoice not found')

    return rows[0]
  })

// --- Update status ---------------------------------------------------------

const updateInvoiceStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(invoiceStatus.enumValues),
})

/** Inferred input type (exported for UI agents). */
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>

/**
 * updateInvoiceStatus({ id, status }) → Invoice
 * Changes an invoice's status (write-guarded, firm-scoped). The WHERE clause
 * matches on BOTH id AND firmId so a firm can never mutate another firm's
 * invoice. Side effect: moving a draft/pending invoice to 'unpaid' means it has
 * been issued, so we stamp `issuedAt` if it is still null (overdue is derived
 * from issued+unpaid+past-due — see getBillsSummary).
 */
export const updateInvoiceStatus = createServerFn({ method: 'POST' })
  .validator(updateInvoiceStatusSchema)
  .handler(async ({ data }): Promise<Invoice> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    // WHERE matches on id AND firmId, so a wrong/foreign id returns 0 rows.
    const rows = await db
      .update(invoices)
      .set({
        status: data.status,
        // Stamp the issue date the first time an invoice is issued (→ unpaid).
        // COALESCE keeps any existing issuedAt so re-issuing never resets it.
        ...(data.status === 'unpaid'
          ? { issuedAt: sql`coalesce(${invoices.issuedAt}, now())` }
          : {}),
      })
      .where(and(eq(invoices.id, data.id), eq(invoices.firmId, firmId)))
      .returning()

    if (rows.length === 0) throw new Error('Invoice not found')

    return rows[0]
  })
