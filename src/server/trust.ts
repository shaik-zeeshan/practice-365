import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { trustAccounts, trustTransactions, matters, clients } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { centsToString, toCents } from '@/lib/services/billing'

// ===========================================================================
// Trust-accounting server functions (TanStack Start createServerFn).
//
// Backs the full trust ledger and the dashboard "Trust Flags" widget.
//
// Every handler:
//   - validates write input with Zod via `.validator(schema)`,
//   - resolves { firmId, role } from the (stub) session,
//   - SCOPES EVERY QUERY by firmId (tenant isolation, STACK.md §6),
//   - guards writes with `can(role, 'write')`.
//
// MONEY RULE (STACK.md §6): trust accounts have NO stored balance column. The
// balance is DERIVED = Σ(deposit amounts) − Σ(withdrawal amounts), computed in
// integer CENTS via the shared billing helpers (`toCents` / `centsToString`),
// never with float math. We load the firm's transactions once and aggregate per
// account in JS so the numbers stay exact and consistent across every widget.
//
// API (each fn is callable as `fn()` / `fn({ data })` from the client):
//   listTrustAccounts()                       → TrustAccountSummary[]
//   getTrustFlags()                           → TrustFlag[]
//   getTrustAccountLedger(LedgerInput)        → TrustAccountLedger
//   createTrustAccount(CreateTrustAccountInput)        → TrustAccount
//   createTrustTransaction(CreateTrustTransactionInput) → TrustTransaction
// ===========================================================================

const trustTxnTypeEnum = z.enum(['deposit', 'withdrawal'])

// --- Zod input schemas -----------------------------------------------------

const ledgerSchema = z.object({
  accountId: z.uuid(),
})

const createTrustAccountSchema = z.object({
  name: z.string().min(1),
  matterId: z.uuid().nullish(),
  clientId: z.uuid().nullish(),
  // numeric column → string; defaults to "0" when omitted.
  minimumBalance: z.string().default('0'),
})

const createTrustTransactionSchema = z.object({
  trustAccountId: z.uuid(),
  type: trustTxnTypeEnum,
  // Positive numeric string (MONEY RULE — never a float). > 0 enforced in cents.
  amount: z.string().refine((v) => toCents(v) > 0, {
    message: 'amount must be greater than 0',
  }),
  memo: z.string().nullish(),
  occurredAt: z.coerce.date().default(() => new Date()),
})

// --- Inferred input types (exported for UI agents) -------------------------

export type LedgerInput = z.infer<typeof ledgerSchema>
export type CreateTrustAccountInput = z.infer<typeof createTrustAccountSchema>
export type CreateTrustTransactionInput = z.infer<
  typeof createTrustTransactionSchema
>

// --- Return types (exported for UI agents) ---------------------------------

export type TrustAccount = typeof trustAccounts.$inferSelect
export type TrustTransaction = typeof trustTransactions.$inferSelect

/** A trust account enriched with its DERIVED balance and join display names. */
export interface TrustAccountSummary {
  id: string
  name: string
  /** Configured floor below which the account is flagged (numeric string). */
  minimumBalance: string
  matterId: string | null
  matterName: string | null
  clientId: string | null
  clientName: string | null
  /** Derived balance as a numeric string ("1250.00"). */
  balance: string
  /** Derived balance in integer cents (for comparisons / charts). */
  balanceCents: number
  /** True when balanceCents < minimumBalance (in cents). */
  belowMinimum: boolean
  /** Number of ledger transactions against this account. */
  transactionCount: number
}

/** A single derived alert for the dashboard "Trust Flags" widget. */
export interface TrustFlag {
  accountId: string
  accountName: string
  matterName: string | null
  /** Current derived balance (numeric string). */
  balance: string
  /** Configured minimum balance (numeric string). */
  minimumBalance: string
  /** How far below the minimum the balance is (numeric string, >= 0). */
  shortfall: string
  severity: 'warning' | 'critical'
}

