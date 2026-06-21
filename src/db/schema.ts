import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const billableStatus = pgEnum('billable_status', [
  'billable',
  'non_billable',
  'no_charge',
])

// Invoice lifecycle. "overdue" is NOT a stored status — it is derived as an
// `unpaid` invoice whose `dueAt` is in the past (see server/dashboard.ts).
export const invoiceStatus = pgEnum('invoice_status', [
  'draft', // being assembled, not yet issued
  'pending', // awaiting internal approval before it can be issued
  'unpaid', // issued to the client, awaiting payment
  'paid', // settled
  'void', // cancelled
])

// Task priority for the "Today's Agenda" widget.
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high'])

// Task lifecycle. A task is either open or done; completedAt is set when done.
export const taskStatus = pgEnum('task_status', ['open', 'done'])

// Calendar event categories for the "Calendar" widget.
export const eventType = pgEnum('event_type', [
  'deposition',
  'hearing',
  'meeting',
  'deadline',
  'other',
])

// Trust ledger entry direction. Current balance is DERIVED by summing
// deposits minus withdrawals — never stored.
export const trustTxnType = pgEnum('trust_txn_type', ['deposit', 'withdrawal'])

// Activity category kind. A "time entry" category is a billable activity with a
// default hourly rate (e.g. Drafting); an "expense" category is a billable cost
// with a default unit price (e.g. Filing Fees). Mirrors Clio's two category tabs.
export const activityCategoryType = pgEnum('activity_category_type', [
  'time_entry',
  'expense',
])

// How a category's lines are taxed on an invoice. "default" = inherit whatever
// tax the invoice applies; "none" = always tax-exempt. (Clio also supports
// naming a specific tax — out of scope until we model tax entities.)
export const activityTaxTreatment = pgEnum('activity_tax_treatment', [
  'default',
  'none',
])

// ---------------------------------------------------------------------------
// Tables (reproduced exactly from STACK.md §4)
//
// Multi-tenant: every table carries `firmId` and every query MUST be scoped by
// it. Never trust a client-supplied firmId.
// ---------------------------------------------------------------------------

export const firms = pgTable('firms', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  minuteIncrement: integer('minute_increment').default(6).notNull(), // billing rounding increment
})

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(), // attorney | paralegal | admin | client
  defaultRate: numeric('default_rate', { precision: 10, scale: 2 }),
  // Personal performance goal: billable hours the user aims to log per working
  // day. The single source of truth for every dashboard "target"/"expected"
  // number — multiplied by defaultRate it also yields the revenue targets and
  // the annual report's target line. Edited via /settings/performance.
  targetBillableHoursPerDay: numeric('target_billable_hours_per_day', {
    precision: 5,
    scale: 2,
  })
    .default('8.00')
    .notNull(),
  // Personal revenue goal: the dollars the user aims to bill per MONTH. When
  // set (> 0) it drives the dashboard's Financial Metrics "Target"/"expected"
  // bars and the Annual Report target line (annual = 12× monthly), instead of
  // deriving those from the hours goal × rate. 0 = fall back to the hours goal.
  // Edited via /settings/performance. (MONEY RULE — numeric string.)
  targetRevenuePerMonth: numeric('target_revenue_per_month', {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default('0'),
})

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  name: text('name').notNull(),
})

export const matters = pgTable('matters', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  name: text('name').notNull(),
  responsibleAttorneyId: uuid('responsible_attorney_id').references(
    () => users.id,
  ),
  status: text('status').notNull().default('active'),
  rate: numeric('rate', { precision: 10, scale: 2 }), // per-matter rate override
})

// joint matters → many-to-many
export const matterClients = pgTable('matter_clients', {
  matterId: uuid('matter_id')
    .references(() => matters.id)
    .notNull(),
  clientId: uuid('client_id')
    .references(() => clients.id)
    .notNull(),
})

