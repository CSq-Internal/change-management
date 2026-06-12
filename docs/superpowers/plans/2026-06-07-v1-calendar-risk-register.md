# v1.0 Bundle 2 — Change Calendar + Risk Register — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two stub pages `/calendar` and `/risk-register` into real DB-backed features — a month-grid change calendar with collision/blackout conflict detection and drag-to-reschedule, and a full systemic risk register with likelihood × impact scoring.

**Architecture:** Two independent slices. Part A: pure conflict math in `src/lib/calendar.ts` feeds a server-rendered month grid; a new `rescheduleChange` server action handles drag-drops with the same blackout policy as submit. Part B: a new `RiskRegister` Prisma model + pure `riskScore`/`riskBand` helper + scoped CRUD actions audited to the existing `AdminAuditLog`, rendered as a table with an admin create/edit dialog. Both follow existing patterns: `opcoFilter` scoping (`reports/page.tsx`), inline pills (`change-badges.tsx`), custom modal dialogs (`cab-add-dialog.tsx`), native `<select>`, plain `<table>`.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Prisma v7, Vitest (jsdom + db-mocked), HTML5 drag-and-drop, Playwright MCP for smoke.

---

## File Structure

**Create:**
- `src/lib/calendar.ts` + `src/test/lib/calendar.test.ts` — pure conflict detection.
- `src/lib/risk-score.ts` + `src/test/lib/risk-score.test.ts` — pure scoring.
- `src/server/actions/risk-register.ts` + `src/test/actions/risk-register.test.ts` — scoped CRUD.
- `src/test/actions/reschedule.test.ts` — `rescheduleChange` tests (own mocks; keeps `changes.test.ts` untouched).
- `src/app/(dashboard)/calendar/calendar-client.tsx` — month grid + drag.
- `src/app/(dashboard)/risk-register/risk-register-client.tsx` — table + dialog.
- `prisma/migrations/20260607120000_risk_register/migration.sql`

**Modify:**
- `prisma/schema.prisma` — `RiskCategory`, `RiskStatus`, `RiskRegister` + `OpCo.risks` / `User.risksAuthored` back-relations.
- `src/server/actions/changes.ts` — add `rescheduleChange`.
- `src/app/(dashboard)/calendar/page.tsx` — replace stub with server component.
- `src/app/(dashboard)/risk-register/page.tsx` — replace stub with server component.
- `src/lib/i18n.ts` — calendar + risk-register strings (en + fr).

---

## Task 1: Calendar conflict math (TDD, pure)

**Files:**
- Create: `src/lib/calendar.ts`
- Test: `src/test/lib/calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/calendar.test.ts`:

```ts
// src/test/lib/calendar.test.ts
import { describe, it, expect } from 'vitest'
import { windowsIntersect, computeConflicts, type CalChange, type CalBlackout } from '@/lib/calendar'

const H = 3_600_000
const base = 1_000_000_000_000
const chg = (over: Partial<CalChange>): CalChange => ({
  id: 'c', opcoId: 'o1', infrastructureType: 'Wifi', riskLevel: 'low',
  isEmergency: false, start: base, end: base + 2 * H, ...over,
})

describe('windowsIntersect', () => {
  it('true when windows overlap', () => {
    expect(windowsIntersect(0, 10, 5, 15)).toBe(true)
  })
  it('false when they only touch at the edge (half-open)', () => {
    expect(windowsIntersect(0, 10, 10, 20)).toBe(false)
  })
  it('false when disjoint', () => {
    expect(windowsIntersect(0, 5, 10, 20)).toBe(false)
  })
})

describe('computeConflicts — overlap', () => {
  it('flags two changes, same opco + same infra, overlapping window', () => {
    const a = chg({ id: 'a' })
    const b = chg({ id: 'b', start: base + H }) // overlaps a
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(true)
    expect(m.get('a')!.overlapWith).toEqual(['b'])
    expect(m.get('b')!.overlap).toBe(true)
  })

  it('does NOT flag overlap when infrastructureType differs', () => {
    const a = chg({ id: 'a', infrastructureType: 'Wifi' })
    const b = chg({ id: 'b', infrastructureType: 'Backbone IP Network', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(false)
    expect(m.get('b')!.overlap).toBe(false)
  })

  it('does NOT flag overlap across different opcos', () => {
    const a = chg({ id: 'a', opcoId: 'o1' })
    const b = chg({ id: 'b', opcoId: 'o2', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(false)
  })

  it('severity is the highest risk among the colliding pair', () => {
    const a = chg({ id: 'a', riskLevel: 'low' })
    const b = chg({ id: 'b', riskLevel: 'high', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.severity).toBe('high')
    expect(m.get('b')!.severity).toBe('high')
  })

  it('severity is null when there is no overlap', () => {
    const m = computeConflicts([chg({ id: 'a' })], [])
    expect(m.get('a')!.severity).toBe(null)
  })
})

describe('computeConflicts — blackout', () => {
  it('flags a change whose window intersects its OpCo blackout', () => {
    const a = chg({ id: 'a' })
    const bo: CalBlackout = { id: 'bo', opcoId: 'o1', label: 'Q-end freeze', start: base + H, end: base + 3 * H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(true)
    expect(m.get('a')!.blackoutLabels).toEqual(['Q-end freeze'])
  })

  it('applies a group-wide (opcoId null) blackout to any opco', () => {
    const a = chg({ id: 'a', opcoId: 'o9' })
    const bo: CalBlackout = { id: 'bo', opcoId: null, label: 'Group freeze', start: base, end: base + H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(true)
  })

  it('does NOT apply another OpCo blackout', () => {
    const a = chg({ id: 'a', opcoId: 'o1' })
    const bo: CalBlackout = { id: 'bo', opcoId: 'o2', label: 'Other', start: base, end: base + H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/test/lib/calendar.test.ts`