/** A trust ledger transaction row, with optional running balance. */
export interface TrustLedgerEntry {
  id: string
  type: 'deposit' | 'withdrawal'
  amount: string
  memo: string | null
  occurredAt: Date
  /** Account balance (numeric string) AFTER this transaction, chronologically. */
  runningBalance: string
}

/** A trust account plus its full ledger (newest first). */
export interface TrustAccountLedger {
  account: TrustAccountSummary
  transactions: Array<TrustLedgerEntry>
}

// --- Internal computation --------------------------------------------------

/**
 * Load the firm's trust accounts + transactions and aggregate per-account
 * balances in integer cents. Shared by listTrustAccounts() and getTrustFlags()
 * so both widgets always agree.
 */
async function computeFirmTrustSummaries(
  firmId: string,
): Promise<Array<TrustAccountSummary>> {
  const accounts = await db
    .select({
      id: trustAccounts.id,
      name: trustAccounts.name,
      minimumBalance: trustAccounts.minimumBalance,
      matterId: trustAccounts.matterId,
      matterName: matters.name,
      clientId: trustAccounts.clientId,
      clientName: clients.name,
    })
    .from(trustAccounts)
    .leftJoin(matters, eq(matters.id, trustAccounts.matterId))
    .leftJoin(clients, eq(clients.id, trustAccounts.clientId))
    .where(eq(trustAccounts.firmId, firmId))
    .orderBy(asc(trustAccounts.name))

  const txns = await db
    .select({
      trustAccountId: trustTransactions.trustAccountId,
      type: trustTransactions.type,
      amount: trustTransactions.amount,
    })
    .from(trustTransactions)
    .where(eq(trustTransactions.firmId, firmId))

  // Aggregate balances (in cents) and counts per account in JS — exact.
  const balanceCentsByAccount = new Map<string, number>()
  const countByAccount = new Map<string, number>()
  for (const txn of txns) {
    const cents = toCents(txn.amount)
    const delta = txn.type === 'deposit' ? cents : -cents
    balanceCentsByAccount.set(
      txn.trustAccountId,
      (balanceCentsByAccount.get(txn.trustAccountId) ?? 0) + delta,
    )
    countByAccount.set(
      txn.trustAccountId,
      (countByAccount.get(txn.trustAccountId) ?? 0) + 1,
    )
  }

  return accounts.map((a) => {
    const balanceCents = balanceCentsByAccount.get(a.id) ?? 0
    const minimumCents = toCents(a.minimumBalance)
    return {
      id: a.id,
      name: a.name,
      minimumBalance: a.minimumBalance,
      matterId: a.matterId,
      matterName: a.matterName,
      clientId: a.clientId,
      clientName: a.clientName,
      balance: centsToString(balanceCents),
      balanceCents,
      belowMinimum: balanceCents < minimumCents,
      transactionCount: countByAccount.get(a.id) ?? 0,
    }
  })
}

// --- Server functions ------------------------------------------------------

/**
 * listTrustAccounts() → TrustAccountSummary[]
 * Every firm trust account with its DERIVED balance, join names, and
 * below-minimum flag. Ordered by name.
 */
export const listTrustAccounts = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<TrustAccountSummary>> => {
    const { firmId } = getSession()
    return computeFirmTrustSummaries(firmId)
  },
)

/**
 * getTrustFlags() → TrustFlag[]
 * DERIVED alerts for the dashboard "Trust Flags" widget: only accounts whose
 * derived balance has fallen below their configured minimum. Severity is
 * 'critical' when the balance is non-positive OR the shortfall exceeds 50% of
 * the minimum; otherwise 'warning'.
 */
