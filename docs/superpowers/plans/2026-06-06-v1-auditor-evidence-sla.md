# v1.0 Bundle 1 — Auditor Evidence + SLA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three PRD-mandated v1.0 gaps — a per-change PDF audit-evidence package, automatic SLA breach escalation (OpCo admin → group) with the missing transactional emails, and a per-OpCo × risk SLA compliance report.

**Architecture:** Three loosely-coupled slices on top of the existing Next.js 16 / Prisma v7 / Postgres stack. (A) A Node-runtime API route streams a programmatically-built PDF (`@react-pdf/renderer`, no headless browser). (B) Pure tier-math in `src/lib/sla.ts` drives a DB orchestration `runDueEscalations` in `src/server/sla.ts`, fired both lazily on dashboard/approvals page load and via a secret-protected cron route. (C) A pure adherence calculator in `src/lib/sla-report.ts` feeds a new section on the existing reports page. Escalation audit entries are attributed to a lazily-upserted inactive `system` user so the immutable `AuditLog` FK stays valid.

**Tech Stack:** Next.js App Router (server components + route handlers), Prisma v7 (`@prisma/adapter-pg`), `@react-pdf/renderer`, Vitest (jsdom + db-mocked), Playwright MCP for smoke.

---

## File Structure

**Create:**
- `src/lib/sla.ts` — pure SLA constants + `dueEscalationLevel` tier math.
- `src/test/lib/sla.test.ts` — tier-math unit tests.
- `src/lib/sla-report.ts` — pure per-OpCo × risk adherence calc.
- `src/test/lib/sla-report.test.ts` — adherence unit tests.
- `src/server/sla.ts` — `runDueEscalations` orchestration + recipient/system-actor helpers.
- `src/test/server/sla.test.ts` — orchestration tests (db mocked).
- `src/server/pdf/evidence-document.tsx` — `@react-pdf` document component + `EvidenceChange` payload type.
- `src/app/api/changes/[id]/evidence.pdf/route.tsx` — PDF route handler (RBAC + stream).
- `src/test/server/evidence-route.test.ts` — PDF route RBAC + buffer tests.
- `src/app/api/cron/sla/route.ts` — secret-protected cron endpoint.
- `prisma/migrations/20260607000000_sla_escalation/migration.sql`

**Modify:**
- `prisma/schema.prisma` — `ChangeRequest.escalationLevel`, `ChangeRequest.lastEscalatedAt`.
- `src/server/actions/changes.ts` — import shared `SLA_HOURS`; emergency-alert email on submit.
- `src/server/email.ts` — `sendSlaEscalationEmail`, `sendEmergencyAlertEmail`.
- `.env.example` — `CRON_SECRET=`.
- `src/app/page.tsx` — fire-and-forget lazy escalation.
- `src/app/(dashboard)/approvals/page.tsx` — fire-and-forget lazy escalation.
- `src/app/(dashboard)/changes/[id]/page.tsx` — `canExportEvidence` cap.
- `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` — "Export evidence (PDF)" link + `Caps` field.
- `src/app/(dashboard)/reports/page.tsx` — load decision audit + compute compliance.
- `src/app/(dashboard)/reports/reports-client.tsx` — SLA compliance table.
- `src/lib/i18n.ts` — en + fr strings.

---

## Task 1: Dependency, schema, and shared SLA constants

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `prisma/schema.prisma:158-166` (ChangeRequest block)
- Create: `prisma/migrations/20260607000000_sla_escalation/migration.sql`
- Create: `src/lib/sla.ts`
- Modify: `src/server/actions/changes.ts:12`

- [ ] **Step 1: Install the PDF library**

Run:
```bash
pnpm add @react-pdf/renderer
```
Expected: adds `@react-pdf/renderer` to `dependencies` in `package.json`, updates `pnpm-lock.yaml`.

- [ ] **Step 2: Add the two columns to the schema**

In `prisma/schema.prisma`, inside `model ChangeRequest`, add the two fields right after the `retroApprovedAt` line (currently line 165):

```prisma
  retroApprovedAt    DateTime?
  escalationLevel    Int       @default(0)   // 0 none · 1 OpCo admin notified · 2 group notified
  lastEscalatedAt    DateTime?
  pir                PostImplementationReview?
```

(The `pir` line already exists — insert the two new lines between `retroApprovedAt` and `pir`.)

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260607000000_sla_escalation/migration.sql`:

```sql
-- Add SLA escalation tracking to ChangeRequest
ALTER TABLE "ChangeRequest" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChangeRequest" ADD COLUMN "lastEscalatedAt" TIMESTAMP(3);
```

- [ ] **Step 4: Apply the migration and regenerate the client**

Run:
```bash
DATABASE_URL="postgresql://csq:csq@localhost:5432/csq?schema=public" pnpm prisma migrate deploy && pnpm prisma generate
```
Expected: migration `20260607000000_sla_escalation` applied; client regenerates with the new fields. (Use the local `DATABASE_URL` from `reference_local_dev_stack`; adjust if different. If `migrate deploy` complains about drift, use `pnpm prisma migrate dev --name sla_escalation` instead.)

> **GOTCHA:** if `pnpm dev` is running, restart it after `prisma generate` — the dev server caches the Prisma client at startup and will otherwise 500 with "Unknown field".

- [ ] **Step 5: Create the shared SLA module**

Create `src/lib/sla.ts`:

```ts
// src/lib/sla.ts
// Pure SLA math — no DB, no I/O. Unit-tested in src/test/lib/sla.test.ts.
import type { RiskLevel } from "@prisma/client"