Expected: FAIL — `Cannot find module '@/lib/calendar'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar.ts`:

```ts
// src/lib/calendar.ts
// Pure calendar conflict detection — no DB. Unit-tested in src/test/lib/calendar.test.ts.

export type RiskLevel = "low" | "medium" | "high" | "emergency"

export type CalChange = {
  id: string
  opcoId: string
  infrastructureType: string
  riskLevel: RiskLevel
  isEmergency: boolean
  start: number // plannedStart epoch ms
  end: number   // plannedEnd epoch ms
}

export type CalBlackout = {
  id: string
  opcoId: string | null // null = group-wide
  label: string
  start: number
  end: number
}

export type ChangeConflicts = {
  overlap: boolean
  blackout: boolean
  blackoutLabels: string[]
  overlapWith: string[]
  severity: RiskLevel | null // highest risk among self + overlap peers; null when no overlap
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "emergency"]

/** Half-open intersection: touching edges do NOT count as a conflict. */
export function windowsIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

export function computeConflicts(changes: CalChange[], blackouts: CalBlackout[]): Map<string, ChangeConflicts> {
  const result = new Map<string, ChangeConflicts>()

  for (const c of changes) {
    // Overlap: same opco + same infrastructure type + intersecting window.
    const peers = changes.filter(
      (o) =>
        o.id !== c.id &&
        o.opcoId === c.opcoId &&
        o.infrastructureType === c.infrastructureType &&
        windowsIntersect(c.start, c.end, o.start, o.end)
    )
    const overlap = peers.length > 0
    const severity = overlap
      ? peers.reduce<RiskLevel>((acc, p) => maxRisk(acc, p.riskLevel), c.riskLevel)
      : null

    // Blackout: applicable blackout (own opco or group-wide) intersecting the window.
    const hitBlackouts = blackouts.filter(
      (b) =>
        (b.opcoId === c.opcoId || b.opcoId === null) &&
        windowsIntersect(c.start, c.end, b.start, b.end)
    )

    result.set(c.id, {
      overlap,
      blackout: hitBlackouts.length > 0,
      blackoutLabels: hitBlackouts.map((b) => b.label),
      overlapWith: peers.map((p) => p.id),
      severity,
    })
  }

  return result
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/test/lib/calendar.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar.ts src/test/lib/calendar.test.ts
git commit -m "feat(calendar): add pure conflict detection (overlap + blackout)"
```

---

## Task 2: `rescheduleChange` server action (TDD, db-mocked)

**Files:**
- Modify: `src/server/actions/changes.ts`
- Test: `src/test/actions/reschedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/reschedule.test.ts`:

```ts
// src/test/actions/reschedule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-req', email: 'req@csquared.com', name: 'Req',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-req', keycloakId: 'kc-req' }) },
  changeRequest: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'c1' }),
  },
  blackoutPeriod: { findMany: vi.fn().mockResolvedValue([]) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/email', () => ({
  sendApprovalRequestEmail: vi.fn(), sendEmergencyAlertEmail: vi.fn(),
}))

import { rescheduleChange } from '@/server/actions/changes'

const NEW_START = '2026-07-01T02:00:00.000Z'
const NEW_END = '2026-07-01T04:00:00.000Z'

const pendingChange = {
  id: 'c1', status: 'pending', requesterId: 'user-req', opcoId: 'opco-1',
  isEmergency: false, plannedStart: new Date('2026-06-01T02:00:00Z'),
  plannedEnd: new Date('2026-06-01T04:00:00Z'), opco: { slug: 'ghana' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req', keycloakId: 'kc-req' })
  mockDb.changeRequest.update.mockResolvedValue({ id: 'c1' })
  mockDb.blackoutPeriod.findMany.mockResolvedValue([])
})

describe('rescheduleChange', () => {
  it('reschedules a pending change and writes a "rescheduled" audit entry', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    await rescheduleChange('c1', NEW_START, NEW_END)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { plannedStart: new Date(NEW_START), plannedEnd: new Date(NEW_END) } })
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'rescheduled' }) })
    )
  })

  it('rejects an implemented change (status guard)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, status: 'implemented' })
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/unimplemented/i)
  })

  it('rejects an invalid window (end <= start)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    await expect(rescheduleChange('c1', NEW_END, NEW_START)).rejects.toThrow(/Invalid/i)
  })

  it('blocks a non-emergency landing in a blackout', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    mockDb.blackoutPeriod.findMany.mockResolvedValue([{ label: 'Freeze' }])
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/blackout/i)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('lets an emergency override a blackout', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, isEmergency: true })
    mockDb.blackoutPeriod.findMany.mockResolvedValue([{ label: 'Freeze' }])
    await rescheduleChange('c1', NEW_START, NEW_END)
    expect(mockDb.changeRequest.update).toHaveBeenCalled()
  })

  it('forbids a non-requester non-admin', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, requesterId: 'someone-else' })
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/Forbidden/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/test/actions/reschedule.test.ts`
Expected: FAIL — `rescheduleChange` is not exported.

- [ ] **Step 3: Add the action**

In `src/server/actions/changes.ts`, append this exported function at the end of the file (the imports `getAppSession`, `getPrisma`, `isGroupAdmin`, `hasRoleInOpCo` are already present):