// Activity categories — the firm's reusable, PRE-CONFIGURED billing items.
// Each is either a time-entry activity (default hourly rate) or an expense
// (default unit price). Seeded with a default set per firm so the list is never
// empty on day one (see src/db/seed.ts → defaultActivityCategories). Managed at
// /settings/categories; picked when logging time to auto-fill the rate.
export const activityCategories = pgTable('activity_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  type: activityCategoryType('type').notNull(),
  name: text('name').notNull(),
  // ISO 4217 currency code for the default rate (e.g. "USD"). Display-level for
  // the prototype — billing math stays in the firm's single currency.
  currency: text('currency').default('USD').notNull(),
  // Default hourly rate (time entry) or unit price (expense). MONEY RULE —
  // numeric string, never a float.
  rate: numeric('rate', { precision: 10, scale: 2 }).default('0.00').notNull(),
  taxTreatment: activityTaxTreatment('tax_treatment')
    .default('default')
    .notNull(),
  // Who may use this category. STUB: free-text ("Everyone") until permission
  // groups are modelled. Stored so the field round-trips through the form.
  permissionGroups: text('permission_groups').default('Everyone').notNull(),
  // Archived categories are hidden from pickers but kept for historical entries.
  archived: boolean('archived').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  matterId: uuid('matter_id').references(() => matters.id),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  date: timestamp('date').defaultNow().notNull(),
  narrative: text('narrative'),
  // Denormalized activity-category NAME (kept for list views / legacy free-text
  // entries). `activityCategoryId` is the structured link when one was picked.
  activity: text('activity'), // activity category
  activityCategoryId: uuid('activity_category_id').references(
    () => activityCategories.id,
  ),
  billable: billableStatus('billable').default('billable').notNull(),
  rate: numeric('rate', { precision: 10, scale: 2 }),
  durationSeconds: integer('duration_seconds').default(0).notNull(), // raw tracked seconds
  startedAt: timestamp('started_at'), // set while a timer is running
  running: boolean('running').default(false).notNull(),
  // null = unbilled WIP; set = attached to an invoice (billed/locked).
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  // Who the bill is for. Nullable so an invoice can exist before being attached
  // (kept simple for the prototype).
  clientId: uuid('client_id').references(() => clients.id),
  matterId: uuid('matter_id').references(() => matters.id),
  number: text('number').notNull(), // human invoice number, e.g. "INV-1001"
  status: invoiceStatus('status').default('draft').notNull(),
  // Invoice total as a numeric string (MONEY RULE — never a float).
  total: numeric('total', { precision: 12, scale: 2 })
    .default('0.00')
    .notNull(),
  issuedAt: timestamp('issued_at'), // null while draft/pending
  dueAt: timestamp('due_at'), // payment due date; past + unpaid = overdue
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Tasks — drive the "Today's Agenda" widget. Assigned to a user, optionally
// scoped to a matter.
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(), // assignee
  matterId: uuid('matter_id').references(() => matters.id),
  title: text('title').notNull(),
  notes: text('notes'),
  priority: taskPriority('priority').default('normal').notNull(),
  status: taskStatus('status').default('open').notNull(),
  dueAt: timestamp('due_at'),
  completedAt: timestamp('completed_at'), // set when status flips to "done"
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Calendar events — drive the "Calendar" widget. Optionally scoped to a matter.
export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  matterId: uuid('matter_id').references(() => matters.id),
  title: text('title').notNull(),
  eventType: eventType('event_type').default('other').notNull(),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at'), // null for all-day / point-in-time events
  location: text('location'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Trust accounts — drive the "Trust Flags" widget. Current balance is DERIVED
// from trustTransactions (sum of deposits − withdrawals); never stored here.
export const trustAccounts = pgTable('trust_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  matterId: uuid('matter_id').references(() => matters.id),
  clientId: uuid('client_id').references(() => clients.id),
  name: text('name').notNull(),
  // Below this derived balance the account is "flagged" (MONEY RULE — string).
  minimumBalance: numeric('minimum_balance', { precision: 12, scale: 2 })
    .default('0')
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Trust ledger — deposits/withdrawals against a trust account. `amount` is a
// positive numeric string; direction is given by `type`.
export const trustTransactions = pgTable('trust_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  firmId: uuid('firm_id')
    .references(() => firms.id)
    .notNull(),
  trustAccountId: uuid('trust_account_id')
    .references(() => trustAccounts.id)
    .notNull(),
  type: trustTxnType('type').notNull(),
  // Always a positive value (MONEY RULE — never a float).
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  memo: text('memo'),
  occurredAt: timestamp('occurred_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Relations — make joins ergonomic for query-builder usage.
// ---------------------------------------------------------------------------

export const firmsRelations = relations(firms, ({ many }) => ({
  users: many(users),
  clients: many(clients),
  matters: many(matters),
  activityCategories: many(activityCategories),
  timeEntries: many(timeEntries),
  invoices: many(invoices),
  tasks: many(tasks),
  calendarEvents: many(calendarEvents),
  trustAccounts: many(trustAccounts),
  trustTransactions: many(trustTransactions),
}))

export const activityCategoriesRelations = relations(
  activityCategories,
  ({ one, many }) => ({
    firm: one(firms, {
      fields: [activityCategories.firmId],
      references: [firms.id],
    }),
    timeEntries: many(timeEntries),
  }),
)

export const usersRelations = relations(users, ({ one, many }) => ({
  firm: one(firms, {
    fields: [users.firmId],
    references: [firms.id],
  }),
  timeEntries: many(timeEntries),
  // matters for which this user is the responsible attorney
  responsibleMatters: many(matters),
  // tasks assigned to this user
  tasks: many(tasks),
}))

export const clientsRelations = relations(clients, ({ one, many }) => ({
  firm: one(firms, {
    fields: [clients.firmId],
    references: [firms.id],
  }),
  matterClients: many(matterClients),
  trustAccounts: many(trustAccounts),
}))

export const mattersRelations = relations(matters, ({ one, many }) => ({
  firm: one(firms, {
    fields: [matters.firmId],
    references: [firms.id],
  }),
  responsibleAttorney: one(users, {
    fields: [matters.responsibleAttorneyId],
    references: [users.id],
  }),
  timeEntries: many(timeEntries),
  matterClients: many(matterClients),
  tasks: many(tasks),
  calendarEvents: many(calendarEvents),
  trustAccounts: many(trustAccounts),
}))

export const matterClientsRelations = relations(matterClients, ({ one }) => ({
  matter: one(matters, {
    fields: [matterClients.matterId],
    references: [matters.id],
  }),
  client: one(clients, {
    fields: [matterClients.clientId],
    references: [clients.id],
  }),
}))

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  firm: one(firms, {
    fields: [timeEntries.firmId],
    references: [firms.id],
  }),
  matter: one(matters, {
    fields: [timeEntries.matterId],
    references: [matters.id],
  }),
  activityCategory: one(activityCategories, {
    fields: [timeEntries.activityCategoryId],
    references: [activityCategories.id],
  }),
  user: one(users, {
    fields: [timeEntries.userId],
    references: [users.id],
  }),
  invoice: one(invoices, {
    fields: [timeEntries.invoiceId],
    references: [invoices.id],
  }),
}))

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  firm: one(firms, {
    fields: [invoices.firmId],
    references: [firms.id],
  }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  matter: one(matters, {
    fields: [invoices.matterId],
    references: [matters.id],
  }),
  timeEntries: many(timeEntries),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  firm: one(firms, {
    fields: [tasks.firmId],
    references: [firms.id],
  }),
  user: one(users, {
    fields: [tasks.userId],
    references: [users.id],
  }),
  matter: one(matters, {
    fields: [tasks.matterId],
    references: [matters.id],
  }),
}))

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  firm: one(firms, {
    fields: [calendarEvents.firmId],
    references: [firms.id],
  }),
  matter: one(matters, {
    fields: [calendarEvents.matterId],
    references: [matters.id],
  }),
}))