export const getTrustFlags = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<TrustFlag>> => {
    const { firmId } = getSession()
    const summaries = await computeFirmTrustSummaries(firmId)

    const flags: Array<TrustFlag> = []
    for (const s of summaries) {
      if (!s.belowMinimum) continue

      const minimumCents = toCents(s.minimumBalance)
      const shortfallCents = Math.max(0, minimumCents - s.balanceCents)
      const critical =
        s.balanceCents <= 0 ||
        (minimumCents > 0 && shortfallCents * 2 > minimumCents)

      flags.push({
        accountId: s.id,
        accountName: s.name,
        matterName: s.matterName,
        balance: s.balance,
        minimumBalance: s.minimumBalance,
        shortfall: centsToString(shortfallCents),
        severity: critical ? 'critical' : 'warning',
      })
    }

    return flags
  },
)

/**
 * getTrustAccountLedger({ accountId }) → TrustAccountLedger
 * One firm-scoped trust account plus its transactions, newest first, each row
 * carrying the running balance AFTER it (computed chronologically in cents).
 */
export const getTrustAccountLedger = createServerFn({ method: 'GET' })
  .validator(ledgerSchema)
  .handler(async ({ data }): Promise<TrustAccountLedger> => {
    const { firmId } = getSession()

    const summaries = await computeFirmTrustSummaries(firmId)
    const account = summaries.find((s) => s.id === data.accountId)
    // Firm-scoped: only accounts owned by this firm are in `summaries`.
    if (!account) throw new Error('Trust account not found')

    // Oldest-first to accumulate the running balance, then present newest-first.
    const rows = await db
      .select({
        id: trustTransactions.id,
        type: trustTransactions.type,
        amount: trustTransactions.amount,
        memo: trustTransactions.memo,
        occurredAt: trustTransactions.occurredAt,
      })
      .from(trustTransactions)
      .where(
        and(
          eq(trustTransactions.firmId, firmId),
          eq(trustTransactions.trustAccountId, data.accountId),
        ),
      )
      .orderBy(asc(trustTransactions.occurredAt))

    let runningCents = 0
    const chronological: Array<TrustLedgerEntry> = rows.map((r) => {
      const cents = toCents(r.amount)
      runningCents += r.type === 'deposit' ? cents : -cents
      return {
        id: r.id,
        type: r.type,
        amount: r.amount,
        memo: r.memo,
        occurredAt: r.occurredAt,
        runningBalance: centsToString(runningCents),
      }
    })

    return {
      account,
      transactions: chronological.reverse(),
    }
  })

/**
 * createTrustAccount({ name, matterId?, clientId?, minimumBalance? }) →
 *   TrustAccount
 * Inserts a firm-scoped trust account. Write-guarded.
 */
export const createTrustAccount = createServerFn({ method: 'POST' })
  .validator(createTrustAccountSchema)
  .handler(async ({ data }): Promise<TrustAccount> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    const [row] = await db
      .insert(trustAccounts)
      .values({
        firmId,
        name: data.name,
        matterId: data.matterId ?? null,
        clientId: data.clientId ?? null,
        minimumBalance: data.minimumBalance,
      })
      .returning()

    return row
  })

/**
 * createTrustTransaction({ trustAccountId, type, amount, memo?, occurredAt? }) →
 *   TrustTransaction
 * Records a deposit/withdrawal against a firm-owned trust account. The account
 * is verified to belong to the firm before inserting. Write-guarded.
 */
export const createTrustTransaction = createServerFn({ method: 'POST' })
  .validator(createTrustTransactionSchema)
  .handler(async ({ data }): Promise<TrustTransaction> => {
    const { firmId, role } = getSession()
    if (!can(role, 'write')) throw new Error('Forbidden')

    // Verify the account is firm-scoped before writing to its ledger.
    const [account] = await db
      .select({ id: trustAccounts.id })
      .from(trustAccounts)
      .where(
        and(
          eq(trustAccounts.id, data.trustAccountId),
          eq(trustAccounts.firmId, firmId),
        ),
      )
      .limit(1)
    if (!account) throw new Error('Trust account not found')

    const [row] = await db
      .insert(trustTransactions)
      .values({
        firmId,
        trustAccountId: data.trustAccountId,
        type: data.type,
        amount: data.amount,
        memo: data.memo ?? null,
        occurredAt: data.occurredAt,
      })
      .returning()

    return row
  })
