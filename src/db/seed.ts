import 'dotenv/config'
import { db, pool } from '@/db'
import {
  firms,
  users,
  clients,
  matters,
  matterClients,
  activityCategories,
  timeEntries,
  invoices,
  tasks,
  calendarEvents,
  trustAccounts,
  trustTransactions,
} from '@/db/schema'
import type { NewActivityCategory } from '@/db/schema'
import { DEMO_FIRM_ID, DEMO_USER_ID } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Seed script (idempotent-ish: clears the relevant tables, then inserts).
//
// Demo ids are imported from @/lib/auth so the firm + primary user line up with
// the stub session (getSession() resolves to real rows).
//
// Creates (STACK.md §6):
//   - 1 firm (minuteIncrement 6, slug "practice365"), id = DEMO_FIRM_ID
//   - 3 users with defaultRates; primary = DEMO_USER_ID (attorney)
//   - 2 clients, 3 matters (one with per-matter rate override), linked via
//     matterClients, with responsibleAttorneyId set
//   - ~5 time entries across matters/users, varied durations / billable status /
//     dates (a couple TODAY), invoiceId null, each with a rate.
// ---------------------------------------------------------------------------

// Fixed ids for deterministic, re-runnable seeds.
const USER_PARALEGAL_ID = '00000000-0000-4000-8000-000000000003'
const USER_ADMIN_ID = '00000000-0000-4000-8000-000000000004'

const CLIENT_ACME_ID = '00000000-0000-4000-8000-000000000010'
const CLIENT_GLOBEX_ID = '00000000-0000-4000-8000-000000000011'

const MATTER_1_ID = '00000000-0000-4000-8000-000000000020'
const MATTER_2_ID = '00000000-0000-4000-8000-000000000021'
const MATTER_3_ID = '00000000-0000-4000-8000-000000000022'

const INVOICE_1_ID = '00000000-0000-4000-8000-000000000030'
const INVOICE_2_ID = '00000000-0000-4000-8000-000000000031'
const INVOICE_3_ID = '00000000-0000-4000-8000-000000000032'
const INVOICE_4_ID = '00000000-0000-4000-8000-000000000033'
const INVOICE_5_ID = '00000000-0000-4000-8000-000000000034'

const TRUST_ACCOUNT_1_ID = '00000000-0000-4000-8000-000000000040' // healthy
const TRUST_ACCOUNT_2_ID = '00000000-0000-4000-8000-000000000041' // flagged (below min)

