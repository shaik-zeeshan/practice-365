# Practice365 — Stack & Scaffold Spec

> Context doc for an AI coding tool. This defines the tech stack, conventions, schema, and the
> **prototype feature** to build first. Read this fully before generating any code.
> Product: a Practice Management / Client-Matter CRM for solo & small law firms (a Clio Manage–style app).

---

## 1. Tech stack (use exactly this — do not substitute)

| Concern         | Choice                                 | Notes                                                                              |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Framework       | **TanStack Start** (React, full-stack) | File-based routing via TanStack Router. This satisfies "React + Node."             |
| Language        | **TypeScript** (strict)                |                                                                                    |
| ORM             | **Drizzle ORM** + **drizzle-kit**      | Schema-in-TS. NOT Prisma.                                                          |
| Database        | **PostgreSQL**                         | Local: Docker Postgres. Prod: Neon (serverless). NOT SQLite.                       |
| Data fetching   | **TanStack Query**                     | Pairs with route loaders + server functions.                                       |
| Server logic    | **`createServerFn()`**                 | Type-safe RPC. Auth/validation happens _inside_ the server fn, not middleware.     |
| Validation      | **Zod**                                | Validate every server-fn input.                                                    |
| Styling         | **Tailwind CSS**                       |                                                                                    |
| UI components   | **shadcn/ui**                          | Dense, table-heavy legal UI. Use Table, Dialog, Form, Select, Popover, Tabs.       |
| Client state    | **Zustand**                            | For the global timer store (persisted to localStorage).                            |
| Auth            | **Auth.js (NextAuth core)**            | Two user types: firm staff vs. portal clients. Stub for the prototype, real later. |
| Deployment      | **Vercel** (web) + **Neon** (db)       | Nitro Vercel preset.                                                               |
| Package manager | **pnpm**                               |                                                                                    |

> Webhooks (e-sign, payments — later, not in prototype) use **server routes** in `src/routes/api/*`,
> everything else uses `createServerFn`.

---

## 2. What to build FIRST — the prototype

Build **only** these two things for the first deployable demo:

1. **Firm dashboard** — a widget grid (Clio home dashboard style):
   - Firm Feed (recent activity), Today's Agenda (tasks/events), Bills (outstanding/WIP),
     Activities (recent time entries), Calendar (upcoming), Trust flags.
   - Seeded/mocked data is fine for the widgets **except** the Activities widget, which must
     read real `time_entries` from the DB.
2. **Global time tracking timer** — the centerpiece. See full spec in §5.

Everything else (leads, clients, matters CRUD, documents, portal, e-sign, invoicing) is **out of scope
for the prototype** — stub or omit. Do not build it yet.

---

## 3. Folder structure

```
practice365/
├─ src/
│  ├─ routes/
│  │  ├─ __root.tsx                 # header + <GlobalTimer/> mounts here (persists across routes)
│  │  ├─ index.tsx                  # redirect → /dashboard
│  │  ├─ dashboard.tsx
│  │  ├─ time.tsx                   # time entries list view
│  │  └─ api/                       # server routes for raw webhooks (later)
│  ├─ server/                       # createServerFn handlers
│  │  └─ time-entries.ts
│  ├─ lib/
│  │  ├─ services/                  # domain logic (rounding, billing) — pure, testable
│  │  ├─ auth.ts  tenant.ts  rbac.ts
│  │  └─ rounding.ts
│  ├─ stores/
│  │  └─ timer.ts                   # Zustand timer store (localStorage-persisted)
│  ├─ components/
│  │  ├─ ui/                        # shadcn primitives
│  │  ├─ timer/                     # GlobalTimer, TimekeeperPopover, TimeEntryModal
│  │  └─ dashboard/                 # widget components
│  └─ db/
│     ├─ schema.ts                  # Drizzle schema (see §4)
│     ├─ seed.ts                    # one firm, users, a few matters, sample time entries
│     └─ index.ts                   # drizzle client
├─ drizzle/                         # generated migrations
├─ drizzle.config.ts
├─ .env.example                     # DATABASE_URL, AUTH_SECRET
└─ package.json
```

---

## 4. Database schema (Drizzle — `src/db/schema.ts`)

Multi-tenant: **every table has `firmId`** and **every query is scoped by it**. Non-negotiable.