```ts
const RESCHEDULABLE_STATUSES = ["draft", "pending", "approved"]

export async function rescheduleChange(id: string, newStartIso: string, newEndIso: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id }, include: { opco: true } })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can reschedule this change")

  if (!RESCHEDULABLE_STATUSES.includes(change.status))
    throw new Error("Only unimplemented changes (draft, pending, approved) can be rescheduled")

  const newStart = new Date(newStartIso)
  const newEnd = new Date(newEndIso)
  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()) || newEnd <= newStart)
    throw new Error("Invalid reschedule window")

  // Blackout is a hard block (overlap is only a soft calendar warning), unless emergency.
  if (!change.isEmergency) {
    const blackouts = await db.blackoutPeriod.findMany({
      where: {
        OR: [{ opcoId: change.opcoId }, { opcoId: null }],
        startsAt: { lt: newEnd },
        endsAt: { gt: newStart },
      },
    })
    if (blackouts.length > 0)
      throw new Error(`Blocked by blackout: "${blackouts[0].label}". Emergencies may override.`)
  }

  const oldWindow = change.plannedStart && change.plannedEnd
    ? `${change.plannedStart.toISOString()} – ${change.plannedEnd.toISOString()}`
    : "unscheduled"
  const updated = await db.changeRequest.update({
    where: { id },
    data: { plannedStart: newStart, plannedEnd: newEnd },
  })
  await db.auditLog.create({
    data: {
      changeId: id, actorId: user.id, action: "rescheduled",
      note: `Rescheduled ${oldWindow} to ${newStart.toISOString()} – ${newEnd.toISOString()}`,
    },
  })
  return updated
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/test/actions/reschedule.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/reschedule.test.ts
git commit -m "feat(calendar): add rescheduleChange action with blackout hard-block"
```

---

## Task 3: Calendar page (server, DB-backed)

**Files:**
- Modify: `src/app/(dashboard)/calendar/page.tsx` (replace the stub entirely)

- [ ] **Step 1: Replace the stub with a server component**

Overwrite `src/app/(dashboard)/calendar/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, isGroupLevel, hasRoleInOpCo } from "@/lib/permissions"
import { computeConflicts, type CalChange, type CalBlackout, type RiskLevel } from "@/lib/calendar"
import CalendarClient, { type CalDay, type CalChipData } from "./calendar-client"

function monthBounds(monthParam: string | undefined): { start: Date; end: Date; label: string } {
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth() // 0-based
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yy, mm] = monthParam.split("-").map(Number)
    y = yy; m = mm - 1
  }
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 1)
  const label = start.toLocaleString(undefined, { month: "long", year: "numeric" })
  return { start, end, label }
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const { month } = await searchParams
  const { start, end, label } = monthBounds(month)

  const db = getPrisma()
  const me = session.user
  const groupLevel = isGroupLevel(me.realmRoles)
  const opcoSlugs = me.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const meUser = await db.user.findUnique({ where: { keycloakId: me.keycloakId }, select: { id: true } })

  const [changeRows, blackoutRows] = await Promise.all([
    db.changeRequest.findMany({
      where: { ...opcoFilter, plannedStart: { lt: end }, plannedEnd: { gte: start } },
      select: {
        id: true, title: true, opcoId: true, infrastructureType: true, riskLevel: true,
        isEmergency: true, status: true, plannedStart: true, plannedEnd: true, requesterId: true,
        opco: { select: { slug: true, name: true } },
      },
    }),
    db.blackoutPeriod.findMany({
      where: {
        startsAt: { lt: end }, endsAt: { gte: start },
        ...(groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] }),
      },
      select: { id: true, label: true, opcoId: true, startsAt: true, endsAt: true },
    }),
  ])

  const calChanges: CalChange[] = changeRows.map((c) => ({
    id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType,
    riskLevel: c.riskLevel as RiskLevel, isEmergency: c.isEmergency,
    start: c.plannedStart!.getTime(), end: c.plannedEnd!.getTime(),
  }))
  const calBlackouts: CalBlackout[] = blackoutRows.map((b) => ({
    id: b.id, opcoId: b.opcoId, label: b.label, start: b.startsAt.getTime(), end: b.endsAt.getTime(),
  }))
  const conflicts = computeConflicts(calChanges, calBlackouts)

  const canReschedule = (c: (typeof changeRows)[number]) =>
    ["draft", "pending", "approved"].includes(c.status) &&
    (c.requesterId === meUser?.id ||
      isGroupAdmin(me.realmRoles) ||
      hasRoleInOpCo(me.organizations, c.opco.slug, "admin"))

  // Bucket chips by ISO day (YYYY-MM-DD) of plannedStart.
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const chips: CalChipData[] = changeRows.map((c) => {
    const cf = conflicts.get(c.id)!
    return {
      id: c.id, title: c.title, opcoName: c.opco.name, riskLevel: c.riskLevel, status: c.status,
      startMs: c.plannedStart!.getTime(), endMs: c.plannedEnd!.getTime(),
      timeLabel: c.plannedStart!.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      day: dayKey(c.plannedStart!),
      overlap: cf.overlap, blackout: cf.blackout, severity: cf.severity,
      blackoutLabels: cf.blackoutLabels, canReschedule: canReschedule(c),
    }
  })

  // Build the month grid (Mon-start weeks).
  const firstWeekday = (start.getDay() + 6) % 7 // 0 = Monday
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const cells: CalDay[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `pad-${i}`, inMonth: false, dayNum: null, isToday: false })
  const today = new Date()
  const todayKey = dayKey(today)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(start.getFullYear(), start.getMonth(), d)
    cells.push({ key: dayKey(date), inMonth: true, dayNum: d, isToday: dayKey(date) === todayKey })
  }
  while (cells.length % 7 !== 0) cells.push({ key: `pad-end-${cells.length}`, inMonth: false, dayNum: null, isToday: false })

  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1)
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const fmtMonthParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`

  return (
    <CalendarClient
      monthLabel={label}
      prevMonth={fmtMonthParam(prev)}
      nextMonth={fmtMonthParam(next)}
      cells={cells}
      chips={chips}
    />
  )
}
```

- [ ] **Step 2: Type-check (expected to fail until Task 4 creates the client)**

Run: `pnpm tsc --noEmit`
Expected: FAIL — `./calendar-client` not found yet. That's fine; Task 4 creates it. (Do not commit yet — commit page + client together at the end of Task 4.)

---

## Task 4: Calendar client (month grid + drag) + i18n

**Files:**
- Create: `src/app/(dashboard)/calendar/calendar-client.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add i18n strings**