function atTime(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** A date `daysAgo` days before now (negative = in the future), noon. */
function dayOffset(daysAgo: number): Date {
  return atTime(daysAgo, 12, 0)
}

/**
 * The PRE-CONFIGURED activity categories a firm starts with — so the
 * /settings/categories list is never empty on day one (the Clio behaviour the
 * product asked for). Time-entry categories carry a default hourly rate;
 * expense categories carry a default unit price. All in USD, taxed per the
 * invoice's default, usable by Everyone.
 */
function defaultActivityCategories(firmId: string): Array<NewActivityCategory> {
  const timeEntry: Array<[string, string]> = [
    ['Drafting', '300.00'],
    ['Review/Analyze', '300.00'],
    ['Legal Research', '300.00'],
    ['Correspondence', '250.00'],
    ['Communicate (Client)', '250.00'],
    ['Communicate (Opposing Counsel)', '300.00'],
    ['Court Appearance', '350.00'],
    ['Deposition', '350.00'],
    ['Filing', '150.00'],
    ['Travel', '150.00'],
    ['Conference/Meeting', '300.00'],
  ]
  const expense: Array<[string, string]> = [
    ['Filing Fees', '0.00'],
    ['Court Fees', '0.00'],
    ['Copying/Printing', '0.25'],
    ['Postage', '0.00'],
    ['Courier/Delivery', '0.00'],
    ['Expert Witness Fees', '0.00'],
    ['Mileage', '0.67'],
    ['Telephone/Fax', '0.00'],
  ]

  return [
    ...timeEntry.map(
      ([name, rate]): NewActivityCategory => ({
        firmId,
        type: 'time_entry',
        name,
        rate,
      }),
    ),
    ...expense.map(
      ([name, rate]): NewActivityCategory => ({
        firmId,
        type: 'expense',
        name,
        rate,
      }),
    ),
  ]
}

async function seed() {
  console.log('Seeding database...')

  // Clear in FK-safe order (timeEntries → invoices → … ; timeEntries.invoiceId
  // references invoices, and invoices reference clients/matters). The new
  // tables reference matters/clients/users/firm, so clear them up front:
  // trustTransactions → trustAccounts, plus tasks and calendarEvents.
  await db.delete(trustTransactions)
  await db.delete(trustAccounts)
  await db.delete(tasks)
  await db.delete(calendarEvents)
  await db.delete(timeEntries)
  await db.delete(activityCategories)
  await db.delete(invoices)
  await db.delete(matterClients)
  await db.delete(matters)
  await db.delete(clients)
  await db.delete(users)
  await db.delete(firms)

  // Firm
  await db.insert(firms).values({
    id: DEMO_FIRM_ID,
    name: 'Practice365 Law',
    slug: 'practice365',
    minuteIncrement: 6,
  })

  // Users
  await db.insert(users).values([
    {
      id: DEMO_USER_ID,
      firmId: DEMO_FIRM_ID,
      email: 'attorney@practice365.test',
      name: 'Dana Attorney',
      role: 'attorney',
      defaultRate: '300.00',
      targetBillableHoursPerDay: '8.00',
      targetRevenuePerMonth: '45000.00',
    },
    {
      id: USER_PARALEGAL_ID,
      firmId: DEMO_FIRM_ID,
      email: 'paralegal@practice365.test',
      name: 'Sam Paralegal',
      role: 'paralegal',
      defaultRate: '150.00',
      targetBillableHoursPerDay: '6.00',
      targetRevenuePerMonth: '0',
    },
    {
      id: USER_ADMIN_ID,
      firmId: DEMO_FIRM_ID,
      email: 'admin@practice365.test',
      name: 'Alex Admin',
      role: 'admin',
      defaultRate: '0.00',
      targetBillableHoursPerDay: '0.00',
      targetRevenuePerMonth: '0',
    },
  ])

  // Clients
  await db.insert(clients).values([
    { id: CLIENT_ACME_ID, firmId: DEMO_FIRM_ID, name: 'Acme Corp' },
    { id: CLIENT_GLOBEX_ID, firmId: DEMO_FIRM_ID, name: 'Globex LLC' },
  ])

  // Matters (matter 3 has a per-matter rate override)
  await db.insert(matters).values([
    {
      id: MATTER_1_ID,
      firmId: DEMO_FIRM_ID,
      name: 'Acme — Contract Review',
      responsibleAttorneyId: DEMO_USER_ID,
      status: 'active',
      rate: null, // falls back to user defaultRate
    },
    {
      id: MATTER_2_ID,
      firmId: DEMO_FIRM_ID,
      name: 'Globex — Trademark Filing',
      responsibleAttorneyId: DEMO_USER_ID,
      status: 'active',
      rate: null,
    },
    {
      id: MATTER_3_ID,
      firmId: DEMO_FIRM_ID,
      name: 'Acme — Litigation',
      responsibleAttorneyId: DEMO_USER_ID,
      status: 'active',
      rate: '350.00', // per-matter override
    },
  ])

  // Matter ↔ client links
  await db.insert(matterClients).values([
    { matterId: MATTER_1_ID, clientId: CLIENT_ACME_ID },
    { matterId: MATTER_2_ID, clientId: CLIENT_GLOBEX_ID },
    { matterId: MATTER_3_ID, clientId: CLIENT_ACME_ID },
  ])

  // Pre-configured activity categories (Clio-style) — the firm's starter set of
  // billable time-entry activities and expenses.
  await db
    .insert(activityCategories)
    .values(defaultActivityCategories(DEMO_FIRM_ID))

  // Invoices — drive the firm Billing Metrics block (Draft / Unpaid / Overdue).
  //   draft bucket (draft + pending) : INV-1004, INV-1005 → 2 bills, $2,750
  //   unpaid bucket                  : INV-1002, INV-1003 → 2 bills, $5,700
  //   overdue (unpaid & past due)    : INV-1002           → 1 bill,  $3,500
  await db.insert(invoices).values([
    {
      id: INVOICE_1_ID,
      firmId: DEMO_FIRM_ID,
      clientId: CLIENT_ACME_ID,
      matterId: MATTER_1_ID,
      number: 'INV-1001',
      status: 'paid',
      total: '1500.00',
      issuedAt: dayOffset(40),
      dueAt: dayOffset(10),
    },
    {
      id: INVOICE_2_ID,
      firmId: DEMO_FIRM_ID,
      clientId: CLIENT_ACME_ID,
      matterId: MATTER_3_ID,
      number: 'INV-1002',
      status: 'unpaid',
      total: '3500.00',
      issuedAt: dayOffset(20),
      dueAt: dayOffset(5), // past due → overdue
    },
    {
      id: INVOICE_3_ID,
      firmId: DEMO_FIRM_ID,
      clientId: CLIENT_GLOBEX_ID,
      matterId: MATTER_2_ID,
      number: 'INV-1003',
      status: 'unpaid',
      total: '2200.00',
      issuedAt: dayOffset(10),
      dueAt: dayOffset(-20), // due in 20 days → not yet overdue
    },
    {
      id: INVOICE_4_ID,
      firmId: DEMO_FIRM_ID,
      clientId: CLIENT_ACME_ID,
      matterId: MATTER_1_ID,
      number: 'INV-1004',
      status: 'draft',
      total: '1800.00',
    },
    {
      id: INVOICE_5_ID,
      firmId: DEMO_FIRM_ID,
      clientId: CLIENT_GLOBEX_ID,
      matterId: MATTER_2_ID,
      number: 'INV-1005',
      status: 'pending',
      total: '950.00',
    },
  ])

  // Time entries (~5). A couple dated TODAY for the popover / Activities widget.
  await db.insert(timeEntries).values([
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_1_ID,
      userId: DEMO_USER_ID,
      date: atTime(0, 9, 15), // today
      narrative: 'Review draft master services agreement',
      activity: 'Document Review',
      billable: 'billable',
      rate: '300.00',
      durationSeconds: 5400, // 1.5h
      running: false,
      invoiceId: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      userId: DEMO_USER_ID,
      date: atTime(0, 11, 30), // today
      narrative: 'Draft motion to compel',
      activity: 'Drafting',
      billable: 'billable',
      rate: '350.00',
      durationSeconds: 2700, // 0.75h
      running: false,
      invoiceId: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_2_ID,
      userId: USER_PARALEGAL_ID,
      date: atTime(1, 14, 0), // yesterday
      narrative: 'File trademark application with USPTO',
      activity: 'Filing',
      billable: 'billable',
      rate: '150.00',
      durationSeconds: 1800, // 0.5h
      running: false,
      invoiceId: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_1_ID,
      userId: USER_PARALEGAL_ID,
      date: atTime(2, 10, 45),
      narrative: 'Client intake call notes',
      activity: 'Communication',
      billable: 'non_billable',
      rate: '150.00',
      durationSeconds: 900, // 0.25h
      running: false,
      invoiceId: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      userId: DEMO_USER_ID,
      date: atTime(3, 16, 20),
      narrative: 'Courtesy strategy discussion (no charge)',
      activity: 'Conference',
      billable: 'no_charge',
      rate: '350.00',
      durationSeconds: 3660, // 1h 1m → tests rounding
      running: false,
      invoiceId: null,
    },
  ])

  // Historical billable entries for the attorney across the year, so the
  // Financial Metrics bars and the Detailed Annual Report show a real trend.
  // Prior-month work is marked billed (attached to the paid invoice); the
  // current month's work stays unbilled WIP via the entries above.
  const now = new Date()
  const year = now.getFullYear()
  const currentMonth = now.getMonth()
  const monthlyPattern = [
    {
      day: 8,
      seconds: 3 * 3600,
      narrative: 'Deposition preparation',
      activity: 'Litigation',
    },
    {
      day: 18,
      seconds: Math.round(2.5 * 3600),
      narrative: 'Contract negotiation',
      activity: 'Drafting',
    },
  ]
  const historical: Array<typeof timeEntries.$inferInsert> = []
  for (let m = 0; m < currentMonth; m++) {
    for (const p of monthlyPattern) {
      historical.push({
        firmId: DEMO_FIRM_ID,
        matterId: MATTER_1_ID,
        userId: DEMO_USER_ID,
        date: new Date(year, m, p.day, 12, 0, 0),
        narrative: p.narrative,
        activity: p.activity,
        billable: 'billable',
        rate: '300.00',
        durationSeconds: p.seconds,
        running: false,
        invoiceId: INVOICE_1_ID, // prior-month work = billed
      })
    }
  }
  if (historical.length > 0) {
    await db.insert(timeEntries).values(historical)
  }

  // Tasks — drive the "Today's Agenda" widget. Mix of priority, due dates
  // (a couple today / this week) and open/done status. All assigned to Dana.
  // Helpers: atTime(daysAgo, h, m) — positive daysAgo = past, negative = future.
  await db.insert(tasks).values([
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: MATTER_1_ID,
      title: 'Finalize Acme MSA redlines',
      notes: "Incorporate client comments from yesterday's call.",
      priority: 'high',
      status: 'open',
      dueAt: atTime(0, 16, 0), // today, late afternoon
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: MATTER_3_ID,
      title: 'File motion to compel',
      notes: 'Court deadline — do not slip.',
      priority: 'high',
      status: 'open',
      dueAt: atTime(0, 11, 0), // today, late morning
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: MATTER_2_ID,
      title: 'Respond to USPTO office action',
      priority: 'normal',
      status: 'open',
      dueAt: atTime(-3, 12, 0), // 3 days out (this week)
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: null,
      title: 'Update billing rate sheet',
      notes: 'Annual review of standard rates.',
      priority: 'low',
      status: 'open',
      dueAt: atTime(-6, 12, 0), // 6 days out
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: MATTER_1_ID,
      title: 'Send engagement letter to Acme',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(2, 12, 0), // was due 2 days ago
      completedAt: atTime(1, 15, 30), // completed yesterday
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: DEMO_USER_ID,
      matterId: MATTER_3_ID,
      title: 'Schedule deposition logistics',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(4, 12, 0),
      completedAt: atTime(3, 10, 0), // completed 3 days ago
    },
  ])

  // Calendar events — drive the "Calendar" widget. Upcoming over the next ~2
  // weeks, varied eventType, several linked to matters.
  await db.insert(calendarEvents).values([
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_1_ID,
      title: 'Acme contract negotiation call',
      eventType: 'meeting',
      startAt: atTime(-1, 10, 0), // tomorrow 10:00
      endAt: atTime(-1, 11, 0),
      location: 'Zoom',
      notes: 'Walk through final redlines with client.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      title: 'Discovery response deadline',
      eventType: 'deadline',
      startAt: atTime(-3, 17, 0), // 3 days out
      endAt: null,
      location: null,
      notes: 'Acme litigation — discovery responses due to opposing counsel.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      title: 'Deposition of opposing witness',
      eventType: 'deposition',
      startAt: atTime(-5, 9, 30), // 5 days out
      endAt: atTime(-5, 13, 0),
      location: 'Downtown Reporting, Suite 400',
      notes: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_2_ID,
      title: 'USPTO examiner interview',
      eventType: 'meeting',
      startAt: atTime(-8, 14, 0), // ~1 week out
      endAt: atTime(-8, 14, 30),
      location: 'Teleconference',
      notes: 'Globex trademark — discuss office action response.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      title: 'Motion hearing',
      eventType: 'hearing',
      startAt: atTime(-11, 9, 0), // ~11 days out
      endAt: atTime(-11, 10, 0),
      location: 'County Courthouse, Dept. 12',
      notes: 'Argue motion to compel.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: null,
      title: 'Firm monthly review',
      eventType: 'other',
      startAt: atTime(-13, 16, 0), // ~2 weeks out
      endAt: atTime(-13, 17, 0),
      location: 'Conference Room A',
      notes: null,
    },
  ])

  // Trust accounts — drive the "Trust Flags" widget. Balance is DERIVED from
  // trustTransactions (sum deposits − withdrawals). Account 1 (Acme Contract)
  // is healthy; Account 2 (Acme Litigation) is intentionally driven BELOW its
  // minimum so the widget has a real flag to show.
  await db.insert(trustAccounts).values([
    {
      id: TRUST_ACCOUNT_1_ID,
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_1_ID,
      clientId: CLIENT_ACME_ID,
      name: 'Acme Corp — Contract Review Trust',
      minimumBalance: '1000.00',
    },
    {
      id: TRUST_ACCOUNT_2_ID,
      firmId: DEMO_FIRM_ID,
      matterId: MATTER_3_ID,
      clientId: CLIENT_ACME_ID,
      name: 'Acme Corp — Litigation Trust',
      minimumBalance: '5000.00',
    },
  ])

  // Trust ledger.
  //   Account 1: 10,000 deposit − 2,500 − 1,200 = 6,300 (≥ 1,000 min) → healthy
  //   Account 2: 5,000 + 1,000 deposits − 1,500 − 3,800 = 700 (< 5,000) → FLAGGED
  await db.insert(trustTransactions).values([
    // Account 1 (healthy)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_1_ID,
      type: 'deposit',
      amount: '10000.00',
      memo: 'Initial retainer',
      occurredAt: atTime(45, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_1_ID,
      type: 'withdrawal',
      amount: '2500.00',
      memo: 'Applied to INV-1001',
      occurredAt: atTime(30, 10, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_1_ID,
      type: 'withdrawal',
      amount: '1200.00',
      memo: 'Filing fees',
      occurredAt: atTime(12, 14, 0),
    },
    // Account 2 (flagged — derived balance 700 < 5000 minimum)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_2_ID,
      type: 'deposit',
      amount: '5000.00',
      memo: 'Initial litigation retainer',
      occurredAt: atTime(50, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_2_ID,
      type: 'deposit',
      amount: '1000.00',
      memo: 'Top-up',
      occurredAt: atTime(20, 11, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_2_ID,
      type: 'withdrawal',
      amount: '1500.00',
      memo: 'Expert witness deposit',
      occurredAt: atTime(15, 13, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TRUST_ACCOUNT_2_ID,
      type: 'withdrawal',
      amount: '3800.00',
      memo: 'Applied to INV-1002',
      occurredAt: atTime(5, 16, 0),
    },
  ])

  // Counts
  const [firmCount] = await db.select().from(firms)
  const allUsers = await db.select().from(users)
  const allClients = await db.select().from(clients)
  const allMatters = await db.select().from(matters)
  const allCategories = await db.select().from(activityCategories)
  const allEntries = await db.select().from(timeEntries)
  const allInvoices = await db.select().from(invoices)
  const allTasks = await db.select().from(tasks)
  const allEvents = await db.select().from(calendarEvents)
  const allTrustAccounts = await db.select().from(trustAccounts)
  const allTrustTxns = await db.select().from(trustTransactions)

  console.log('Seed complete:')
  console.log(`  firms:              ${firmCount ? 1 : 0}`)
  console.log(`  users:              ${allUsers.length}`)
  console.log(`  clients:            ${allClients.length}`)
  console.log(`  matters:            ${allMatters.length}`)
  console.log(`  activity_categories:${allCategories.length}`)
  console.log(`  time_entries:       ${allEntries.length}`)
  console.log(`  invoices:           ${allInvoices.length}`)
  console.log(`  tasks:              ${allTasks.length}`)
  console.log(`  calendar_events:    ${allEvents.length}`)
  console.log(`  trust_accounts:     ${allTrustAccounts.length}`)
  console.log(`  trust_transactions: ${allTrustTxns.length}`)
}

seed()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Seed failed:', err)
    await pool.end()
    process.exit(1)
  })
