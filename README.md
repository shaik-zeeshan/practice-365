# Practice365 — prototype

A Practice Management / Client-Matter CRM prototype for solo & small law firms
(a Clio Manage–style app). This repo is the **first deployable demo** and
intentionally covers only two things (see `STACK.md` §2):

1. **Firm dashboard** — a Clio-home-style widget grid. All widgets are mocked
   **except** the **Activities** widget, which reads real `time_entries` from
   Postgres.
2. **Global time-tracking timer** — the centerpiece. A header play/pause timer
   that persists across navigation **and** page reload, a Timekeeper popover
   listing today's entries, manual or timed entry, server-side billing rounding,
   and a `/time` list view.

Everything else (leads, clients/matters CRUD, documents, portal, e-sign,
invoicing) is out of scope for the prototype.

## Stack

| Concern         | Choice                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Framework       | TanStack Start (React, full-stack) + TanStack Router (file-based)      |
| Language        | TypeScript (strict)                                                    |
| ORM / DB        | Drizzle ORM + drizzle-kit / PostgreSQL (`pg` node-postgres driver)     |
| Data fetching   | TanStack Query (via router context, SSR-prefetch in loaders)           |
| Server logic    | `createServerFn()` RPC; Zod-validated; auth/tenant check inside the fn |
| Styling / UI    | Tailwind CSS v4 (CSS-first) + shadcn/ui                                |
| Client state    | Zustand (timer store, persisted to `localStorage`)                     |
| Auth            | Auth.js (NextAuth core) — **stubbed** for the prototype                |
| Deployment      | Vercel (web) + Neon (db), via the Nitro Vercel preset                  |
| Package manager | pnpm                                                                   |

## Prerequisites

- **Node** 20+ (built/tested on Node 22+).
- **pnpm** 10 (`corepack enable` or install globally).
- **PostgreSQL 16** reachable at the `DATABASE_URL` (see Environment).

### Postgres on this machine (important)

**Docker Desktop is not installed here.** `docker-compose.yml` is the canonical
setup and is the intended path once Docker is available:

```bash
docker compose up -d        # Postgres 16 on localhost:5432, db "practice365"
```

Until then, a local **Homebrew Postgres** cluster is used as a fallback. Its
data lives in `/tmp/practice365-pgdata`, **which does not survive a reboot**
(`/tmp` is cleared). After a reboot you must recreate it; while the machine
stays up you only need to restart the server. Exact commands:

```bash
# Start an existing cluster (after a normal restart of the box):
LC_ALL=C pg_ctl -D /tmp/practice365-pgdata -l /tmp/practice365-pg.log start

# Check it:
pg_isready -h localhost -p 5432

# If /tmp was cleared (data dir gone), recreate from scratch:
LC_ALL=C initdb -D /tmp/practice365-pgdata -U postgres
LC_ALL=C pg_ctl -D /tmp/practice365-pgdata -l /tmp/practice365-pg.log start
createdb -h localhost -U postgres practice365
# (then re-run the migrate + seed steps below)
```

The connection string in `.env` (`postgres:postgres@localhost:5432/practice365`)
matches both the Docker container and this Homebrew fallback.

## Environment

Postgres is configured **purely through the environment** — there are no
hardcoded credentials in the app.

```bash
cp .env.example .env
```

Then set in `.env`:

- `DATABASE_URL` — e.g. `postgresql://postgres:postgres@localhost:5432/practice365`
  (Neon connection string in production).
- `AUTH_SECRET` — generate with `openssl rand -base64 32`.