In `src/lib/i18n.ts`, add to the English map (near other nav/page keys):

```ts
    "calendar.subtitle": "Scheduled changes and operational constraints.",
    "calendar.prev": "Previous",
    "calendar.next": "Next",
    "calendar.today": "Today",
    "calendar.conflict.overlap": "Overlapping change on the same network",
    "calendar.conflict.blackout": "Scheduled during a blackout",
    "calendar.reschedule.success": "Change rescheduled",
    "calendar.reschedule.failed": "Could not reschedule",
    "calendar.empty": "No scheduled changes this month.",
```

and to the French map:

```ts
    "calendar.subtitle": "Changements planifiés et contraintes opérationnelles.",
    "calendar.prev": "Précédent",
    "calendar.next": "Suivant",
    "calendar.today": "Aujourd'hui",
    "calendar.conflict.overlap": "Changement simultané sur le même réseau",
    "calendar.conflict.blackout": "Planifié pendant un gel",
    "calendar.reschedule.success": "Changement reprogrammé",
    "calendar.reschedule.failed": "Reprogrammation impossible",
    "calendar.empty": "Aucun changement planifié ce mois-ci.",
```

- [ ] **Step 2: Create the client**

Create `src/app/(dashboard)/calendar/calendar-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { rescheduleChange } from "@/server/actions/changes"
import type { RiskLevel } from "@/lib/calendar"

export type CalDay = { key: string; inMonth: boolean; dayNum: number | null; isToday: boolean }
export type CalChipData = {
  id: string; title: string; opcoName: string; riskLevel: string; status: string
  startMs: number; endMs: number; timeLabel: string; day: string
  overlap: boolean; blackout: boolean; severity: RiskLevel | null
  blackoutLabels: string[]; canReschedule: boolean
}

const SEVERITY_RING: Record<string, string> = {
  low: "ring-emerald-400", medium: "ring-amber-400", high: "ring-orange-500", emergency: "ring-rose-500",
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export default function CalendarClient({
  monthLabel, prevMonth, nextMonth, cells, chips,
}: {
  monthLabel: string; prevMonth: string; nextMonth: string; cells: CalDay[]; chips: CalChipData[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dragId, setDragId] = useState<string | null>(null)

  const chipsByDay = new Map<string, CalChipData[]>()
  for (const c of chips) {
    const arr = chipsByDay.get(c.day) ?? []
    arr.push(c)
    chipsByDay.set(c.day, arr)
  }
  for (const arr of chipsByDay.values()) arr.sort((a, b) => a.startMs - b.startMs)

  const onDrop = (dayKey: string) => {
    const chip = chips.find((c) => c.id === dragId)
    setDragId(null)
    if (!chip || chip.day === dayKey) return
    // Preserve time-of-day + duration: move plannedStart to the dropped day, shift end by the same delta.
    const [y, m, d] = dayKey.split("-").map(Number)
    const oldStart = new Date(chip.startMs)
    const newStart = new Date(y, m - 1, d, oldStart.getHours(), oldStart.getMinutes(), 0, 0)
    const delta = newStart.getTime() - chip.startMs
    const newEnd = new Date(chip.endMs + delta)
    startTransition(async () => {
      try {
        await rescheduleChange(chip.id, newStart.toISOString(), newEnd.toISOString())
        toast({ title: t(language, "calendar.reschedule.success"), variant: "success" })
        router.refresh()
      } catch (err) {
        toast({
          title: t(language, "calendar.reschedule.failed"),
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{monthLabel}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "calendar.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/calendar?month=${prevMonth}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">‹ {t(language, "calendar.prev")}</Link>
          <Link href="/calendar" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">{t(language, "calendar.today")}</Link>
          <Link href={`/calendar?month=${nextMonth}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">{t(language, "calendar.next")} ›</Link>
        </div>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-px text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (<div key={w} className="px-2 py-1">{w}</div>))}
          </div>
          <div className={`grid grid-cols-7 gap-px ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
            {cells.map((cell) => {
              const dayChips = cell.inMonth ? (chipsByDay.get(cell.key) ?? []) : []
              return (
                <div
                  key={cell.key}
                  onDragOver={(e) => { if (cell.inMonth) e.preventDefault() }}
                  onDrop={() => { if (cell.inMonth) onDrop(cell.key) }}
                  className={`min-h-24 rounded-md border p-1 ${cell.inMonth ? "border-border/60 bg-background" : "border-transparent bg-muted/30"} ${cell.isToday ? "ring-2 ring-primary/60" : ""}`}
                >
                  {cell.dayNum != null && (
                    <div className={`mb-1 text-xs ${cell.isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{cell.dayNum}</div>
                  )}
                  <div className="space-y-1">
                    {dayChips.map((chip) => (
                      <Link
                        key={chip.id}
                        href={`/changes/${chip.id}`}
                        draggable={chip.canReschedule}
                        onDragStart={() => setDragId(chip.id)}
                        title={[
                          `${chip.title} · ${chip.opcoName} · ${chip.timeLabel}`,
                          chip.overlap ? t(language, "calendar.conflict.overlap") : "",
                          chip.blackout ? `${t(language, "calendar.conflict.blackout")}: ${chip.blackoutLabels.join(", ")}` : "",
                        ].filter(Boolean).join("\n")}
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight bg-muted hover:bg-muted/70 ${chip.canReschedule ? "cursor-grab" : ""} ${chip.overlap && chip.severity ? `ring-2 ${SEVERITY_RING[chip.severity]}` : ""}`}
                      >
                        {chip.blackout && <span title={t(language, "calendar.conflict.blackout")}>🚫 </span>}
                        {chip.overlap && <span title={t(language, "calendar.conflict.overlap")}>⚠ </span>}
                        <span className="text-muted-foreground">{chip.timeLabel}</span> {chip.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Type-check + lint + build**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS, 0 errors. (Both Task 3's page and this client now resolve.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/calendar/page.tsx" "src/app/(dashboard)/calendar/calendar-client.tsx" src/lib/i18n.ts
git commit -m "feat(calendar): DB-backed month grid with conflicts + drag-to-reschedule"
```

---

## Task 5: Risk Register schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260607120000_risk_register/migration.sql`

- [ ] **Step 1: Add enums + model + back-relations**

In `prisma/schema.prisma`, add the two enums and the model (place near the other enums/models):

```prisma
enum RiskCategory {
  operational
  security
  compliance
  technical
}

enum RiskStatus {
  open
  mitigating
  closed
}

model RiskRegister {
  id             String       @id @default(cuid())
  title          String
  description    String
  category       RiskCategory
  likelihood     Int
  impact         Int
  owner          String
  mitigationPlan String?
  status         RiskStatus   @default(open)
  reviewDate     DateTime?
  opcoId         String?
  opco           OpCo?        @relation(fields: [opcoId], references: [id])
  createdById    String
  createdBy      User         @relation("RiskAuthor", fields: [createdById], references: [id])
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([opcoId])
  @@index([status])
}
```

Add the back-relations: in `model OpCo`, add `risks RiskRegister[]`; in `model User`, add `risksAuthored RiskRegister[] @relation("RiskAuthor")`.

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260607120000_risk_register/migration.sql`:

```sql
-- Risk Register
CREATE TYPE "RiskCategory" AS ENUM ('operational', 'security', 'compliance', 'technical');
CREATE TYPE "RiskStatus" AS ENUM ('open', 'mitigating', 'closed');

CREATE TABLE "RiskRegister" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "RiskCategory" NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "mitigationPlan" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'open',
    "reviewDate" TIMESTAMP(3),
    "opcoId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiskRegister_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskRegister_opcoId_idx" ON "RiskRegister"("opcoId");
CREATE INDEX "RiskRegister_status_idx" ON "RiskRegister"("status");

ALTER TABLE "RiskRegister" ADD CONSTRAINT "RiskRegister_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskRegister" ADD CONSTRAINT "RiskRegister_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the client**

Run: `pnpm prisma generate`
Expected: client regenerates with `RiskRegister`, `RiskCategory`, `RiskStatus`. (Do NOT run `migrate deploy` — applied live at smoke time.)

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607120000_risk_register/migration.sql
git commit -m "feat(risk): add RiskRegister model + migration"
```

---

## Task 6: Risk scoring helper (TDD, pure)

**Files:**
- Create: `src/lib/risk-score.ts`
- Test: `src/test/lib/risk-score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/risk-score.test.ts`:

```ts
// src/test/lib/risk-score.test.ts
import { describe, it, expect } from 'vitest'
import { riskScore, riskBand } from '@/lib/risk-score'

describe('riskScore', () => {
  it('multiplies likelihood by impact', () => {
    expect(riskScore(3, 4)).toBe(12)
  })
  it('clamps inputs to 1..5', () => {
    expect(riskScore(0, 9)).toBe(5)   // 1 * 5
    expect(riskScore(7, 7)).toBe(25)  // 5 * 5
  })
})

describe('riskBand', () => {
  it('maps score ranges to bands', () => {
    expect(riskBand(1)).toBe('low')
    expect(riskBand(4)).toBe('low')
    expect(riskBand(5)).toBe('medium')
    expect(riskBand(9)).toBe('medium')
    expect(riskBand(10)).toBe('high')
    expect(riskBand(15)).toBe('high')
    expect(riskBand(16)).toBe('critical')
    expect(riskBand(25)).toBe('critical')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/test/lib/risk-score.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `src/lib/risk-score.ts`:

```ts
// src/lib/risk-score.ts
// Pure risk scoring — no DB. Unit-tested in src/test/lib/risk-score.test.ts.

export type RiskBand = "low" | "medium" | "high" | "critical"

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))

export function riskScore(likelihood: number, impact: number): number {
  return clamp(likelihood) * clamp(impact)
}

export function riskBand(score: number): RiskBand {
  if (score <= 4) return "low"
  if (score <= 9) return "medium"
  if (score <= 15) return "high"
  return "critical"
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/test/lib/risk-score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/risk-score.ts src/test/lib/risk-score.test.ts
git commit -m "feat(risk): add risk-score + band helper"
```

---

## Task 7: Risk Register server actions (TDD, db-mocked)

**Files:**
- Create: `src/server/actions/risk-register.ts`
- Test: `src/test/actions/risk-register.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/risk-register.test.ts`:

```ts
// src/test/actions/risk-register.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin', email: 'admin@csquared.com', name: 'Admin',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  riskRegister: { create: vi.fn(async () => ({ id: 'r1' })), update: vi.fn(async () => ({ id: 'r1' })) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  riskRegister: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => ({ id: 'r1', opcoId: 'opco-gh', opco: { slug: 'ghana' } })),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { createRisk, listRisks } from '@/server/actions/risk-register'

const validInput = {
  title: 'Power instability', description: 'Grid drops', category: 'operational' as const,
  likelihood: 3, impact: 4, owner: 'Ops', mitigationPlan: 'Generators', status: 'open' as const,
  reviewDate: null, opcoSlug: 'ghana' as string | null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' })
})

describe('createRisk', () => {
  it('creates an OpCo risk for an OpCo admin and writes an admin-audit row', async () => {
    await createRisk(validInput)
    expect(tx.riskRegister.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Power instability', opcoId: 'opco-gh' }) })
    )
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'risk_created' }) })
    )
  })

  it('rejects an out-of-range likelihood', async () => {
    await expect(createRisk({ ...validInput, likelihood: 9 })).rejects.toThrow(/1.*5/)
  })

  it('forbids an OpCo admin creating a group-scoped risk', async () => {
    await expect(createRisk({ ...validInput, opcoSlug: null })).rejects.toThrow(/Forbidden/i)
  })
})

describe('listRisks', () => {
  it('scopes an OpCo user to their OpCos plus group-wide risks', async () => {
    await listRisks()
    expect(mockDb.riskRegister.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ opcoId: null }, { opco: { slug: { in: ['ghana'] } } }] },
      })
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/test/actions/risk-register.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `src/server/actions/risk-register.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isGroupLevel, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import type { RiskCategory, RiskStatus } from "@prisma/client"

export type RiskInput = {
  title: string
  description: string
  category: RiskCategory
  likelihood: number
  impact: number
  owner: string
  mitigationPlan: string | null
  status: RiskStatus
  reviewDate: string | null // ISO or null
  opcoSlug: string | null   // null = group-wide
}

function validate(input: RiskInput) {
  if (!input.title.trim() || !input.description.trim() || !input.owner.trim())
    throw new Error("Title, description and owner are required")
  if (![input.likelihood, input.impact].every((n) => Number.isInteger(n) && n >= 1 && n <= 5))
    throw new Error("Likelihood and impact must be integers from 1 to 5")
}

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const allowed = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!allowed) throw new Error("Forbidden: not authorized to manage risks in this scope")
  return session
}

export async function listRisks() {
  const session = await getAppSession()
  const db = getPrisma()
  const groupLevel = isGroupLevel(session.realmRoles)
  const opcoSlugs = session.organizations.map((o) => o.alias)
  return db.riskRegister.findMany({
    where: groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] },
    include: { opco: { select: { name: true, slug: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  })
}

export async function createRisk(input: RiskInput) {
  validate(input)
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
    if (!actor) throw new Error("User not found")
    const risk = await tx.riskRegister.create({
      data: {
        title: input.title, description: input.description, category: input.category,
        likelihood: input.likelihood, impact: input.impact, owner: input.owner,
        mitigationPlan: input.mitigationPlan, status: input.status,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
        opcoId: opco?.id ?? null, createdById: actor.id,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "risk_created",
      opcoId: opco?.id ?? null, summary: `Created risk "${input.title}"`,
    })
    return risk
  })
}

export async function updateRisk(id: string, input: RiskInput) {
  validate(input)
  const db = getPrisma()
  const existing = await db.riskRegister.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Risk not found")
  // Authorize against the risk's CURRENT scope and the target scope.
  await assertCanManage(existing.opco?.slug ?? null)
  const session = await assertCanManage(input.opcoSlug)
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")

  return db.$transaction(async (tx) => {
    const risk = await tx.riskRegister.update({
      where: { id },
      data: {
        title: input.title, description: input.description, category: input.category,
        likelihood: input.likelihood, impact: input.impact, owner: input.owner,
        mitigationPlan: input.mitigationPlan, status: input.status,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
        opcoId: opco?.id ?? null,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "risk_updated",
      opcoId: opco?.id ?? null, summary: `Updated risk "${input.title}"`,
    })
    return risk
  })
}

export async function setRiskStatus(id: string, status: RiskStatus) {
  const db = getPrisma()
  const existing = await db.riskRegister.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Risk not found")
  const session = await assertCanManage(existing.opco?.slug ?? null)
  return db.$transaction(async (tx) => {
    const risk = await tx.riskRegister.update({ where: { id }, data: { status } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: status === "closed" ? "risk_closed" : "risk_updated",
      opcoId: existing.opcoId, summary: `Set risk "${existing.title}" to ${status}`,
    })
    return risk
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/test/actions/risk-register.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/risk-register.ts src/test/actions/risk-register.test.ts
git commit -m "feat(risk): scoped CRUD actions with admin-audit"
```

---

## Task 8: Risk Register page (server)

**Files:**
- Modify: `src/app/(dashboard)/risk-register/page.tsx` (replace the stub)

- [ ] **Step 1: Replace the stub with a server component**

Overwrite `src/app/(dashboard)/risk-register/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listRisks } from "@/server/actions/risk-register"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import RiskRegisterClient, { type RiskRow } from "./risk-register-client"

export default async function RiskRegisterPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const risks = await listRisks()
  const rows: RiskRow[] = risks.map((r) => ({
    id: r.id, title: r.title, description: r.description, category: r.category,
    likelihood: r.likelihood, impact: r.impact, owner: r.owner,
    mitigationPlan: r.mitigationPlan ?? null, status: r.status,
    reviewDate: r.reviewDate ? r.reviewDate.toISOString() : null,
    opcoSlug: r.opco?.slug ?? null, opcoName: r.opco?.name ?? null,
  }))

  // OpCo slugs the user may manage (for the create/edit scope select).
  const manageableOpcos = session.user.organizations
    .filter((o) => o.roles.includes("admin"))
    .map((o) => ({ slug: o.alias, name: o.name }))

  return (
    <RiskRegisterClient
      rows={rows}
      canManage={canManageAnyOpCo(session.user.organizations, session.user.realmRoles)}
      canManageGroup={isGroupAdmin(session.user.realmRoles)}
      manageableOpcos={manageableOpcos}
    />
  )
}
```

- [ ] **Step 2: Type-check (expected to fail until Task 9)**

Run: `pnpm tsc --noEmit`
Expected: FAIL — `./risk-register-client` not found yet. Commit page + client together at end of Task 9.

---

## Task 9: Risk Register client (table + dialog) + i18n

**Files:**
- Create: `src/app/(dashboard)/risk-register/risk-register-client.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add i18n strings**

In `src/lib/i18n.ts`, add to the English map:

```ts
    "risk.subtitle": "Track systemic risks and mitigation plans.",
    "risk.new": "New risk",
    "risk.edit": "Edit",
    "risk.col.title": "Risk",
    "risk.col.category": "Category",
    "risk.col.score": "Score",
    "risk.col.owner": "Owner",
    "risk.col.status": "Status",
    "risk.col.review": "Review",
    "risk.col.scope": "Scope",
    "risk.scope.group": "Group",
    "risk.field.likelihood": "Likelihood (1-5)",
    "risk.field.impact": "Impact (1-5)",
    "risk.field.mitigation": "Mitigation plan",
    "risk.field.reviewDate": "Review date",
    "risk.save": "Save",
    "risk.cancel": "Cancel",
    "risk.saved": "Risk saved",
    "risk.failed": "Could not save risk",
    "risk.empty": "No risks recorded.",
```

and to the French map:

```ts
    "risk.subtitle": "Suivre les risques systémiques et les plans d'atténuation.",
    "risk.new": "Nouveau risque",
    "risk.edit": "Modifier",
    "risk.col.title": "Risque",
    "risk.col.category": "Catégorie",
    "risk.col.score": "Score",
    "risk.col.owner": "Responsable",
    "risk.col.status": "Statut",
    "risk.col.review": "Revue",
    "risk.col.scope": "Portée",
    "risk.scope.group": "Groupe",
    "risk.field.likelihood": "Probabilité (1-5)",
    "risk.field.impact": "Impact (1-5)",
    "risk.field.mitigation": "Plan d'atténuation",
    "risk.field.reviewDate": "Date de revue",
    "risk.save": "Enregistrer",
    "risk.cancel": "Annuler",
    "risk.saved": "Risque enregistré",
    "risk.failed": "Échec de l'enregistrement",
    "risk.empty": "Aucun risque enregistré.",
```

- [ ] **Step 2: Create the client**

Create `src/app/(dashboard)/risk-register/risk-register-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { riskScore, riskBand } from "@/lib/risk-score"
import { createRisk, updateRisk, type RiskInput } from "@/server/actions/risk-register"

export type RiskRow = {
  id: string; title: string; description: string; category: string
  likelihood: number; impact: number; owner: string; mitigationPlan: string | null
  status: string; reviewDate: string | null; opcoSlug: string | null; opcoName: string | null
}

const BAND_COLOR: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
}
const CATEGORIES = ["operational", "security", "compliance", "technical"] as const
const STATUSES = ["open", "mitigating", "closed"] as const

function ScoreBadge({ likelihood, impact }: { likelihood: number; impact: number }) {
  const score = riskScore(likelihood, impact)
  const band = riskBand(score)
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${BAND_COLOR[band]}`}>
      {score} · {band}
    </span>
  )
}

const emptyForm = (opcoSlug: string | null): RiskInput => ({
  title: "", description: "", category: "operational", likelihood: 3, impact: 3,
  owner: "", mitigationPlan: "", status: "open", reviewDate: null, opcoSlug,
})

export default function RiskRegisterClient({
  rows, canManage, canManageGroup, manageableOpcos,
}: {
  rows: RiskRow[]; canManage: boolean; canManageGroup: boolean
  manageableOpcos: { slug: string; name: string }[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState<{ id: string | null; form: RiskInput } | null>(null)

  const scopeOptions: { value: string; label: string }[] = [
    ...(canManageGroup ? [{ value: "", label: t(language, "risk.scope.group") }] : []),
    ...manageableOpcos.map((o) => ({ value: o.slug, label: o.name })),
  ]

  const openNew = () => setEditing({ id: null, form: emptyForm(scopeOptions[0]?.value || null) })
  const openEdit = (r: RiskRow) => setEditing({
    id: r.id,
    form: {
      title: r.title, description: r.description, category: r.category as RiskInput["category"],
      likelihood: r.likelihood, impact: r.impact, owner: r.owner,
      mitigationPlan: r.mitigationPlan, status: r.status as RiskInput["status"],
      reviewDate: r.reviewDate ? r.reviewDate.slice(0, 10) : null, opcoSlug: r.opcoSlug,
    },
  })

  const save = () => {
    if (!editing) return
    const { id, form } = editing
    startTransition(async () => {
      try {
        if (id) await updateRisk(id, form)
        else await createRisk(form)
        toast({ title: t(language, "risk.saved"), variant: "success" })
        setEditing(null)
        router.refresh()
      } catch (err) {
        toast({ title: t(language, "risk.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
      }
    })
  }

  const set = (patch: Partial<RiskInput>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "nav.riskRegister")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "risk.subtitle")}</p>
        </div>
        {canManage && scopeOptions.length > 0 && <Button onClick={openNew}>{t(language, "risk.new")}</Button>}
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "risk.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.title")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.category")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.score")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.owner")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.status")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.review")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.scope")}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{r.description}</div>
                    </td>
                    <td className="px-4 py-2 capitalize">{r.category}</td>
                    <td className="px-4 py-2"><ScoreBadge likelihood={r.likelihood} impact={r.impact} /></td>
                    <td className="px-4 py-2">{r.owner}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                    <td className="px-4 py-2">{r.reviewDate ? r.reviewDate.slice(0, 10) : "—"}</td>
                    <td className="px-4 py-2">{r.opcoName ?? t(language, "risk.scope.group")}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => openEdit(r)} className="text-xs text-primary hover:underline">{t(language, "risk.edit")}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !isPending && setEditing(null)}>
          <Card className="w-full max-w-lg border-border bg-card" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">{editing.id ? t(language, "risk.edit") : t(language, "risk.new")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder={t(language, "risk.col.title")} value={editing.form.title} onChange={(e) => set({ title: e.target.value })} />
              <Textarea placeholder="Description" value={editing.form.description} onChange={(e) => set({ description: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">{t(language, "risk.col.category")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm capitalize" value={editing.form.category} onChange={(e) => set({ category: e.target.value as RiskInput["category"] })}>
                    {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </label>
                <label className="text-xs">{t(language, "risk.col.status")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm capitalize" value={editing.form.status} onChange={(e) => set({ status: e.target.value as RiskInput["status"] })}>
                    {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </label>
                <label className="text-xs">{t(language, "risk.field.likelihood")}
                  <Input type="number" min={1} max={5} value={editing.form.likelihood} onChange={(e) => set({ likelihood: Number(e.target.value) })} />
                </label>
                <label className="text-xs">{t(language, "risk.field.impact")}
                  <Input type="number" min={1} max={5} value={editing.form.impact} onChange={(e) => set({ impact: Number(e.target.value) })} />
                </label>
              </div>
              <Input placeholder={t(language, "risk.col.owner")} value={editing.form.owner} onChange={(e) => set({ owner: e.target.value })} />
              <Textarea placeholder={t(language, "risk.field.mitigation")} value={editing.form.mitigationPlan ?? ""} onChange={(e) => set({ mitigationPlan: e.target.value || null })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">{t(language, "risk.field.reviewDate")}
                  <Input type="date" value={editing.form.reviewDate ?? ""} onChange={(e) => set({ reviewDate: e.target.value || null })} />
                </label>
                <label className="text-xs">{t(language, "risk.col.scope")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={editing.form.opcoSlug ?? ""} onChange={(e) => set({ opcoSlug: e.target.value || null })}>
                    {scopeOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={isPending}>{t(language, "risk.cancel")}</Button>
                <Button onClick={save} disabled={isPending}>{t(language, "risk.save")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS, 0 errors. (Verify `Input`/`Textarea`/`Button` accept the props used; if `Button` has no `variant="outline"`, check `src/components/ui/button.tsx` and use an available variant.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/risk-register/page.tsx" "src/app/(dashboard)/risk-register/risk-register-client.tsx" src/lib/i18n.ts
git commit -m "feat(risk): DB-backed risk register table + create/edit dialog"
```

---

## Task 10: Full verification + Playwright smoke

**Files:** none (verification + live migration)

- [ ] **Step 1: Full quality gate**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: tsc clean, lint 0 errors, all suites pass (existing + the new `calendar`, `risk-score`, `reschedule`, `risk-register` tests). Fix any regression before proceeding.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `prisma generate` + `next build` succeed; `/calendar` and `/risk-register` build as dynamic routes.

- [ ] **Step 3: Apply the migration live + restart dev**

Run (local DB from the dev-stack runbook; Postgres must be up):
```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/csquared_cms' pnpm prisma migrate deploy
```
Then restart `pnpm dev` (the running server caches the Prisma client — it must pick up `RiskRegister`).

- [ ] **Step 4: Playwright smoke — calendar**

As `devops@csquared.com` / `Admin2025$`: open `/calendar`. Confirm scheduled changes appear in day cells, a known overlap/blackout shows a ⚠/🚫 badge, prev/next month navigation works, and dragging a draggable change to another day reschedules it (toast success, chip moves). Drag a change so it lands in a blackout window and confirm the reschedule is blocked with a toast error.

- [ ] **Step 5: Playwright smoke — risk register**

Open `/risk-register`. Confirm the empty-state or existing rows render. As an admin, click "New risk", fill the form (likelihood 4 × impact 4), save, and confirm the row appears with a **16 · critical** score badge. Edit it and change the status to `mitigating`; confirm it updates. Verify a non-admin sees the table but no New/Edit controls.

- [ ] **Step 6: Final commit (only if smoke required fixes)**

```bash
git add -A
git commit -m "fix(bundle2): smoke-test adjustments"
```

---

## Self-Review notes (spec coverage)

- **Part A — Calendar:** Task 1 (conflict math: overlap = same opco+infra+window, severity = max risk, blackout incl. group-wide), Task 2 (`rescheduleChange`: status guard, permission, blackout hard-block + emergency bypass, audit), Tasks 3–4 (month grid, drag preserving time-of-day + duration, conflict badges colored by severity, prev/next nav). ✅
- **Part B — Risk Register:** Task 5 (model + migration), Task 6 (score/band: 1-4 low · 5-9 medium · 10-15 high · 16-25 critical), Task 7 (scoped CRUD audited to `AdminAuditLog`), Tasks 8–9 (table + admin create/edit dialog, score badge, scope select). ✅
- **i18n (en + fr):** Tasks 4, 9. ✅
- **Testing:** unit (calendar, risk-score), db-mocked actions (reschedule, risk-register), Playwright smoke (Task 10). ✅
- **Decisions honored:** overlap colored by higher risk of the pair; reschedule = requester or OpCo admin; risk owner is free-text; blackout hard-block matches submit policy; cross-OpCo overlap left as a documented v2 limitation (in the spec).
