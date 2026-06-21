import 'dotenv/config'
import { randomUUID } from 'node:crypto'
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
import type { NewActivityCategory, NewInvoice, NewTimeEntry } from '@/db/schema'
import { DEMO_FIRM_ID, DEMO_USER_ID } from '@/lib/auth'
import { computeAmount, centsToString } from '@/lib/services/billing'

// ===========================================================================
// Demo seed — a realistic, "looks-good-for-a-demo" dataset.
//
// The goal: every screen and widget reads ALIVE, with internally-consistent
// numbers. To get there we model a small-but-busy firm and DERIVE its bills
// from real work, so the dashboards tie out:
//
//   - 7 users (4 attorneys, 2 paralegals, 1 admin); primary = DEMO_USER_ID.
//   - 12 clients (companies + individuals), 17 matters (mostly active, a few
//     closed / on hold), each linked to a client and a responsible attorney,
//     several with a per-matter rate override.
//   - ~2 years of time entries: every business day, each timekeeper logs near
//     their daily target across the matters they work, with varied activities,
//     narratives and a sprinkle of non-billable internal time.
//   - Invoices DERIVED from that work: for each past (matter, month) we bundle a
//     recency-tapered share of its billable entries into one invoice whose total
//     EQUALS the summed billed amounts, then link those entries. Older months are
//     mostly paid; recent months unpaid (some overdue); the current month is all
//     unbilled WIP. This makes Utilization / Realization / Collection, the
//     Financial-metrics bars and the Bills A/R all consistent and full.
//   - A curated set of recent invoices guarantees the /bills page shows every
//     status tab populated (it loads the 15 newest by createdAt).
//   - Tasks (Today's Agenda), upcoming calendar events, and trust accounts with
//     two flagged balances round out the dashboard widgets.
//
// Money discipline (STACK.md §6): amounts are computed in integer cents via the
// shared billing helpers and stored as numeric strings — never floats.
//
// Deterministic: a fixed-seed PRNG drives all variety so re-running on the same
// day reproduces the same database. The script clears the relevant tables first.
// ===========================================================================

const MINUTE_INCREMENT = 6

// --- Fixed ids (deterministic, re-runnable) --------------------------------
// Users — DEMO_USER_ID is the primary attorney (the stub session "you").
const U_DANA = DEMO_USER_ID // attorney (partner) — primary
const U_SAM = '00000000-0000-4000-8000-000000000003' // paralegal
const U_ALEX = '00000000-0000-4000-8000-000000000004' // admin
const U_MARCUS = '00000000-0000-4000-8000-000000000005' // attorney (partner)
const U_PRIYA = '00000000-0000-4000-8000-000000000006' // attorney (associate)
const U_DANIEL = '00000000-0000-4000-8000-000000000007' // attorney (associate)
const U_ROSA = '00000000-0000-4000-8000-000000000008' // paralegal

// Clients
const C_ACME = '00000000-0000-4000-8000-000000000010'
const C_GLOBEX = '00000000-0000-4000-8000-000000000011'
const C_INITECH = '00000000-0000-4000-8000-000000000012'
const C_STARK = '00000000-0000-4000-8000-000000000013'
const C_WAYNE = '00000000-0000-4000-8000-000000000014'
const C_UMBRELLA = '00000000-0000-4000-8000-000000000015'
const C_HOOLI = '00000000-0000-4000-8000-000000000016'
const C_SOYLENT = '00000000-0000-4000-8000-000000000017'
const C_VANDELAY = '00000000-0000-4000-8000-000000000018'
const C_WONKA = '00000000-0000-4000-8000-000000000019'
const C_CHEN = '00000000-0000-4000-8000-00000000001a'
const C_DELGADO = '00000000-0000-4000-8000-00000000001b'

// Matters
const M1 = '00000000-0000-4000-8000-000000000020'
const M2 = '00000000-0000-4000-8000-000000000021'
const M3 = '00000000-0000-4000-8000-000000000022'
const M4 = '00000000-0000-4000-8000-000000000023'
const M5 = '00000000-0000-4000-8000-000000000024'
const M6 = '00000000-0000-4000-8000-000000000025'
const M7 = '00000000-0000-4000-8000-000000000026'
const M8 = '00000000-0000-4000-8000-000000000027'
const M9 = '00000000-0000-4000-8000-000000000028'
const M10 = '00000000-0000-4000-8000-000000000029'
const M11 = '00000000-0000-4000-8000-00000000002a'
const M12 = '00000000-0000-4000-8000-00000000002b'
const M13 = '00000000-0000-4000-8000-00000000002c'
const M14 = '00000000-0000-4000-8000-00000000002d'
const M15 = '00000000-0000-4000-8000-00000000002e' // closed
const M16 = '00000000-0000-4000-8000-00000000002f' // closed
const M17 = '00000000-0000-4000-8000-000000000030' // on hold

// Trust accounts
const TR1 = '00000000-0000-4000-8000-000000000040'
const TR2 = '00000000-0000-4000-8000-000000000041'
const TR3 = '00000000-0000-4000-8000-000000000042'
const TR4 = '00000000-0000-4000-8000-000000000043'

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — fixed seed so the dataset is reproducible.
// ---------------------------------------------------------------------------
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = makeRng(0xc0ffee)
/** Pick a deterministic element from an array. */
function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(rng() * arr.length)]
}

// --- Date helpers ----------------------------------------------------------
const now = new Date()