/** SLA window (hours) per risk level. Single source of truth, shared with submitChange. */
export const SLA_HOURS: Record<RiskLevel, number> = { low: 48, medium: 24, high: 4, emergency: 1 }

/**
 * Escalation level a pending change is *due* for, given its SLA deadline.
 *  - 0: not breached            (now < deadline)
 *  - 1: breached                (deadline <= now < deadline + 50% of the window)
 *  - 2: well past deadline      (now >= deadline + 50% of the window)
 */
export function dueEscalationLevel(
  slaDeadlineMs: number,
  slaWindowHours: number,
  nowMs: number
): 0 | 1 | 2 {
  if (nowMs < slaDeadlineMs) return 0
  const halfWindowMs = (slaWindowHours / 2) * 3_600_000
  if (nowMs < slaDeadlineMs + halfWindowMs) return 1
  return 2
}
```

- [ ] **Step 6: Point `changes.ts` at the shared constant (DRY)**

In `src/server/actions/changes.ts`, delete the local declaration at line 12:

```ts
const SLA_HOURS: Record<RiskLevel, number> = { low: 48, medium: 24, high: 4, emergency: 1 }
```

and add to the import block at the top of the file:

```ts
import { SLA_HOURS } from "@/lib/sla"
```

If removing the local `SLA_HOURS` leaves `RiskLevel` unused in `changes.ts`, remove `RiskLevel` from its `@prisma/client` import as well; if `RiskLevel` is still referenced elsewhere in the file, leave the import.

- [ ] **Step 7: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no errors). Confirms the schema field, generated client, and the `SLA_HOURS` move all line up.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml prisma/schema.prisma prisma/migrations/20260607000000_sla_escalation/migration.sql src/lib/sla.ts src/server/actions/changes.ts
git commit -m "feat(sla): add escalation columns, @react-pdf/renderer, shared SLA_HOURS"
```

---

## Task 2: SLA tier math (unit-tested)

**Files:**
- Test: `src/test/lib/sla.test.ts`
- (Implementation already written in Task 1 — this task proves it.)

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/sla.test.ts`:

```ts
// src/test/lib/sla.test.ts
import { describe, it, expect } from 'vitest'
import { dueEscalationLevel, SLA_HOURS } from '@/lib/sla'

const H = 3_600_000
const deadline = 1_000_000_000_000 // arbitrary epoch ms

describe('dueEscalationLevel', () => {
  it('returns 0 before the deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline - 1)).toBe(0)
  })

  it('returns 1 exactly at the deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline)).toBe(1)
  })

  it('returns 1 within the first 50% of the window past deadline', () => {
    // window 4h → half-window 2h; 1h59m past deadline is still level 1
    expect(dueEscalationLevel(deadline, 4, deadline + 2 * H - 1)).toBe(1)
  })

  it('returns 2 once 50% of the window has elapsed past deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline + 2 * H)).toBe(2)
  })

  it('scales the half-window with the risk window (48h low risk)', () => {
    expect(dueEscalationLevel(deadline, 48, deadline + 23 * H)).toBe(1)
    expect(dueEscalationLevel(deadline, 48, deadline + 24 * H)).toBe(2)
  })
})