export const trustAccountsRelations = relations(
  trustAccounts,
  ({ one, many }) => ({
    firm: one(firms, {
      fields: [trustAccounts.firmId],
      references: [firms.id],
    }),
    matter: one(matters, {
      fields: [trustAccounts.matterId],
      references: [matters.id],
    }),
    client: one(clients, {
      fields: [trustAccounts.clientId],
      references: [clients.id],
    }),
    transactions: many(trustTransactions),
  }),
)

export const trustTransactionsRelations = relations(
  trustTransactions,
  ({ one }) => ({
    firm: one(firms, {
      fields: [trustTransactions.firmId],
      references: [firms.id],
    }),
    trustAccount: one(trustAccounts, {
      fields: [trustTransactions.trustAccountId],
      references: [trustAccounts.id],
    }),
  }),
)

// ---------------------------------------------------------------------------
// Inferred row types (convenience for services / server fns / UI).
// ---------------------------------------------------------------------------

export type Firm = typeof firms.$inferSelect
export type NewFirm = typeof firms.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
export type Matter = typeof matters.$inferSelect
export type NewMatter = typeof matters.$inferInsert
export type MatterClient = typeof matterClients.$inferSelect
export type NewMatterClient = typeof matterClients.$inferInsert
export type ActivityCategory = typeof activityCategories.$inferSelect
export type NewActivityCategory = typeof activityCategories.$inferInsert
export type TimeEntry = typeof timeEntries.$inferSelect
export type NewTimeEntry = typeof timeEntries.$inferInsert
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type CalendarEvent = typeof calendarEvents.$inferSelect
export type NewCalendarEvent = typeof calendarEvents.$inferInsert
export type TrustAccount = typeof trustAccounts.$inferSelect
export type NewTrustAccount = typeof trustAccounts.$inferInsert
export type TrustTransaction = typeof trustTransactions.$inferSelect
export type NewTrustTransaction = typeof trustTransactions.$inferInsert
export type BillableStatus = (typeof billableStatus.enumValues)[number]
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number]
export type TaskPriority = (typeof taskPriority.enumValues)[number]
export type TaskStatus = (typeof taskStatus.enumValues)[number]
export type EventType = (typeof eventType.enumValues)[number]
export type TrustTxnType = (typeof trustTxnType.enumValues)[number]
export type ActivityCategoryType =
  (typeof activityCategoryType.enumValues)[number]
export type ActivityTaxTreatment =
  (typeof activityTaxTreatment.enumValues)[number]