/** A point `daysAgo` days before now (negative = future) at h:m, local. */
function atTime(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d
}
/** A specific calendar moment. */
function at(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(year, monthIndex, day, hour, minute, 0, 0)
}
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}
function isBizDay(d: Date): boolean {
  const day = d.getDay()
  return day !== 0 && day !== 6
}

// ---------------------------------------------------------------------------
// Reference data — the firm's people, clients and matters.
// ---------------------------------------------------------------------------

interface UserRow {
  id: string
  email: string
  name: string
  role: string
  defaultRate: string
  targetBillableHoursPerDay: string
  targetRevenuePerMonth: string
}

const USERS: Array<UserRow> = [
  {
    id: U_DANA,
    email: 'dana.whitman@practice365.test',
    name: 'Dana Whitman',
    role: 'attorney',
    defaultRate: '350.00',
    targetBillableHoursPerDay: '7.50',
    targetRevenuePerMonth: '45000.00',
  },
  {
    id: U_MARCUS,
    email: 'marcus.reed@practice365.test',
    name: 'Marcus Reed',
    role: 'attorney',
    defaultRate: '375.00',
    targetBillableHoursPerDay: '7.00',
    targetRevenuePerMonth: '0',
  },
  {
    id: U_PRIYA,
    email: 'priya.shah@practice365.test',
    name: 'Priya Shah',
    role: 'attorney',
    defaultRate: '275.00',
    targetBillableHoursPerDay: '8.00',
    targetRevenuePerMonth: '0',
  },
  {
    id: U_DANIEL,
    email: 'daniel.okoro@practice365.test',
    name: 'Daniel Okoro',
    role: 'attorney',
    defaultRate: '250.00',
    targetBillableHoursPerDay: '8.00',
    targetRevenuePerMonth: '0',
  },
  {
    id: U_SAM,
    email: 'sam.calloway@practice365.test',
    name: 'Sam Calloway',
    role: 'paralegal',
    defaultRate: '150.00',
    targetBillableHoursPerDay: '6.00',
    targetRevenuePerMonth: '0',
  },
  {
    id: U_ROSA,
    email: 'rosa.mendez@practice365.test',
    name: 'Rosa Méndez',
    role: 'paralegal',
    defaultRate: '140.00',
    targetBillableHoursPerDay: '6.00',
    targetRevenuePerMonth: '0',
  },
  {
    id: U_ALEX,
    email: 'alex.nguyen@practice365.test',
    name: 'Alex Nguyen',
    role: 'admin',
    defaultRate: '0.00',
    targetBillableHoursPerDay: '0.00',
    targetRevenuePerMonth: '0',
  },
]

const CLIENTS: Array<{ id: string; name: string }> = [
  { id: C_ACME, name: 'Acme Corporation' },
  { id: C_GLOBEX, name: 'Globex LLC' },
  { id: C_INITECH, name: 'Initech Industries' },
  { id: C_STARK, name: 'Stark Enterprises' },
  { id: C_WAYNE, name: 'Wayne Holdings' },
  { id: C_UMBRELLA, name: 'Umbrella Pharmaceuticals' },
  { id: C_HOOLI, name: 'Hooli Inc.' },
  { id: C_SOYLENT, name: 'Soylent Foods Co.' },
  { id: C_VANDELAY, name: 'Vandelay Imports' },
  { id: C_WONKA, name: 'Wonka Industries' },
  { id: C_CHEN, name: 'Margaret Chen' },
  { id: C_DELGADO, name: 'Robert Delgado' },
]

interface MatterRow {
  id: string
  name: string
  clientId: string
  responsibleAttorneyId: string
  status: string
  rate: string | null
}

const MATTERS: Array<MatterRow> = [
  {
    id: M1,
    name: 'Acme Corporation — M&A Advisory',
    clientId: C_ACME,
    responsibleAttorneyId: U_MARCUS,
    status: 'active',
    rate: '400.00',
  },
  {
    id: M2,
    name: 'Acme Corporation — Commercial Litigation',
    clientId: C_ACME,
    responsibleAttorneyId: U_DANA,
    status: 'active',
    rate: null,
  },
  {
    id: M3,
    name: 'Globex LLC — Trademark Portfolio',
    clientId: C_GLOBEX,
    responsibleAttorneyId: U_PRIYA,
    status: 'active',
    rate: null,
  },
  {
    id: M4,
    name: 'Globex LLC — Employment Dispute',
    clientId: C_GLOBEX,
    responsibleAttorneyId: U_DANIEL,
    status: 'active',
    rate: null,
  },
  {
    id: M5,
    name: 'Initech Industries — Software Licensing',
    clientId: C_INITECH,
    responsibleAttorneyId: U_PRIYA,
    status: 'active',
    rate: '300.00',
  },
  {
    id: M6,
    name: 'Stark Enterprises — Patent Infringement',
    clientId: C_STARK,
    responsibleAttorneyId: U_DANA,
    status: 'active',
    rate: '425.00',
  },
  {
    id: M7,
    name: 'Wayne Holdings — Real Estate Acquisition',
    clientId: C_WAYNE,
    responsibleAttorneyId: U_MARCUS,
    status: 'active',
    rate: null,
  },
  {
    id: M8,
    name: 'Umbrella Pharmaceuticals — Regulatory Compliance',
    clientId: C_UMBRELLA,
    responsibleAttorneyId: U_DANIEL,
    status: 'active',
    rate: null,
  },
  {
    id: M9,
    name: 'Hooli Inc. — Data Privacy Audit',
    clientId: C_HOOLI,
    responsibleAttorneyId: U_PRIYA,
    status: 'active',
    rate: '325.00',
  },
  {
    id: M10,
    name: 'Soylent Foods Co. — Supply Contract Review',
    clientId: C_SOYLENT,
    responsibleAttorneyId: U_DANA,
    status: 'active',
    rate: null,
  },
  {
    id: M11,
    name: 'Vandelay Imports — Import/Export Dispute',
    clientId: C_VANDELAY,
    responsibleAttorneyId: U_MARCUS,
    status: 'active',
    rate: null,
  },
  {
    id: M12,
    name: 'Wonka Industries — Trade Secret Protection',
    clientId: C_WONKA,
    responsibleAttorneyId: U_DANIEL,
    status: 'active',
    rate: null,
  },
  {
    id: M13,
    name: 'Margaret Chen — Estate Planning',
    clientId: C_CHEN,
    responsibleAttorneyId: U_DANA,
    status: 'active',
    rate: '250.00',
  },
  {
    id: M14,
    name: 'Robert Delgado — Personal Injury',
    clientId: C_DELGADO,
    responsibleAttorneyId: U_DANIEL,
    status: 'active',
    rate: '300.00',
  },
  {
    id: M15,
    name: 'Acme Corporation — Contract Review (2024)',
    clientId: C_ACME,
    responsibleAttorneyId: U_DANA,
    status: 'closed',
    rate: null,
  },
  {
    id: M16,
    name: 'Globex LLC — Securities Filing',
    clientId: C_GLOBEX,
    responsibleAttorneyId: U_MARCUS,
    status: 'closed',
    rate: null,
  },
  {
    id: M17,
    name: 'Stark Enterprises — NDA Drafting',
    clientId: C_STARK,
    responsibleAttorneyId: U_PRIYA,
    status: 'on hold',
    rate: null,
  },
]