describe('SLA_HOURS', () => {
  it('matches the documented risk windows', () => {
    expect(SLA_HOURS).toEqual({ low: 48, medium: 24, high: 4, emergency: 1 })
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm test src/test/lib/sla.test.ts`
Expected: PASS (implementation landed in Task 1). If it fails, fix `src/lib/sla.ts` until green.

- [ ] **Step 3: Commit**

```bash
git add src/test/lib/sla.test.ts
git commit -m "test(sla): cover dueEscalationLevel tier boundaries"
```

---

## Task 3: SLA compliance calculator (unit-tested)

**Files:**
- Create: `src/lib/sla-report.ts`
- Test: `src/test/lib/sla-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/sla-report.test.ts`:

```ts
// src/test/lib/sla-report.test.ts
import { describe, it, expect } from 'vitest'
import { computeSlaReport, type SlaReportRow } from '@/lib/sla-report'

const now = 2_000_000_000_000
const gh = { opcoSlug: 'ghana', opcoName: 'Ghana' }

describe('computeSlaReport', () => {
  it('counts a change decided before its deadline as in-SLA', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now, decidedAt: now - 10 },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ riskLevel: 'high', decided: 1, inSla: 1, adherencePct: 100 })
  })

  it('counts a change decided after its deadline as a breach', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now - 100, decidedAt: now },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells[0]).toMatchObject({ decided: 1, inSla: 0, adherencePct: 0 })
  })

  it('counts a still-pending change past its deadline as a breach', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now - 100, decidedAt: null },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells[0]).toMatchObject({ decided: 1, inSla: 0, adherencePct: 0 })
  })

  it('excludes a still-pending change within its deadline', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now + 100, decidedAt: null },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells).toHaveLength(0)
  })

  it('groups by opco × risk and computes adherence percentage', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'low', slaDeadline: now, decidedAt: now - 1 },   // in
      { ...gh, riskLevel: 'low', slaDeadline: now - 1, decidedAt: now },   // breach
      { opcoSlug: 'kenya', opcoName: 'Kenya', riskLevel: 'low', slaDeadline: now, decidedAt: now - 1 },
    ]
    const cells = computeSlaReport(rows, now)
    const ghLow = cells.find((c) => c.opcoSlug === 'ghana' && c.riskLevel === 'low')
    expect(ghLow).toMatchObject({ decided: 2, inSla: 1, adherencePct: 50 })
    expect(cells.find((c) => c.opcoSlug === 'kenya')).toMatchObject({ decided: 1, inSla: 1 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/lib/sla-report.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sla-report'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sla-report.ts`:

```ts
// src/lib/sla-report.ts
// Pure SLA-adherence calc — no DB. Unit-tested in src/test/lib/sla-report.test.ts.

export type SlaReportRow = {
  opcoSlug: string
  opcoName: string
  riskLevel: string
  slaDeadline: number | null // epoch ms
  decidedAt: number | null   // epoch ms of first approve/reject decision, or null if undecided
}

export type SlaReportCell = {
  opcoSlug: string
  opcoName: string
  riskLevel: string
  decided: number          // denominator: decided rows + pending-overdue rows
  inSla: number            // numerator: decided on-or-before deadline
  adherencePct: number | null // null when nothing counts yet
}

/**
 * Per-OpCo × risk SLA adherence.
 *  - Decided row → counts; in-SLA iff decidedAt <= slaDeadline (or no deadline set).
 *  - Pending row past deadline → counts as a breach.
 *  - Pending row within deadline → excluded (not yet decided).
 */
export function computeSlaReport(rows: SlaReportRow[], nowMs: number): SlaReportCell[] {
  const groups = new Map<string, SlaReportCell>()

  for (const r of rows) {
    const isDecided = r.decidedAt != null
    const isPendingOverdue = !isDecided && r.slaDeadline != null && nowMs > r.slaDeadline
    if (!isDecided && !isPendingOverdue) continue // pending within deadline → skip

    const key = `${r.opcoSlug}::${r.riskLevel}`
    let cell = groups.get(key)
    if (!cell) {
      cell = { opcoSlug: r.opcoSlug, opcoName: r.opcoName, riskLevel: r.riskLevel, decided: 0, inSla: 0, adherencePct: null }
      groups.set(key, cell)
    }

    cell.decided += 1
    const inSla = isDecided && (r.slaDeadline == null || r.decidedAt! <= r.slaDeadline)
    if (inSla) cell.inSla += 1
  }

  for (const cell of groups.values()) {
    cell.adherencePct = cell.decided === 0 ? null : Math.round((cell.inSla / cell.decided) * 100)
  }

  return [...groups.values()]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/lib/sla-report.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sla-report.ts src/test/lib/sla-report.test.ts
git commit -m "feat(sla): add per-opco x risk compliance calculator"
```

---

## Task 4: Transactional email templates

**Files:**
- Modify: `src/server/email.ts` (append two exports)
- Modify: `.env.example`

- [ ] **Step 1: Add the two templates**

In `src/server/email.ts`, append after `sendStatusChangeEmail` (end of file):

```ts
export async function sendSlaEscalationEmail(opts: {
  to: string; changeTitle: string; changeId: string; level: number; riskLevel: string
}) {
  const tier = opts.level >= 2 ? "group" : "OpCo admin"
  await dispatchEmail(
    opts.to,
    `SLA breach (level ${opts.level}): "${opts.changeTitle}"`,
    `<p>The <strong>${opts.riskLevel} risk</strong> change <strong>${opts.changeTitle}</strong> has breached its approval SLA and was escalated to <strong>${tier}</strong> level.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
}

export async function sendEmergencyAlertEmail(opts: {
  to: string; changeTitle: string; changeId: string; requesterName: string
}) {
  await dispatchEmail(
    opts.to,
    `Emergency change submitted: "${opts.changeTitle}"`,
    `<p><strong>${opts.requesterName}</strong> submitted an <strong>emergency</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
}
```

- [ ] **Step 2: Document the cron secret**

In `.env.example`, add (anywhere among the other vars):

```
# Shared secret for the SLA escalation cron endpoint (POST /api/cron/sla, header x-cron-secret)
CRON_SECRET=
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/email.ts .env.example
git commit -m "feat(email): add SLA escalation + emergency alert templates"
```

---

## Task 5: SLA escalation orchestration (db-mocked tests)

**Files:**
- Create: `src/server/sla.ts`
- Test: `src/test/server/sla.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/sla.test.ts`:

```ts
// src/test/server/sla.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  changeRequest: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  user: { upsert: vi.fn().mockResolvedValue({ id: 'system-user' }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/email', () => ({
  sendSlaEscalationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { runDueEscalations } from '@/server/sla'
import { sendSlaEscalationEmail } from '@/server/email'

const HOUR = 3_600_000

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.update.mockResolvedValue({})
  mockDb.user.upsert.mockResolvedValue({ id: 'system-user' })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
})

describe('runDueEscalations', () => {
  it('escalates a freshly-breached change to level 1 and emails OpCo admins', async () => {
    const deadline = Date.now() - 1 // just breached, high risk (4h window) → level 1
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { email: 'admin@ghana.com', isActive: true } },
    ])

    const res = await runDueEscalations({})

    expect(res.escalated).toBe(1)
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@ghana.com', level: 1 })
    )
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escalationLevel: 1 }) })
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'sla_escalated', actorId: 'system-user' }) })
    )
  })

  it('does NOT re-escalate a change already at its due level (idempotent)', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(Date.now() - 1), escalationLevel: 1 },
    ])
    const res = await runDueEscalations({})
    expect(res.escalated).toBe(0)
    expect(sendSlaEscalationEmail).not.toHaveBeenCalled()
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('notifies group CAB members for a level-2 breach and fires both crossed levels', async () => {
    const deadline = Date.now() - 3 * HOUR // high risk: half-window 2h → past 2h → level 2
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: { email: 'admin@ghana.com', isActive: true } }])
    mockDb.cABMembership.findMany.mockResolvedValue([{ user: { email: 'cab@group.com', isActive: true } }])

    const res = await runDueEscalations({})

    expect(res.escalated).toBe(1)
    // crossed level 1 (opco admin) AND level 2 (group cab) in one pass
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@ghana.com', level: 1 }))
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'cab@group.com', level: 2 }))
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escalationLevel: 2 }) })
    )
  })

  it('scopes the query to the given opcoSlugs', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([])
    await runDueEscalations({ opcoSlugs: ['ghana'] })
    expect(mockDb.changeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ opco: { slug: { in: ['ghana'] } } }),
      })
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server/sla.test.ts`
Expected: FAIL — `Cannot find module '@/server/sla'`.

- [ ] **Step 3: Write the implementation**

Create `src/server/sla.ts`:

```ts
// src/server/sla.ts
// SLA escalation orchestration. Called lazily on page load and from the cron route.
import { getPrisma } from "@/server/db"
import { dueEscalationLevel, SLA_HOURS } from "@/lib/sla"
import { sendSlaEscalationEmail } from "@/server/email"
import type { RiskLevel } from "@prisma/client"

type Db = ReturnType<typeof getPrisma>

/** Lazily upsert an inactive "system" user so escalation audit entries have a valid actor FK. */
async function systemActorId(db: Db): Promise<string> {
  const u = await db.user.upsert({
    where: { keycloakId: "system" },
    update: {},
    create: { keycloakId: "system", email: "system@csquared.com", name: "System", isActive: false },
    select: { id: true },
  })
  return u.id
}

async function opcoAdminEmails(db: Db, opcoId: string): Promise<string[]> {
  const rows = await db.userOpCoAssignment.findMany({
    where: { opcoId, role: "admin", isActive: true },
    select: { user: { select: { email: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => r.user.email)
}

async function groupCabEmails(db: Db): Promise<string[]> {
  const rows = await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    select: { user: { select: { email: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => r.user.email)
}

/**
 * Escalate every pending change whose SLA breach has crossed a new tier.
 * Idempotent: a level already recorded on the change is never re-sent.
 * Best-effort emails (Promise.allSettled); escalation state advances regardless
 * so repeated reads don't re-spam.
 */
export async function runDueEscalations(
  { opcoSlugs }: { opcoSlugs?: string[] }
): Promise<{ escalated: number }> {
  const db = getPrisma()
  const now = Date.now()

  const changes = await db.changeRequest.findMany({
    where: {
      status: "pending",
      slaDeadline: { not: null },
      ...(opcoSlugs ? { opco: { slug: { in: opcoSlugs } } } : {}),
    },
    select: { id: true, title: true, riskLevel: true, opcoId: true, slaDeadline: true, escalationLevel: true },
  })

  let escalated = 0
  let actorId: string | null = null

  for (const c of changes) {
    const target = dueEscalationLevel(c.slaDeadline!.getTime(), SLA_HOURS[c.riskLevel as RiskLevel], now)
    if (target <= c.escalationLevel) continue

    actorId ??= await systemActorId(db)

    for (let level = c.escalationLevel + 1; level <= target; level++) {
      const recipients = level === 1 ? await opcoAdminEmails(db, c.opcoId) : await groupCabEmails(db)
      await Promise.allSettled(
        recipients.map((to) =>
          sendSlaEscalationEmail({ to, changeTitle: c.title, changeId: c.id, level, riskLevel: c.riskLevel })
        )
      )
      await db.auditLog.create({
        data: { changeId: c.id, actorId, action: "sla_escalated", note: `Escalated to level ${level}` },
      })
    }

    await db.changeRequest.update({
      where: { id: c.id },
      data: { escalationLevel: target, lastEscalatedAt: new Date(now) },
    })
    escalated++
  }

  return { escalated }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/server/sla.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/sla.ts src/test/server/sla.test.ts
git commit -m "feat(sla): orchestrate due escalations with idempotent tier crossing"
```

---

## Task 6: Cron endpoint

**Files:**
- Create: `src/app/api/cron/sla/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/cron/sla/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { runDueEscalations } from "@/server/sla"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await runDueEscalations({})
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/sla/route.ts
git commit -m "feat(sla): add secret-protected escalation cron endpoint"
```

---

## Task 7: Lazy escalation triggers on dashboard + approvals

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/(dashboard)/approvals/page.tsx`

- [ ] **Step 1: Fire on dashboard load**

In `src/app/page.tsx`, add the import at the top:

```ts
import { runDueEscalations } from "@/server/sla"
```

Then immediately after `const opcoFilter = ...` (line 30) and before the `Promise.all`, add the fire-and-forget call:

```ts
  // Fire-and-forget SLA escalation sweep — never block render.
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})
```

- [ ] **Step 2: Fire on approvals load**

In `src/app/(dashboard)/approvals/page.tsx`, add the imports:

```ts
import { isGroupLevel } from "@/lib/permissions"
import { runDueEscalations } from "@/server/sla"
```

Then after `const me = ...` guard (after line 13) add:

```ts
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx "src/app/(dashboard)/approvals/page.tsx"
git commit -m "feat(sla): fire escalation sweep lazily on dashboard + approvals load"
```

---

## Task 8: Emergency alert email on submit

**Files:**
- Modify: `src/server/actions/changes.ts` (the `submitChange` server action, around line 156-200)

- [ ] **Step 1: Read the submit action to find the audit-write site**

Run: `pnpm exec grep -n "submitted" src/server/actions/changes.ts`
Expected: locates the `submitChange` action where status flips `draft → pending` and the `action: "submitted"` audit entry is written (~line 196). The change is loaded with `include: { opco: true, attachments: true }` (~line 156) and (separately, ~line 75/228) the routed-approver notification already fires here.

- [ ] **Step 2: Add the emergency alert**

In `src/server/actions/changes.ts`, add to the imports:

```ts
import { sendEmergencyAlertEmail } from "@/server/email"
import { getPrisma } from "@/server/db" // (already imported — do not duplicate)
```

Then in `submitChange`, after the audit entry for `"submitted"` is written and the existing approver-notification fires, add (using the already-loaded `change`, `db`, and the acting `user`):

```ts
  if (change.isEmergency) {
    const cab = await db.cABMembership.findMany({
      where: { opcoId: null, isActive: true },
      select: { user: { select: { email: true, isActive: true } } },
    })
    const requesterName = user.name ?? user.email
    await Promise.allSettled(
      cab
        .filter((m) => m.user.isActive)
        .map((m) =>
          sendEmergencyAlertEmail({
            to: m.user.email,
            changeTitle: change.title,
            changeId: change.id,
            requesterName,
          })
        )
    )
  }
```

> If the local `change` object in scope at the submit site lacks `isEmergency`/`title`, widen the `select`/`include` on its `findUnique` to include `isEmergency: true, title: true`. If the acting user variable is named differently (e.g. `me`/`actor`), use that name and ensure `name`/`email` are selected.

- [ ] **Step 3: Type-check + run the changes action tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/actions/changes.test.ts`
Expected: PASS — existing tests still green (the emergency branch is additive and best-effort). If a test mocks `@/server/email`, add `sendEmergencyAlertEmail: vi.fn().mockResolvedValue(undefined)` to that mock; if it mocks `db.cABMembership`, ensure `findMany` returns `[]` by default.

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(email): alert group CAB on emergency change submission"
```

---

## Task 9: PDF evidence document component

**Files:**
- Create: `src/server/pdf/evidence-document.tsx`

- [ ] **Step 1: Write the document component**

Create `src/server/pdf/evidence-document.tsx`:

```tsx
// src/server/pdf/evidence-document.tsx
// Server-only @react-pdf document. Rendered to a buffer in the evidence.pdf route.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { Prisma } from "@prisma/client"

export type EvidenceChange = Prisma.ChangeRequestGetPayload<{
  include: {
    opco: true
    requester: true
    implementedBy: true
    approvals: { include: { approver: true } }
    auditTrail: { include: { actor: true } }
    attachments: { include: { uploadedBy: true } }
    pir: { include: { author: true } }
  }
}>

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  confidential: { fontSize: 7, color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 6 },
  meta: { fontSize: 8, color: "#6b7280", marginBottom: 10 },
  flags: { flexDirection: "row", gap: 6, marginBottom: 8 },
  flag: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#b91c1c", border: "1px solid #b91c1c", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  section: { marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 6 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4, color: "#111827" },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 110, color: "#6b7280" },
  value: { flex: 1 },
  para: { marginBottom: 4 },
  item: { marginBottom: 3, paddingBottom: 3, borderBottom: "0.5px solid #f3f4f6" },
  muted: { color: "#9ca3af", fontStyle: "italic" },
})