> Note: drizzle-kit and the seed script load `.env` automatically (via
> `drizzle.config.ts` / `dotenv`). The **dev server** (`pnpm dev`) loads `.env`
> through Vite. The **production server** (`pnpm start` / `node
.output/server/index.mjs`) does **not** auto-load `.env` — export the env vars
> in the shell (or rely on the platform's env, e.g. Vercel) before starting it.

## Commands

```bash
pnpm install        # install dependencies

# Database
pnpm db:generate    # generate SQL migrations from src/db/schema.ts
pnpm db:migrate     # apply migrations          (or: pnpm db:push to sync directly)
pnpm db:seed        # seed 1 firm, 3 users, 2 clients, 3 matters, ~5 time entries

# Develop
pnpm dev            # Vite dev server on http://localhost:3000

# Build & run a production server locally
pnpm build          # Nitro build → .output/ (node-server preset)
pnpm start          # node .output/server/index.mjs   (export DATABASE_URL first!)

pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm lint / format  # eslint / prettier
```

### First-run quickstart

```bash
pnpm install
cp .env.example .env          # then edit DATABASE_URL / AUTH_SECRET
# ensure Postgres is up (docker compose up -d, or the Homebrew commands above)
pnpm db:migrate
pnpm db:seed
pnpm dev                      # open http://localhost:3000  → redirects to /dashboard
```

### Deploying to Vercel

Build with the Vercel Nitro preset and provide a Neon `DATABASE_URL`:

```bash
NITRO_PRESET=vercel pnpm build   # emits .vercel/output/
```

On Vercel, set `DATABASE_URL` (Neon serverless Postgres) and `AUTH_SECRET` as
project environment variables. The app reads them from `process.env`, so no code
changes are needed between local and prod.

## Project structure

```
src/
├─ routes/
│  ├─ __root.tsx         # header + GlobalTimer + Timekeeper + TimeEntryModal mount here
│  ├─ index.tsx          # redirects → /dashboard
│  ├─ dashboard.tsx      # firm dashboard widget grid
│  └─ time.tsx           # time-entries list view
├─ server/               # createServerFn handlers (Zod-validated, firm-scoped)
│  ├─ time-entries.ts    # list/start/stop/resume/save
│  └─ matters.ts         # listMatters, getFirmConfig (real minuteIncrement)
├─ lib/
│  ├─ services/billing.ts# computeAmount (integer-cents money math)
│  ├─ rounding.ts        # billing rounding helpers
│  └─ auth.ts rbac.ts tenant.ts   # auth STUB + role/tenant guards
├─ stores/timer.ts       # Zustand timer store (localStorage-persisted)
├─ components/
│  ├─ ui/                # shadcn primitives
│  ├─ timer/             # GlobalTimer, TimekeeperPopover, TimeEntryModal
│  └─ dashboard/         # widget components
└─ db/
   ├─ schema.ts          # Drizzle schema (every table has firmId)
   ├─ seed.ts            # demo data; ids match the auth stub
   └─ index.ts           # drizzle client (reads DATABASE_URL)
drizzle/                 # generated migrations
```

## What's real vs. mocked in the prototype

**Real (backed by Postgres):**

- The Activities dashboard widget and the entire `/time` list (read real
  `time_entries` joined with matter/client/user).
- Timer start/stop/resume and saving entries (persisted via `createServerFn`).
- Billing rounding and amounts — computed server-side / in a pure service from
  the firm's real `minuteIncrement` (`getFirmConfig`), with money math in
  integer cents (never floats).

**Stubbed / mocked:**

- **Auth** — `src/lib/auth.ts` returns a fixed demo session (firm + attorney
  user) whose ids match the seed, so every query resolves to real seeded rows.
  Replace with Auth.js when wiring real sessions.
- **Dashboard widgets** other than Activities (Firm Feed, Today's Agenda, Bills,
  Calendar, Trust flags) render hardcoded/mock content.

**Out of scope** (per `STACK.md` §2 — do not build for the prototype): leads,
clients/matters CRUD, documents + versions, the client portal, e-sign,
invoicing/payments, trust ledger, calendar events, and the rest of the future
schema.

See `STACK.md` for the full spec, schema, timer behavior (§5), and acceptance
criteria (§7).