const matterById = new Map(MATTERS.map((m) => [m.id, m]))

// Timekeepers and the matters they work, in rotation. Attorneys cover their own
// responsible matters; paralegals support a spread across several.
interface Timekeeper {
  id: string
  rate: string
  dailyHours: number
  isAttorney: boolean
  matters: Array<string>
}
const TIMEKEEPERS: Array<Timekeeper> = [
  {
    id: U_DANA,
    rate: '350.00',
    dailyHours: 7.5,
    isAttorney: true,
    matters: [M2, M6, M10, M13],
  },
  {
    id: U_MARCUS,
    rate: '375.00',
    dailyHours: 7.0,
    isAttorney: true,
    matters: [M1, M7, M11],
  },
  {
    id: U_PRIYA,
    rate: '275.00',
    dailyHours: 8.0,
    isAttorney: true,
    matters: [M3, M5, M9],
  },
  {
    id: U_DANIEL,
    rate: '250.00',
    dailyHours: 8.0,
    isAttorney: true,
    matters: [M4, M8, M12, M14],
  },
  {
    id: U_SAM,
    rate: '150.00',
    dailyHours: 6.0,
    isAttorney: false,
    matters: [M1, M3, M5, M13],
  },
  {
    id: U_ROSA,
    rate: '140.00',
    dailyHours: 6.0,
    isAttorney: false,
    matters: [M6, M7, M8, M9],
  },
]

// --- Narrative pools -------------------------------------------------------
const ATTORNEY_WORK: Array<[string, Array<string>]> = [
  [
    'Drafting',
    [
      'Draft and revise pleadings',
      'Prepare motion brief and supporting declaration',
      'Draft settlement agreement',
      'Revise key contract provisions',
    ],
  ],
  [
    'Legal Research',
    [
      'Research controlling authority',
      'Analyze regulatory framework',
      'Survey case law on damages',
    ],
  ],
  [
    'Review/Analyze',
    [
      'Review discovery production',
      'Analyze opposing brief',
      'Review due-diligence materials',
    ],
  ],
  [
    'Communicate (Client)',
    [
      'Client strategy call',
      'Update client on case status',
      'Client conference re: next steps',
    ],
  ],
  [
    'Communicate (Opposing Counsel)',
    ['Meet and confer with opposing counsel', 'Negotiate discovery scope'],
  ],
  ['Court Appearance', ['Attend status conference', 'Argue pretrial motion']],
  ['Deposition', ['Prepare for deposition', 'Take deposition of fact witness']],
]
const PARALEGAL_WORK: Array<[string, Array<string>]> = [
  [
    'Filing',
    [
      'E-file pleadings with the court',
      'File motion and exhibits',
      'Submit application to agency',
    ],
  ],
  [
    'Review/Analyze',
    [
      'Organize document production',
      'Index discovery materials',
      'Cite-check brief',
    ],
  ],
  [
    'Correspondence',
    [
      'Prepare correspondence to client',
      'Circulate signed documents for execution',
    ],
  ],
  ['Drafting', ['Draft routine pleadings', 'Prepare deposition summary']],
]
const NONBILLABLE_WORK: Array<string> = [
  'Internal case strategy meeting',
  'Practice group meeting',
  'Pro bono intake review',
  'Business development',
]

// ---------------------------------------------------------------------------
// Time-entry generation.
//
// Each Gen carries the insertable row plus the cents value (for invoice totals)
// and its calendar (year, month) for grouping. invoiceId is mutated in place
// when an entry gets bundled onto an invoice.
// ---------------------------------------------------------------------------
interface Gen {
  row: NewTimeEntry
  amountCents: number
  y: number
  mo: number
  matterId: string | null
}