function fmt(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—"
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

function Block({ title, text }: { title: string; text: string | null }) {
  return (
    <View style={styles.para}>
      <Text style={{ fontFamily: "Helvetica-Bold" }}>{title}</Text>
      <Text>{text?.trim() ? text : "—"}</Text>
    </View>
  )
}

export function EvidenceDocument({ change, generatedAt }: { change: EvidenceChange; generatedAt: Date }) {
  const c = change
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>CSquared CMS · Change Evidence Package</Text>
          <Text style={styles.confidential}>INTERNAL · CONFIDENTIAL</Text>
        </View>
        <Text style={styles.meta}>Reference #{c.reference} · generated {fmt(generatedAt)}</Text>

        <Text style={styles.title}>{c.title}</Text>
        <View style={styles.flags}>
          {c.isEmergency && <Text style={styles.flag}>EMERGENCY</Text>}
          {c.expedited && <Text style={styles.flag}>EXPEDITED</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Field label="OpCo" value={c.opco.name} />
          <Field label="Status" value={c.status} />
          <Field label="Risk" value={c.riskLevel} />
          <Field label="Category" value={c.category} />
          <Field label="Infrastructure" value={c.infrastructureType} />
          <Field label="Requester" value={c.requester.name ?? c.requester.email} />
          <Field label="Implementer" value={c.implementedBy ? (c.implementedBy.name ?? c.implementedBy.email) : "—"} />
          <Field label="Contact" value={c.contactEmail} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dates</Text>
          <Field label="Created" value={fmt(c.createdAt)} />
          <Field label="Planned start" value={fmt(c.plannedStart)} />
          <Field label="Planned end" value={fmt(c.plannedEnd)} />
          <Field label="SLA deadline" value={fmt(c.slaDeadline)} />
          <Field label="Implemented at" value={fmt(c.implementedAt)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change detail</Text>
          <Block title="Description" text={c.description} />
          <Block title="Change reason" text={c.changeReason} />
          <Block title="Impact scope" text={c.impactScope} />
          <Block title="Implementation plan" text={c.implementationPlan} />
          <Block title="Testing plan" text={c.testingPlan} />
          <Block title="Backout plan" text={c.backoutPlan} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attachments</Text>
          {c.attachments.length === 0 ? (
            <Text style={styles.muted}>No attachments.</Text>
          ) : (
            c.attachments.map((a) => (
              <Text key={a.id} style={styles.item}>
                {a.filename} · {a.kind} · {a.uploadedBy.name ?? a.uploadedBy.email} · {fmt(a.uploadedAt)}
              </Text>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Approvals</Text>
          {c.approvals.length === 0 ? (
            <Text style={styles.muted}>No approvals recorded.</Text>
          ) : (
            c.approvals.map((a) => (
              <View key={a.id} style={styles.item}>
                <Text>
                  {a.approver.name ?? a.approver.email} · {a.decision}
                  {a.isCab ? " (CAB)" : ""} · {fmt(a.decidedAt)}
                </Text>
                {a.comment ? <Text style={styles.muted}>{a.comment}</Text> : null}
              </View>
            ))
          )}
        </View>

        {c.pir ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Post-Implementation Review</Text>
            <Field label="Outcome" value={c.pir.outcome} />
            <Field label="Backout used" value={c.pir.backoutUsed ? "Yes" : "No"} />
            <Field label="Author" value={c.pir.author.name ?? c.pir.author.email} />
            <Field label="Recorded" value={fmt(c.pir.createdAt)} />
            <Block title="Summary" text={c.pir.summary} />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audit trail</Text>
          {c.auditTrail.map((e) => (
            <Text key={e.id} style={styles.item}>
              {fmt(e.at)} · {e.actor.name ?? e.actor.email} · {e.action}
              {e.fromStatus || e.toStatus ? ` (${e.fromStatus ?? "—"} → ${e.toStatus ?? "—"})` : ""}
              {e.note ? ` · ${e.note}` : ""}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS. (If `Prisma.ChangeRequestGetPayload` errors on the `pir` include shape, confirm the generated client picked up Task 1's `prisma generate`.)

- [ ] **Step 3: Commit**

```bash
git add src/server/pdf/evidence-document.tsx
git commit -m "feat(evidence): add @react-pdf change evidence document"
```

---

## Task 10: Evidence PDF route (RBAC + buffer tests)

**Files:**
- Create: `src/app/api/changes/[id]/evidence.pdf/route.tsx`
- Test: `src/test/server/evidence-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/evidence-route.test.ts`:

```ts
// src/test/server/evidence-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
vi.mock('@/auth', () => ({ auth: () => mockAuth() }))

const mockDb = { changeRequest: { findUnique: vi.fn() } }
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

// Stub the heavy PDF renderer — we assert wiring, not pixels.
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7 fake')),
  Document: () => null, Page: () => null, Text: () => null, View: () => null,
  StyleSheet: { create: (s: unknown) => s },
}))
vi.mock('@/server/pdf/evidence-document', () => ({ EvidenceDocument: () => null }))

import { GET } from '@/app/api/changes/[id]/evidence.pdf/route'

const ctx = { params: Promise.resolve({ id: 'c1' }) }
const ghanaChange = { id: 'c1', reference: 42, opco: { slug: 'ghana' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findUnique.mockResolvedValue(ghanaChange)
})

describe('GET /api/changes/[id]/evidence.pdf', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(401)
  })

  it('404 when the change does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [] } })
    mockDb.changeRequest.findUnique.mockResolvedValue(null)
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(404)
  })

  it('403 when an OpCo user requests a change outside their OpCos', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [{ alias: 'kenya', roles: ['approver'] }] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(403)
  })

  it('streams a PDF for an OpCo member', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [{ alias: 'ghana', roles: ['approver'] }] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('evidence-42.pdf')
  })

  it('streams a PDF for a group-level user on any OpCo', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: ['group_auditor'], organizations: [] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server/evidence-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/changes/[id]/evidence.pdf/route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/changes/[id]/evidence.pdf/route.tsx`:

```tsx
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel, isMemberOfOpCo } from "@/lib/permissions"
import { EvidenceDocument } from "@/server/pdf/evidence-document"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const db = getPrisma()
  const change = await db.changeRequest.findUnique({
    where: { id },
    include: {
      opco: true,
      requester: true,
      implementedBy: true,
      approvals: { include: { approver: true }, orderBy: { decidedAt: "asc" } },
      auditTrail: { include: { actor: true }, orderBy: { at: "asc" } },
      attachments: { include: { uploadedBy: true }, orderBy: { kind: "asc" } },
      pir: { include: { author: true } },
    },
  })
  if (!change) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!isGroupLevel(session.user.realmRoles) && !isMemberOfOpCo(session.user.organizations, change.opco.slug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const buffer = await renderToBuffer(<EvidenceDocument change={change} generatedAt={new Date()} />)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="evidence-${change.reference}.pdf"`,
    },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/server/evidence-route.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS. (The route is `.tsx` so JSX in the handler compiles.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/changes/[id]/evidence.pdf/route.tsx" src/test/server/evidence-route.test.ts
git commit -m "feat(evidence): add RBAC-guarded evidence.pdf route"
```

---

## Task 11: "Export evidence (PDF)" button on change detail

**Files:**
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx` (add `canExportEvidence` cap)
- Modify: `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` (`Caps` type + link)
- Modify: `src/lib/i18n.ts` (en + fr string)

- [ ] **Step 1: Add the i18n string**

In `src/lib/i18n.ts`, add to the English map (near the other `detail.*` keys, e.g. after `"detail.field.slaDeadline"` line 512):

```ts
    "detail.exportEvidence": "Export evidence (PDF)",
```

and to the French map (after the matching line ~1055):

```ts
    "detail.exportEvidence": "Exporter les preuves (PDF)",
```

- [ ] **Step 2: Compute the cap server-side**

In `src/app/(dashboard)/changes/[id]/page.tsx`, add `canAudit` to the permissions import (line 5):

```ts
import { isGroupAdmin, hasRoleInOpCo, isGroupLevel, canAudit } from "@/lib/permissions"
```

Then in the `caps` object (line 90-95), add the new field:

```ts
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApproveThis,
    isAdmin: isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    isCabMember: isGroupAdmin(me.realmRoles),
    canExportEvidence: isGroupLevel(me.realmRoles) || canAudit(me.organizations, me.realmRoles, slug),
  }
```

- [ ] **Step 3: Extend the `Caps` type + render the link**

In `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`, add the field to the `Caps` type (line 68-73):

```ts
export type Caps = {
  isRequester: boolean
  canApprove: boolean
  isAdmin: boolean
  isCabMember: boolean
  canExportEvidence: boolean
}
```

Then in the header card, render the link next to the status pill (inside the `flex flex-wrap items-center gap-2` div at lines 217-224, after `<StatusPill .../>`):

```tsx
                <StatusPill status={change.status} />
                {caps.canExportEvidence && (
                  <a
                    href={`/api/changes/${change.id}/evidence.pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {t(language, "detail.exportEvidence")}
                  </a>
                )}
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS, 0 errors. (`Caps` now requires `canExportEvidence`; the page.tsx change supplies it.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/changes/[id]/page.tsx" "src/app/(dashboard)/changes/[id]/change-detail-client.tsx" src/lib/i18n.ts
git commit -m "feat(evidence): add export-evidence link to change detail"
```

---

## Task 12: SLA compliance section on the reports page

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`
- Modify: `src/app/(dashboard)/reports/reports-client.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add i18n strings**

In `src/lib/i18n.ts`, add to the English map (near the other `reports.*` keys):

```ts
    "reports.slaComplianceTitle": "SLA compliance",
    "reports.slaComplianceDesc": "Approval-decision adherence per OpCo and risk level.",
    "reports.slaCol.opco": "OpCo",
    "reports.slaCol.risk": "Risk",
    "reports.slaCol.decided": "Decided",
    "reports.slaCol.inSla": "In SLA",
    "reports.slaCol.adherence": "Adherence",
    "reports.slaCompliance.empty": "No decided changes yet.",
```

and to the French map:

```ts
    "reports.slaComplianceTitle": "Conformité SLA",
    "reports.slaComplianceDesc": "Respect des délais de décision par OpCo et niveau de risque.",
    "reports.slaCol.opco": "OpCo",
    "reports.slaCol.risk": "Risque",
    "reports.slaCol.decided": "Décidées",
    "reports.slaCol.inSla": "Dans le SLA",
    "reports.slaCol.adherence": "Conformité",
    "reports.slaCompliance.empty": "Aucune modification décidée pour le moment.",
```

- [ ] **Step 2: Load decision audit + compute compliance server-side**

In `src/app/(dashboard)/reports/page.tsx`, add the import:

```ts
import { computeSlaReport, type SlaReportRow } from "@/lib/sla-report"
```

Replace the `changesRaw` query in the `Promise.all` (lines 27-31) with one that also pulls each change's OpCo and its approve/reject audit entries:

```ts
    db.changeRequest.findMany({
      where: opcoFilter,
      select: {
        id: true, title: true, status: true, riskLevel: true, createdAt: true, updatedAt: true,
        slaDeadline: true,
        opco: { select: { slug: true, name: true } },
        auditTrail: {
          where: { action: { in: ["approved", "rejected"] } },
          orderBy: { at: "asc" },
          take: 1,
          select: { at: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
```

Then after the `data` object is built (line 45), compute the compliance cells and add them to `data`:

```ts
  const now = Date.now()
  const slaRows: SlaReportRow[] = changesRaw.map((c) => ({
    opcoSlug: c.opco.slug,
    opcoName: c.opco.name,
    riskLevel: c.riskLevel,
    slaDeadline: c.slaDeadline ? c.slaDeadline.getTime() : null,
    decidedAt: c.auditTrail[0] ? c.auditTrail[0].at.getTime() : null,
  }))
  const slaCompliance = computeSlaReport(slaRows, now)
```

Add `slaCompliance` to the object passed to `ReportsClient`:

```ts
  const data = {
    byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count.status })),
    byRisk: byRiskRaw.map((r) => ({ riskLevel: r.riskLevel, count: r._count.riskLevel })),
    changes: changesRaw.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      riskLevel: c.riskLevel,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    slaCompliance,
  }
```

> Note: `changesRaw` items now have extra fields (`slaDeadline`, `opco`, `auditTrail`) but the `data.changes` map only reads the original six — no further change needed there.

- [ ] **Step 3: Render the table in the client**

In `src/app/(dashboard)/reports/reports-client.tsx`, import the cell type and extend `ReportsData`:

```ts
import type { SlaReportCell } from "@/lib/sla-report"
```

Add to `ReportsData` (after the `changes` array, line 21):

```ts
  slaCompliance: SlaReportCell[]
```

Then add a new card just before the closing `</div>` of the returned JSX (after the performance card, ~line 173):

```tsx
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.slaComplianceTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.slaComplianceDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.slaCompliance.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(language, "reports.slaCompliance.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t(language, "reports.slaCol.opco")}</th>
                  <th className="py-2 pr-4 font-medium">{t(language, "reports.slaCol.risk")}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t(language, "reports.slaCol.decided")}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t(language, "reports.slaCol.inSla")}</th>
                  <th className="py-2 font-medium text-right">{t(language, "reports.slaCol.adherence")}</th>
                </tr>
              </thead>
              <tbody>
                {data.slaCompliance.map((cell) => (
                  <tr key={`${cell.opcoSlug}-${cell.riskLevel}`} className="border-b border-border/40">
                    <td className="py-2 pr-4">{cell.opcoName}</td>
                    <td className="py-2 pr-4 capitalize">{cell.riskLevel}</td>
                    <td className="py-2 pr-4 text-right">{cell.decided}</td>
                    <td className="py-2 pr-4 text-right">{cell.inSla}</td>
                    <td className="py-2 text-right font-medium">
                      {cell.adherencePct == null ? "—" : `${cell.adherencePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/reports/page.tsx" "src/app/(dashboard)/reports/reports-client.tsx" src/lib/i18n.ts
git commit -m "feat(reports): add per-opco x risk SLA compliance table"
```

---

## Task 13: Full verification + Playwright smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full quality gate**

Run:
```bash
pnpm tsc --noEmit && pnpm lint && pnpm test
```
Expected: tsc clean, lint 0 errors, all Vitest suites pass (the existing ~250 tests plus the new `sla.test.ts`, `sla-report.test.ts`, `server/sla.test.ts`, `server/evidence-route.test.ts`). Fix any regressions before proceeding.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `prisma generate` + `next build` succeed. Confirms the new `.tsx` route, Node runtime export, and `@react-pdf/renderer` bundle for the server route.

- [ ] **Step 3: Restart the dev server (fresh Prisma client)**

Ensure `pnpm dev` is restarted after the Task 1 migration/generate (see the GOTCHA in Task 1) so detail pages and the PDF route see the new fields.

- [ ] **Step 4: Playwright smoke — evidence PDF**

Using the Playwright MCP against the running app (`devops@csquared.com` / `Admin2025$`), open a change detail page, confirm the "Export evidence (PDF)" link is present, click it, and confirm the `/api/changes/<id>/evidence.pdf` request returns `200` with `Content-Type: application/pdf` (check via `browser_network_requests`).

- [ ] **Step 5: Playwright smoke — SLA escalation**

Pick a `pending` change and force a breach by setting its `slaDeadline` to the past (DB script, e.g. `UPDATE "ChangeRequest" SET "slaDeadline" = now() - interval '10 hours', "escalationLevel" = 0 WHERE id = '<id>';`). Reload the dashboard (fires the lazy sweep). Then confirm via DB or the audit export that an `sla_escalated` audit entry was written and `escalationLevel` advanced. Optionally exercise the cron route:
```bash
curl -i -X POST http://localhost:3000/api/cron/sla -H "x-cron-secret: $CRON_SECRET"
```
Expected: `200 {"escalated":N}` with a valid secret; `401` without.

- [ ] **Step 6: Playwright smoke — SLA compliance report**

Open `/reports`, confirm the "SLA compliance" card renders with the per-OpCo × risk table (or the empty-state copy if no decisions exist yet).

- [ ] **Step 7: Final commit (if smoke required fixes)**

```bash
git add -A
git commit -m "fix(bundle1): smoke-test adjustments"
```

---

## Self-Review notes (spec coverage)

- **A. PDF evidence** → Tasks 9 (document), 10 (route + RBAC), 11 (button). All document sections from spec §A are in the component. ✅
- **B. SLA escalation** → Tasks 1 (schema), 2 (tier math), 4 (emails), 5 (orchestration + system-actor for the audit FK), 6 (cron), 7 (lazy triggers), 8 (emergency alert). Level-1 → OpCo admins, level-2 → group CAB (`opcoId = null`), idempotency, fire-and-forget. ✅
- **C. SLA compliance report** → Tasks 3 (calc), 12 (page + client + i18n). In-SLA = decision audit timestamp ≤ slaDeadline; pending-overdue counts as breach. ✅
- **Dependency** `@react-pdf/renderer` → Task 1. ✅
- **i18n (en + fr)** → Tasks 11, 12. ✅
- **Testing** (unit tier math, adherence, orchestration, route RBAC; Playwright smoke) → Tasks 2, 3, 5, 10, 13. ✅

**Decision recorded during planning:** escalation `AuditLog` entries are attributed to a lazily-upserted inactive `system` user (keycloakId `"system"`), because `AuditLog.actorId` is a required FK and escalation has no human actor. This keeps the immutable audit trail valid without a schema change.