```ts
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

export const billableStatus = pgEnum('billable_status', [
  'billable',
  'non_billable',
  'no_charge',
])

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
  activity: text('activity'), // activity category
  billable: billableStatus('billable').default('billable').notNull(),
  rate: numeric('rate', { precision: 10, scale: 2 }),
  durationSeconds: integer('duration_seconds').default(0).notNull(), // raw tracked seconds
  startedAt: timestamp('started_at'), // set while a timer is running
  running: boolean('running').default(false).notNull(),
  invoiceId: uuid('invoice_id'), // null = unbilled WIP; set = billed/locked
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

Notes for the implementer:

- `numeric` returns **strings** in JS — do money math carefully; never use floats for currency.
- Define relations with Drizzle's `relations()` helper (or explicit joins).
- Generate/apply migrations with `drizzle-kit generate` then `drizzle-kit migrate`.
- The **future** full schema also needs: leads, lead_conversions, retainers, trust_ledger,
  matter_timeline, notes, documents+versions, calendar_events, billing_rates, expenses,
  invoices+line_items, payments, intake_submissions, messages, esign_requests+audit,
  custom_field_defs+values. **Do not build these for the prototype.**

---

## 5. Timer feature spec (build to match this exactly)

The timer is the demo's centerpiece — model it on Clio's global header timer.

**Behavior:**

1. **Global header timer**: a play/pause button in the app header, present on every screen. Mount it in `__root.tsx`.
2. **Start from anywhere** → opens a "New time entry" modal. User can fill matter/narrative now or later.
3. **Persists across navigation AND reload**: closing the modal keeps the timer running in the header
   showing live elapsed time (`HH:MM:SS`). Use the Zustand store persisted to `localStorage`.
4. **Timekeeper popover**: a clock icon beside the timer opens a panel listing **today's** time entries;
   restart a stopped entry's timer (resumes, adds to existing duration), edit, or create new.
5. **Multiple timers**: each time entry is its own timer object. Pausing one and starting another is allowed;
   the header surfaces the currently running one. Only one accumulates at a time.
6. **Timed OR manual**: user can run the timer or type a duration by hand (decimal `0.5` or `H:MM`).
7. **Stop → save**: persist the entry; it becomes unbilled WIP (`invoiceId = null`).

**Time entry modal fields:** date (default today), matter (select → resolves client; required to bill),
activity/category, narrative, billable status (billable / non_billable / no_charge),
rate (default from user or matter, overridable), quantity (hours; from timer or manual),
amount (derived = `rounded(quantity) × rate`).

**Rounding (server-side, in `lib/rounding.ts`):** billed quantity =
`ceil( (durationSeconds / 60) / minuteIncrement ) × minuteIncrement / 60` hours,
using the firm's `minuteIncrement`. Round at bill time; store raw `durationSeconds`.

**Persistence flow:**

- Timer state in Zustand: `{ entryId, startedAt, accumulatedSeconds, running, matterId, narrative }`,
  persisted to `localStorage`.
- On **start**: `createServerFn` upserts a `time_entries` row with `running = true`, `startedAt = now`.
- On **stop**: `createServerFn` sets `running = false` and writes accumulated `durationSeconds`.
- This gives real DB records + cross-reload "Timer Active" persistence.

---

## 6. Conventions & guardrails

- **Tenant isolation**: every DB query filters by `firmId` from the session. Never trust a client-supplied `firmId`.
- **Validate every server-fn input with Zod.** Auth check happens inside the server fn.
- **Domain logic lives in `lib/services/`** (pure functions), not in components or route files.
  Rounding, and later: lead→client conversion, invoice generation, trust-ledger writes.
- **Money**: integer cents or `numeric` strings + a decimal lib. No floats.
- **Seed script** must create: 1 firm (minuteIncrement 6), 2–3 users with rates, 2 clients,
  3 matters, ~5 sample time entries — so the dashboard and time list render with real data.
- Keep the prototype shippable to **Vercel** with a single `pnpm build`.

---

## 7. Acceptance criteria for the prototype

- [ ] App deploys to Vercel; dashboard loads with seeded data.
- [ ] Header timer starts/stops from any screen and keeps running across route changes **and** page reload.
- [ ] Stopping the timer opens/saves a time entry linked to a matter, persisted in Postgres.
- [ ] Timekeeper popover lists today's entries and can restart a stopped one.
- [ ] Manual time entry (typed duration) works in addition to the timer.
- [ ] Time list view (`/time`) shows entries with matter, duration, billable status, rate, amount.
- [ ] Amounts reflect firm rounding (`minuteIncrement`).