function makeBillable(
  tk: Timekeeper,
  matterId: string,
  date: Date,
  hours: number,
  work: Array<[string, Array<string>]>,
  billable: 'billable' | 'no_charge' = 'billable',
): Gen {
  const matter = matterById.get(matterId)!
  // Rate: a responsible attorney bills the matter's premium override; everyone
  // else (and matters without an override) bills the timekeeper's own rate.
  const rate = tk.isAttorney && matter.rate != null ? matter.rate : tk.rate
  const [activity, narratives] = pick(work)
  const durationSeconds = Math.max(360, Math.round(hours * 3600))
  const { amountCents } = computeAmount({
    durationSeconds,
    minuteIncrement: MINUTE_INCREMENT,
    rate,
  })
  return {
    row: {
      firmId: DEMO_FIRM_ID,
      matterId,
      userId: tk.id,
      date,
      narrative: pick(narratives),
      activity,
      billable,
      rate,
      durationSeconds,
      running: false,
      invoiceId: null,
      createdAt: date,
    },
    amountCents: billable === 'billable' ? amountCents : 0,
    y: date.getFullYear(),
    mo: date.getMonth(),
    matterId,
  }
}

const allEntries: Array<Gen> = []
const tkDayCounter = new Map<string, number>(TIMEKEEPERS.map((t) => [t.id, 0]))

const thisYear = now.getFullYear()
const thisMonth = now.getMonth()
const today = now.getDate()
const START_YEAR = thisYear - 1 // one full prior year + this year-to-date

for (let year = START_YEAR; year <= thisYear; year++) {
  const lastMonth = year === thisYear ? thisMonth : 11
  for (let mo = 0; mo <= lastMonth; mo++) {
    const dim = daysInMonth(year, mo)
    // Current month: stop the day BEFORE today — today is curated separately.
    const lastDay = year === thisYear && mo === thisMonth ? today - 1 : dim
    for (let day = 1; day <= lastDay; day++) {
      const base = new Date(year, mo, day)
      if (!isBizDay(base)) continue

      for (const tk of TIMEKEEPERS) {
        const idx = tkDayCounter.get(tk.id)!
        tkDayCounter.set(tk.id, idx + 1)

        // ~6% of days off (PTO / light day) so the series isn't a flat wall.
        if (rng() < 0.06) continue

        const work = tk.isAttorney ? ATTORNEY_WORK : PARALEGAL_WORK
        const jitter = 0.78 + rng() * 0.27 // 0.78 .. 1.05 of target
        const dayHours = tk.dailyHours * jitter
        const mIdx = idx % tk.matters.length
        const primaryMatter = tk.matters[mIdx]

        // ~45% of days split across two matters.
        if (rng() < 0.45) {
          const secondMatter = tk.matters[(mIdx + 1) % tk.matters.length]
          const h1 = dayHours * (0.55 + rng() * 0.1)
          const h2 = dayHours - h1
          allEntries.push(
            makeBillable(tk, primaryMatter, at(year, mo, day, 9, 30), h1, work),
          )
          allEntries.push(
            makeBillable(tk, secondMatter, at(year, mo, day, 14, 15), h2, work),
          )
        } else {
          // Rare courtesy "no charge" entry (~1 in 22) for billing-status variety.
          const status = rng() < 0.045 ? 'no_charge' : 'billable'
          allEntries.push(
            makeBillable(
              tk,
              primaryMatter,
              at(year, mo, day, 10, 0),
              dayHours,
              work,
              status,
            ),
          )
        }

        // Roughly weekly non-billable internal time so that series shows.
        if (idx % 5 === 2) {
          const dur = Math.round((0.75 + rng() * 0.75) * 3600)
          allEntries.push({
            row: {
              firmId: DEMO_FIRM_ID,
              matterId: null,
              userId: tk.id,
              date: at(year, mo, day, 13, 0),
              narrative: pick(NONBILLABLE_WORK),
              activity: 'Conference/Meeting',
              billable: 'non_billable',
              rate: tk.rate,
              durationSeconds: dur,
              running: false,
              invoiceId: null,
              createdAt: at(year, mo, day, 13, 0),
            },
            amountCents: 0,
            y: year,
            mo,
            matterId: null,
          })
        }
      }
    }
  }
}

// --- Curated "today" — a readable, lively current day for every timekeeper --
// These are unbilled WIP (invoiceId null) and drive the Activities widget,
// today's metrics and the top of the firm feed.
const TODAY_ENTRIES: Array<
  [
    Timekeeper,
    string | null,
    number,
    number,
    string,
    string,
    'billable' | 'non_billable',
  ]
> = [
  // [timekeeper, matter, hour, durationHours, activity, narrative, billable]
  [
    TIMEKEEPERS[0],
    M6,
    9,
    1.5,
    'Drafting',
    'Draft reply brief on claim construction',
    'billable',
  ],
  [
    TIMEKEEPERS[0],
    M2,
    11,
    1.0,
    'Communicate (Client)',
    'Call with Acme GC on litigation strategy',
    'billable',
  ],
  [
    TIMEKEEPERS[0],
    M13,
    14,
    0.75,
    'Review/Analyze',
    'Review estate plan documents for Ms. Chen',
    'billable',
  ],
  [
    TIMEKEEPERS[1],
    M1,
    9,
    2.0,
    'Review/Analyze',
    'Review purchase agreement schedules',
    'billable',
  ],
  [
    TIMEKEEPERS[2],
    M9,
    10,
    1.5,
    'Legal Research',
    'Research GDPR cross-border transfer rules',
    'billable',
  ],
  [
    TIMEKEEPERS[3],
    M4,
    9,
    1.25,
    'Drafting',
    'Draft EEOC position statement',
    'billable',
  ],
  [
    TIMEKEEPERS[4],
    M3,
    11,
    1.5,
    'Filing',
    'File trademark response with USPTO',
    'billable',
  ],
  [
    TIMEKEEPERS[5],
    M8,
    13,
    1.0,
    'Review/Analyze',
    'Compile regulatory filing exhibits',
    'billable',
  ],
  [
    TIMEKEEPERS[0],
    null,
    16,
    0.5,
    'Conference/Meeting',
    'Weekly team docket review',
    'non_billable',
  ],
]
for (const [
  tk,
  matterId,
  hour,
  hours,
  activity,
  narrative,
  billable,
] of TODAY_ENTRIES) {
  const matter = matterId ? matterById.get(matterId) : undefined
  const rate = tk.isAttorney && matter?.rate != null ? matter.rate : tk.rate
  const date = atTime(0, hour, 0)
  const durationSeconds = Math.round(hours * 3600)
  allEntries.push({
    row: {
      firmId: DEMO_FIRM_ID,
      matterId: matterId ?? null,
      userId: tk.id,
      date,
      narrative,
      activity,
      billable,
      rate,
      durationSeconds,
      running: false,
      invoiceId: null,
      createdAt: date,
    },
    amountCents: 0, // current day → WIP, not part of any invoice total
    y: thisYear,
    mo: thisMonth,
    matterId: matterId ?? null,
  })
}

// ---------------------------------------------------------------------------
// Invoices, LAYER A — derived from real work.
//
// Group past billable entries by (matter, month). For each group, bill a
// recency-tapered SHARE of the entries onto one invoice whose total equals the
// summed billed amounts, then link those entries (invoiceId). Current-month work
// is intentionally left unbilled (WIP).
// ---------------------------------------------------------------------------
const groups = new Map<string, Array<Gen>>()
for (const e of allEntries) {
  if (e.row.billable !== 'billable' || e.matterId == null) continue
  // Skip the current month → leave as WIP.
  if (e.y === thisYear && e.mo === thisMonth) continue
  const key = `${e.matterId}|${e.y}|${e.mo}`
  const list = groups.get(key) ?? []
  list.push(e)
  groups.set(key, list)
}

const invoiceRows: Array<NewInvoice> = []
let invoiceNumber = 1001

// Process oldest groups first so invoice numbers climb with time.
const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
  const [, ya, ma] = a.split('|')
  const [, yb, mb] = b.split('|')
  return Number(ya) * 12 + Number(ma) - (Number(yb) * 12 + Number(mb))
})

for (const key of sortedKeys) {
  const list = groups.get(key)!.sort((a, b) => +a.row.date! - +b.row.date!)
  const [matterId, yStr, moStr] = key.split('|')
  const y = Number(yStr)
  const mo = Number(moStr)
  const monthsAgo = thisYear * 12 + thisMonth - (y * 12 + mo)

  // Share of the month's work that has been billed, by recency.
  const share =
    monthsAgo >= 4
      ? 0.92
      : monthsAgo === 3
        ? 0.9
        : monthsAgo === 2
          ? 0.85
          : 0.55
  const nBill = Math.floor(list.length * share)
  if (nBill <= 0) continue

  const selected = list.slice(0, nBill)
  const totalCents = selected.reduce((s, e) => s + e.amountCents, 0)
  if (totalCents <= 0) continue

  const invId = randomUUID()
  for (const e of selected) e.row.invoiceId = invId

  // Status by recency: older fully collected, recent still outstanding.
  const r = rng()
  const status =
    monthsAgo >= 3
      ? 'paid'
      : monthsAgo === 2
        ? r < 0.7
          ? 'paid'
          : 'unpaid'
        : r < 0.4
          ? 'paid'
          : 'unpaid'

  const issueDay = Math.min(27, daysInMonth(y, mo))
  const issuedAt = at(y, mo, issueDay, 10, 0)
  const dueAt = new Date(issuedAt)
  dueAt.setDate(dueAt.getDate() + 30)

  invoiceRows.push({
    id: invId,
    firmId: DEMO_FIRM_ID,
    clientId: matterById.get(matterId)!.clientId,
    matterId,
    number: `INV-${invoiceNumber++}`,
    status,
    total: centsToString(totalCents),
    issuedAt,
    dueAt,
    createdAt: issuedAt,
  })
}

// ---------------------------------------------------------------------------
// Invoices, LAYER B — curated recent invoices.
//
// The /bills page loads the 15 newest invoices (by createdAt) and filters them
// by status tab, so we seed a recent invoice of EVERY status with createdAt in
// the last ~2 weeks — guaranteeing each tab (Draft / Pending / Unpaid / Overdue
// / Paid) is populated. Issue/due dates make the overdue ones genuinely past due.
// ---------------------------------------------------------------------------
interface RecentInvoice {
  client: string
  matter: string
  status: 'draft' | 'pending' | 'unpaid' | 'paid' | 'void'
  total: string
  issuedDaysAgo: number | null // null while unissued (draft/pending)
  dueDaysAgo: number | null // positive = past due
  createdDaysAgo: number
}
const RECENT: Array<RecentInvoice> = [
  {
    client: C_ACME,
    matter: M1,
    status: 'draft',
    total: '14250.00',
    issuedDaysAgo: null,
    dueDaysAgo: null,
    createdDaysAgo: 1,
  },
  {
    client: C_DELGADO,
    matter: M14,
    status: 'draft',
    total: '6800.00',
    issuedDaysAgo: null,
    dueDaysAgo: null,
    createdDaysAgo: 2,
  },
  {
    client: C_HOOLI,
    matter: M9,
    status: 'pending',
    total: '9325.00',
    issuedDaysAgo: null,
    dueDaysAgo: null,
    createdDaysAgo: 3,
  },
  {
    client: C_INITECH,
    matter: M5,
    status: 'pending',
    total: '5100.00',
    issuedDaysAgo: null,
    dueDaysAgo: null,
    createdDaysAgo: 4,
  },
  {
    client: C_STARK,
    matter: M6,
    status: 'unpaid',
    total: '18900.00',
    issuedDaysAgo: 6,
    dueDaysAgo: -24,
    createdDaysAgo: 6,
  },
  {
    client: C_SOYLENT,
    matter: M10,
    status: 'unpaid',
    total: '7400.00',
    issuedDaysAgo: 8,
    dueDaysAgo: -22,
    createdDaysAgo: 8,
  },
  {
    client: C_GLOBEX,
    matter: M3,
    status: 'unpaid',
    total: '4650.00',
    issuedDaysAgo: 9,
    dueDaysAgo: -21,
    createdDaysAgo: 9,
  },
  {
    client: C_WAYNE,
    matter: M7,
    status: 'unpaid',
    total: '12300.00',
    issuedDaysAgo: 40,
    dueDaysAgo: 10,
    createdDaysAgo: 5,
  }, // overdue
  {
    client: C_VANDELAY,
    matter: M11,
    status: 'unpaid',
    total: '8750.00',
    issuedDaysAgo: 45,
    dueDaysAgo: 15,
    createdDaysAgo: 7,
  }, // overdue
  {
    client: C_UMBRELLA,
    matter: M8,
    status: 'paid',
    total: '15600.00',
    issuedDaysAgo: 18,
    dueDaysAgo: 12,
    createdDaysAgo: 10,
  },
  {
    client: C_GLOBEX,
    matter: M4,
    status: 'paid',
    total: '6300.00',
    issuedDaysAgo: 14,
    dueDaysAgo: 16,
    createdDaysAgo: 11,
  },
  {
    client: C_WONKA,
    matter: M12,
    status: 'void',
    total: '2100.00',
    issuedDaysAgo: null,
    dueDaysAgo: null,
    createdDaysAgo: 12,
  },
]
for (const ri of RECENT) {
  const issuedAt =
    ri.issuedDaysAgo == null ? null : atTime(ri.issuedDaysAgo, 10, 0)
  const dueAt = ri.dueDaysAgo == null ? null : atTime(ri.dueDaysAgo, 17, 0)
  invoiceRows.push({
    id: randomUUID(),
    firmId: DEMO_FIRM_ID,
    clientId: ri.client,
    matterId: ri.matter,
    number: `INV-${invoiceNumber++}`,
    status: ri.status,
    total: ri.total,
    issuedAt,
    dueAt,
    createdAt: atTime(ri.createdDaysAgo, 9, 0),
  })
}

// ---------------------------------------------------------------------------
// Default activity categories (Clio-style starter set).
// ---------------------------------------------------------------------------
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

// --- Chunked insert for the big time-entry array (pg param-limit safe). -----
async function insertTimeEntries(rows: Array<NewTimeEntry>): Promise<void> {
  const SIZE = 500
  for (let i = 0; i < rows.length; i += SIZE) {
    await db.insert(timeEntries).values(rows.slice(i, i + SIZE))
  }
}

async function runSeed() {
  console.log('Seeding database (demo dataset)...')

  // Clear in FK-safe order (children before parents).
  await db.delete(trustTransactions)
  await db.delete(trustAccounts)
  await db.delete(timeEntries)
  await db.delete(activityCategories)
  await db.delete(tasks)
  await db.delete(calendarEvents)
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
    minuteIncrement: MINUTE_INCREMENT,
  })

  // Users
  await db.insert(users).values(
    USERS.map((u) => ({
      id: u.id,
      firmId: DEMO_FIRM_ID,
      email: u.email,
      name: u.name,
      role: u.role,
      defaultRate: u.defaultRate,
      targetBillableHoursPerDay: u.targetBillableHoursPerDay,
      targetRevenuePerMonth: u.targetRevenuePerMonth,
    })),
  )

  // Clients
  await db
    .insert(clients)
    .values(
      CLIENTS.map((c) => ({ id: c.id, firmId: DEMO_FIRM_ID, name: c.name })),
    )

  // Matters + matter↔client links
  await db.insert(matters).values(
    MATTERS.map((m) => ({
      id: m.id,
      firmId: DEMO_FIRM_ID,
      name: m.name,
      responsibleAttorneyId: m.responsibleAttorneyId,
      status: m.status,
      rate: m.rate,
    })),
  )
  await db
    .insert(matterClients)
    .values(MATTERS.map((m) => ({ matterId: m.id, clientId: m.clientId })))

  // Pre-configured activity categories
  await db
    .insert(activityCategories)
    .values(defaultActivityCategories(DEMO_FIRM_ID))

  // Invoices BEFORE time entries (time_entries.invoiceId → invoices.id).
  await db.insert(invoices).values(invoiceRows)

  // Time entries (chunked)
  await insertTimeEntries(allEntries.map((e) => e.row))

  // ----------------------------------------------------------------------
  // Tasks — "Today's Agenda" reads the SESSION user's (Dana's) tasks. Give her
  // a rich mix of priorities / due dates / open+done; add a few done tasks for
  // other users so the firm feed's "completed task" items have variety.
  // ----------------------------------------------------------------------
  await db.insert(tasks).values([
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M6,
      title: 'Finalize claim-construction reply brief',
      notes: 'Court deadline — file before 5pm.',
      priority: 'high',
      status: 'open',
      dueAt: atTime(0, 16, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M2,
      title: 'Prep Acme litigation strategy memo',
      notes: 'For tomorrow’s client call.',
      priority: 'high',
      status: 'open',
      dueAt: atTime(0, 11, 30),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M13,
      title: 'Review Chen estate plan revisions',
      priority: 'normal',
      status: 'open',
      dueAt: atTime(-1, 12, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M10,
      title: 'Send Soylent supply contract redlines',
      priority: 'normal',
      status: 'open',
      dueAt: atTime(-2, 12, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M6,
      title: 'Outline expert witness questions',
      notes: 'Patent damages expert.',
      priority: 'normal',
      status: 'open',
      dueAt: atTime(-4, 12, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: null,
      title: 'Approve monthly billing run',
      priority: 'low',
      status: 'open',
      dueAt: atTime(-6, 12, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M2,
      title: 'Overdue: respond to meet-and-confer letter',
      notes: 'Slipped from last week.',
      priority: 'high',
      status: 'open',
      dueAt: atTime(2, 12, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M13,
      title: 'Send engagement letter to Margaret Chen',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(3, 12, 0),
      completedAt: atTime(1, 15, 30),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M6,
      title: 'Schedule deposition logistics',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(5, 12, 0),
      completedAt: atTime(3, 10, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANA,
      matterId: M10,
      title: 'Circulate NDA to opposing counsel',
      priority: 'low',
      status: 'done',
      dueAt: atTime(6, 12, 0),
      completedAt: atTime(4, 9, 0),
    },
    // Other users (feed variety only — not on Dana's agenda).
    {
      firmId: DEMO_FIRM_ID,
      userId: U_MARCUS,
      matterId: M1,
      title: 'Circulate Acme disclosure schedules',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(2, 12, 0),
      completedAt: atTime(1, 11, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_PRIYA,
      matterId: M9,
      title: 'Finalize Hooli privacy audit report',
      priority: 'high',
      status: 'done',
      dueAt: atTime(1, 12, 0),
      completedAt: atTime(0, 13, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_DANIEL,
      matterId: M4,
      title: 'File EEOC position statement',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(2, 12, 0),
      completedAt: atTime(2, 16, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      userId: U_SAM,
      matterId: M3,
      title: 'Assemble trademark filing exhibits',
      priority: 'normal',
      status: 'done',
      dueAt: atTime(1, 12, 0),
      completedAt: atTime(0, 10, 30),
    },
  ])

  // ----------------------------------------------------------------------
  // Calendar events — upcoming over the next ~3 weeks (widget shows start>=today).
  // ----------------------------------------------------------------------
  await db.insert(calendarEvents).values([
    {
      firmId: DEMO_FIRM_ID,
      matterId: M2,
      title: 'Acme litigation strategy call',
      eventType: 'meeting',
      startAt: atTime(-1, 10, 0),
      endAt: atTime(-1, 11, 0),
      location: 'Zoom',
      notes: 'Walk client through next phase.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M6,
      title: 'Markman hearing prep',
      eventType: 'meeting',
      startAt: atTime(-1, 14, 0),
      endAt: atTime(-1, 15, 30),
      location: 'War room',
      notes: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M4,
      title: 'Discovery responses due',
      eventType: 'deadline',
      startAt: atTime(-2, 17, 0),
      endAt: null,
      location: null,
      notes: 'Globex employment matter.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M6,
      title: 'Deposition of opposing expert',
      eventType: 'deposition',
      startAt: atTime(-4, 9, 30),
      endAt: atTime(-4, 13, 0),
      location: 'Downtown Reporting, Suite 400',
      notes: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M3,
      title: 'USPTO examiner interview',
      eventType: 'meeting',
      startAt: atTime(-6, 14, 0),
      endAt: atTime(-6, 14, 30),
      location: 'Teleconference',
      notes: 'Trademark office action.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M1,
      title: 'Acme M&A signing',
      eventType: 'meeting',
      startAt: atTime(-7, 11, 0),
      endAt: atTime(-7, 13, 0),
      location: 'Client HQ',
      notes: 'Execution of purchase agreement.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M2,
      title: 'Motion to compel hearing',
      eventType: 'hearing',
      startAt: atTime(-9, 9, 0),
      endAt: atTime(-9, 10, 0),
      location: 'County Courthouse, Dept. 12',
      notes: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M14,
      title: 'Mediation — Delgado PI',
      eventType: 'meeting',
      startAt: atTime(-10, 9, 0),
      endAt: atTime(-10, 16, 0),
      location: 'ADR Center',
      notes: 'Full-day mediation.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M8,
      title: 'Regulatory filing deadline',
      eventType: 'deadline',
      startAt: atTime(-12, 17, 0),
      endAt: null,
      location: null,
      notes: 'Umbrella compliance submission.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: null,
      title: 'Firm monthly review',
      eventType: 'other',
      startAt: atTime(-14, 16, 0),
      endAt: atTime(-14, 17, 0),
      location: 'Conference Room A',
      notes: null,
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M11,
      title: 'Settlement conference',
      eventType: 'hearing',
      startAt: atTime(-16, 13, 30),
      endAt: atTime(-16, 15, 0),
      location: 'Federal Courthouse',
      notes: 'Vandelay dispute.',
    },
    {
      firmId: DEMO_FIRM_ID,
      matterId: M9,
      title: 'Hooli audit findings review',
      eventType: 'meeting',
      startAt: atTime(-18, 10, 0),
      endAt: atTime(-18, 11, 0),
      location: 'Zoom',
      notes: null,
    },
  ])

  // ----------------------------------------------------------------------
  // Trust accounts — balances are DERIVED from the ledger. Two are healthy,
  // one is a warning (just below min), one is critical (near zero).
  // ----------------------------------------------------------------------
  await db.insert(trustAccounts).values([
    {
      id: TR1,
      firmId: DEMO_FIRM_ID,
      matterId: M1,
      clientId: C_ACME,
      name: 'Acme Corporation — M&A Trust',
      minimumBalance: '10000.00',
    },
    {
      id: TR2,
      firmId: DEMO_FIRM_ID,
      matterId: M6,
      clientId: C_STARK,
      name: 'Stark Enterprises — Patent Litigation Trust',
      minimumBalance: '15000.00',
    },
    {
      id: TR3,
      firmId: DEMO_FIRM_ID,
      matterId: M4,
      clientId: C_GLOBEX,
      name: 'Globex LLC — Employment Trust',
      minimumBalance: '5000.00',
    },
    {
      id: TR4,
      firmId: DEMO_FIRM_ID,
      matterId: M7,
      clientId: C_WAYNE,
      name: 'Wayne Holdings — Real Estate Trust',
      minimumBalance: '8000.00',
    },
  ])
  await db.insert(trustTransactions).values([
    // TR1 healthy: 50,000 − 8,000 − 6,500 = 35,500 (≥ 10,000)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR1,
      type: 'deposit',
      amount: '50000.00',
      memo: 'Initial M&A retainer',
      occurredAt: atTime(120, 9, 0),
      createdAt: atTime(120, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR1,
      type: 'withdrawal',
      amount: '8000.00',
      memo: 'Applied to invoice',
      occurredAt: atTime(60, 10, 0),
      createdAt: atTime(60, 10, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR1,
      type: 'withdrawal',
      amount: '6500.00',
      memo: 'Filing & diligence costs',
      occurredAt: atTime(20, 14, 0),
      createdAt: atTime(20, 14, 0),
    },
    // TR2 healthy: 40,000 + 10,000 − 12,000 = 38,000 (≥ 15,000)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR2,
      type: 'deposit',
      amount: '40000.00',
      memo: 'Litigation retainer',
      occurredAt: atTime(150, 9, 0),
      createdAt: atTime(150, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR2,
      type: 'deposit',
      amount: '10000.00',
      memo: 'Retainer replenishment',
      occurredAt: atTime(40, 11, 0),
      createdAt: atTime(40, 11, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR2,
      type: 'withdrawal',
      amount: '12000.00',
      memo: 'Expert witness fees',
      occurredAt: atTime(15, 13, 0),
      createdAt: atTime(15, 13, 0),
    },
    // TR3 warning: 8,000 − 3,800 = 4,200 (< 5,000, but > 50% of min)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR3,
      type: 'deposit',
      amount: '8000.00',
      memo: 'Employment matter retainer',
      occurredAt: atTime(90, 9, 0),
      createdAt: atTime(90, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR3,
      type: 'withdrawal',
      amount: '3800.00',
      memo: 'Applied to invoice',
      occurredAt: atTime(10, 16, 0),
      createdAt: atTime(10, 16, 0),
    },
    // TR4 critical: 12,000 − 7,000 − 4,500 = 500 (well below 8,000 min)
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR4,
      type: 'deposit',
      amount: '12000.00',
      memo: 'Real estate retainer',
      occurredAt: atTime(100, 9, 0),
      createdAt: atTime(100, 9, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR4,
      type: 'withdrawal',
      amount: '7000.00',
      memo: 'Title & escrow costs',
      occurredAt: atTime(30, 11, 0),
      createdAt: atTime(30, 11, 0),
    },
    {
      firmId: DEMO_FIRM_ID,
      trustAccountId: TR4,
      type: 'withdrawal',
      amount: '4500.00',
      memo: 'Applied to invoice',
      occurredAt: atTime(8, 15, 0),
      createdAt: atTime(8, 15, 0),
    },
  ])

  // ----------------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------------
  const statusTally = invoiceRows.reduce<Record<string, number>>((acc, inv) => {
    acc[inv.status ?? 'draft'] = (acc[inv.status ?? 'draft'] ?? 0) + 1
    return acc
  }, {})
  const billableEntries = allEntries.filter(
    (e) => e.row.billable === 'billable',
  ).length
  const wipEntries = allEntries.filter(
    (e) => e.row.billable === 'billable' && e.row.invoiceId == null,
  ).length

  console.log('Seed complete:')
  console.log(`  firms:              1`)
  console.log(`  users:              ${USERS.length}`)
  console.log(`  clients:            ${CLIENTS.length}`)
  console.log(`  matters:            ${MATTERS.length}`)
  console.log(
    `  time_entries:       ${allEntries.length} (${billableEntries} billable, ${wipEntries} unbilled WIP)`,
  )
  console.log(
    `  invoices:           ${invoiceRows.length} ${JSON.stringify(statusTally)}`,
  )
  console.log(`  trust_accounts:     4`)
}

runSeed()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Seed failed:', err)
    await pool.end()
    process.exit(1)
  })
