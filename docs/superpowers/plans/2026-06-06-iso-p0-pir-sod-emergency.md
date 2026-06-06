# ISO 27001 P0 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add implementer segregation-of-duties, a mandatory Post-Implementation Review (PIR) before `verified`, and a true expedited emergency path with 48h retrospective approval — closing the three P0 ISO 27001:2022 gaps.

**Architecture:** Additive schema (implementer + PIR + emergency-retrospective fields). Lifecycle gating lives in `updateChangeStatus` (`src/server/actions/changes.ts`); the PIR record+verify is a new transactional action (`src/server/actions/pir.ts`); retrospective approval extends `submitApproval` (`src/server/actions/approvals.ts`). A pure dashboard metric surfaces overdue emergency reviews. UI adds a PIR form + implementer/retro display on the change-detail page.

**Tech Stack:** Next.js App Router, Prisma v7 (`@prisma/adapter-pg`) + Postgres, Vitest, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-06-06-iso-p0-pir-sod-emergency-design.md`

**Branch:** `feat/iso-p0-pir-sod-emergency` (already checked out, off `dev`).

**Local DB note:** `migrate dev` needs a TTY; create the migration SQL by hand and apply with `migrate deploy`. Postgres + Keycloak are up via `docker/keycloak/docker-compose.yml`. Use the URL inline: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms"`.

---

## File Structure

**Create:**
- `prisma/migrations/20260606130000_iso_p0_pir_sod_emergency/migration.sql`
- `src/server/actions/pir.ts` — `submitPostImplementationReview` (record PIR + verify).
- `src/test/server/pir.test.ts` — unit tests (db mocked).
- `src/app/(dashboard)/changes/[id]/pir-form.tsx` — client PIR form component.

**Modify:**
- `prisma/schema.prisma` — implementer + emergency-retro fields on `ChangeRequest`; `PirOutcome` enum; `PostImplementationReview` model; `User` back-relations.
- `src/server/actions/changes.ts` — `updateChangeStatus`: SoD, expedited implement, verify-needs-PIR block.
- `src/server/actions/approvals.ts` — retrospective approval path.
- `src/lib/dashboard-metrics.ts` — `overdueRetro` count + new `DashboardChange` fields.
- `src/app/page.tsx` — map the new fields into `DashboardChange`.
- `src/components/dashboard/status-bar.tsx` — show overdue-retro segment.
- `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` — implementer line, PIR form, retro badge; replace the verify button.
- `src/lib/i18n.ts` — PIR/retro strings (en + fr).
- `src/test/actions/changes.test.ts`, `src/test/actions/approvals.test.ts`, `src/lib/dashboard-metrics.test.ts` — new coverage.

---

## Task 1: Schema + migration (additive)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260606130000_iso_p0_pir_sod_emergency/migration.sql`

- [ ] **Step 1: Add fields to `model ChangeRequest`**

After the `driveFolderId String?` line, add:
```prisma
  implementedById    String?
  implementedBy      User?     @relation("Implementer", fields: [implementedById], references: [id])
  implementedAt      DateTime?
  expedited          Boolean   @default(false)
  retroApprovalDueAt DateTime?
  retroApprovedAt    DateTime?
  pir                PostImplementationReview?
```

- [ ] **Step 2: Add the enum + model** (append near the other models)

```prisma
enum PirOutcome {
  success
  partial
  failed
}

model PostImplementationReview {
  id          String        @id @default(cuid())
  changeId    String        @unique
  change      ChangeRequest @relation(fields: [changeId], references: [id])
  outcome     PirOutcome
  summary     String
  backoutUsed Boolean       @default(false)
  authorId    String
  author      User          @relation("PirAuthor", fields: [authorId], references: [id])
  createdAt   DateTime      @default(now())

  @@index([changeId])
}
```

- [ ] **Step 3: Add `User` back-relations**

In `model User`, after `uploadedAttachments  Attachment[]  @relation("UploadedAttachments")`, add:
```prisma
  implementedChanges   ChangeRequest[]            @relation("Implementer")
  pirReviews           PostImplementationReview[] @relation("PirAuthor")
```

- [ ] **Step 4: Write the migration SQL**

Create `prisma/migrations/20260606130000_iso_p0_pir_sod_emergency/migration.sql`:
```sql
-- PIR outcome enum
CREATE TYPE "PirOutcome" AS ENUM ('success', 'partial', 'failed');

-- ChangeRequest: implementer + emergency-expedited + retrospective tracking
ALTER TABLE "ChangeRequest"
  ADD COLUMN "implementedById" TEXT,
  ADD COLUMN "implementedAt" TIMESTAMP(3),
  ADD COLUMN "expedited" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retroApprovalDueAt" TIMESTAMP(3),
  ADD COLUMN "retroApprovedAt" TIMESTAMP(3);

ALTER TABLE "ChangeRequest"
  ADD CONSTRAINT "ChangeRequest_implementedById_fkey"
  FOREIGN KEY ("implementedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Post-implementation review (1:1 with change)
CREATE TABLE "PostImplementationReview" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "outcome" "PirOutcome" NOT NULL,
  "summary" TEXT NOT NULL,
  "backoutUsed" BOOLEAN NOT NULL DEFAULT false,
  "authorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostImplementationReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostImplementationReview_changeId_key" ON "PostImplementationReview"("changeId");
CREATE INDEX "PostImplementationReview_changeId_idx" ON "PostImplementationReview"("changeId");
ALTER TABLE "PostImplementationReview"
  ADD CONSTRAINT "PostImplementationReview_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PostImplementationReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Apply + regenerate**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" pnpm prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" pnpm prisma generate
```
Expected: "All migrations have been successfully applied." and a regenerated client.

- [ ] **Step 6: Type-check (additive — expect clean)**

Run: `pnpm tsc --noEmit`
Expected: 0 errors (purely additive; no existing code references the new fields yet).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add implementer, PIR, and emergency-retrospective fields"
```

---

## Task 2: Lifecycle gating — SoD + expedited + verify-block (TDD)

**Files:**
- Modify: `src/server/actions/changes.ts` (`updateChangeStatus`, lines ~215-253)
- Test: `src/test/actions/changes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/test/actions/changes.test.ts`, inside `describe('updateChangeStatus — OpCo authorization', ...)` (after the existing "allows an approver to advance…" test at line ~177), add:
```typescript
  it('blocks the sole approver from implementing their own approval (SoD)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      ...approvedChange,
      approvals: [{ decision: 'approve', approverId: 'user-ap' }],
    })
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/sole approver/i)
  })

  it('allows implementing when another approver also approved', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      ...approvedChange,
      approvals: [
        { decision: 'approve', approverId: 'user-ap' },
        { decision: 'approve', approverId: 'user-other' },
      ],
    })
    await updateChangeStatus('cr-1', 'implemented')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'implemented', implementedById: 'user-ap' }) })
    )
  })

  it('lets an emergency change be implemented from pending (expedited) with a 48h retro deadline', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', isEmergency: true, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await updateChangeStatus('cr-1', 'implemented')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'implemented', expedited: true, retroApprovalDueAt: expect.any(Date) }) })
    )
  })

  it('forbids implementing a non-emergency change straight from pending', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', isEmergency: false, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/emergency/i)
  })

  it('blocks direct verify (must go through a PIR)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'implemented', isEmergency: false, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await expect(updateChangeStatus('cr-1', 'verified')).rejects.toThrow(/Post-Implementation Review/i)
  })
```

> `approverSession` and `approvedChange` already exist in this file. If `approverSession`'s user id is not `'user-ap'`, align the `mockDb.user.findUnique` id above with whatever `approverSession` maps to (grep `approverSession` in the file to confirm).

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/test/actions/changes.test.ts`
Expected: the 5 new tests fail (SoD/expedited/verify-block not implemented yet).

- [ ] **Step 3: Replace `updateChangeStatus`**

Replace the whole function body (lines ~215-253) with:
```typescript
export async function updateChangeStatus(changeId: string, toStatus: ChangeStatus, note?: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { opco: true, approvals: true },
  })
  if (!change) throw new Error("Change not found")

  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    throw new Error("Forbidden: change belongs to another OpCo")
  }

  // Verify is only reachable by recording a PIR (see submitPostImplementationReview).
  if (toStatus === "verified") {
    throw new Error("To verify a change, submit a Post-Implementation Review (PIR)")
  }

  // Emergency expedited: pending → implemented (skipping prior approval) is allowed
  // ONLY for emergency changes; everything else must follow VALID_TRANSITIONS.
  const isExpeditedImplement = toStatus === "implemented" && change.status === "pending"
  if (isExpeditedImplement) {
    if (!change.isEmergency) {
      throw new Error("Invalid transition: only emergency changes can be implemented without approval")
    }
  } else if (!VALID_TRANSITIONS[change.status]?.includes(toStatus)) {
    throw new Error(`Invalid transition: ${change.status} → ${toStatus}`)
  }

  const isAdmin =
    isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")

  if (toStatus === "draft") {
    // reopen: only the original requester or an admin
    if (change.requesterId !== user.id && !isAdmin) {
      throw new Error("Forbidden: only the requester or an admin can reopen this change")
    }
  } else {
    // implemented / closed: requires approver or admin rights
    if (!canApprove(session.organizations, change.opco.slug) && !isAdmin) {
      throw new Error("Forbidden: not authorized to advance this change")
    }
  }

  const data: {
    status: ChangeStatus
    implementedById?: string
    implementedAt?: Date
    expedited?: boolean
    retroApprovalDueAt?: Date
  } = { status: toStatus }

  if (toStatus === "implemented") {
    // Implementer Segregation of Duties (lenient): the *sole* approver cannot also implement.
    const approveVoters = [
      ...new Set(change.approvals.filter((a) => a.decision === "approve").map((a) => a.approverId)),
    ]
    if (approveVoters.length === 1 && approveVoters[0] === user.id) {
      throw new Error("Forbidden: the sole approver cannot also implement this change (SoD — ISO 27001 A.5.3)")
    }
    data.implementedById = user.id
    data.implementedAt = new Date()
    if (isExpeditedImplement) {
      data.expedited = true
      data.retroApprovalDueAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    }
  }

  const updated = await db.changeRequest.update({ where: { id: changeId }, data })
  await db.auditLog.create({
    data: { changeId, actorId: user.id, action: "status_changed", fromStatus: change.status, toStatus, note },
  })
  return updated
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/test/actions/changes.test.ts`
Expected: all tests pass (existing + 5 new). The pre-existing "allows an approver to advance an approved change to implemented" test still passes (its `approvedChange` mock has no `approvals`, so `change.approvals` is `[]` → not a sole approver).

- [ ] **Step 5: Type-check + commit**

```bash
pnpm tsc --noEmit
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(changes): implementer SoD, emergency expedited implement, verify-needs-PIR gate"
```

---

## Task 3: PIR action — record + verify (TDD)

**Files:**
- Create: `src/server/actions/pir.ts`
- Test: `src/test/server/pir.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/pir.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-impl", email: "impl@c.com", name: "Impl",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["approver"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: "user-impl", keycloakId: "kc-impl" }) },
  changeRequest: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  postImplementationReview: { create: vi.fn().mockResolvedValue({ id: "pir-1" }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { submitPostImplementationReview } from "@/server/actions/pir"

const implemented = {
  id: "cr-1", status: "implemented", opco: { slug: "ghana" },
  implementedById: "user-impl", expedited: false, retroApprovedAt: null, pir: null, approvals: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: "user-impl", keycloakId: "kc-impl" })
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb))
})

it("records a PIR and advances implemented → verified", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
  await submitPostImplementationReview("cr-1", { outcome: "success", summary: "All good", backoutUsed: false })
  expect(mockDb.postImplementationReview.create).toHaveBeenCalledTimes(1)
  expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: "verified" } })
  )
})

it("rejects a PIR when the change is not implemented", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, status: "approved" })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/implemented/i)
})

it("rejects a duplicate PIR", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, pir: { id: "pir-old" } })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/already has/i)
})

it("requires a non-empty summary", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "   ", backoutUsed: false })
  ).rejects.toThrow(/summary is required/i)
})

it("blocks an expedited emergency PIR until retrospectively approved", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, expedited: true, retroApprovedAt: null })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/retrospective approval/i)
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `pnpm test src/test/server/pir.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/server/actions/pir.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo, canApprove } from "@/lib/permissions"
import type { PirOutcome } from "@prisma/client"

export async function submitPostImplementationReview(
  changeId: string,
  input: { outcome: PirOutcome; summary: string; backoutUsed: boolean },
) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  if (!input.summary?.trim()) {
    throw new Error("A summary is required for the Post-Implementation Review")
  }

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { opco: true, pir: true },
  })
  if (!change) throw new Error("Change not found")
  if (change.status !== "implemented") {
    throw new Error("A PIR can only be recorded for an implemented change")
  }
  if (change.pir) throw new Error("This change already has a Post-Implementation Review")

  const authorized =
    isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin") ||
    canApprove(session.organizations, change.opco.slug) ||
    change.implementedById === user.id
  if (!authorized) throw new Error("Forbidden: not authorized to record a PIR for this change")

  // Expedited emergencies must be sanctioned (retrospective approval) before verification.
  if (change.expedited && !change.retroApprovedAt) {
    throw new Error("This emergency change needs a retrospective approval before it can be verified")
  }

  return db.$transaction(async (tx) => {
    const pir = await tx.postImplementationReview.create({
      data: {
        changeId,
        authorId: user.id,
        outcome: input.outcome,
        summary: input.summary.trim(),
        backoutUsed: input.backoutUsed,
      },
    })
    await tx.changeRequest.update({ where: { id: changeId }, data: { status: "verified" } })
    await tx.auditLog.create({
      data: {
        changeId, actorId: user.id, action: "pir_recorded",
        fromStatus: "implemented", toStatus: "verified",
        note: `PIR: ${input.outcome}${input.backoutUsed ? " (backout used)" : ""}`,
      },
    })
    return pir
  })
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/test/server/pir.test.ts`

- [ ] **Step 5: Type-check + commit**

```bash
pnpm tsc --noEmit
git add src/server/actions/pir.ts src/test/server/pir.test.ts
git commit -m "feat(pir): record Post-Implementation Review + transactional verify"
```

---

## Task 4: Retrospective approval (TDD)

**Files:**
- Modify: `src/server/actions/approvals.ts`
- Test: `src/test/actions/approvals.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/test/actions/approvals.test.ts`, add inside `describe('submitApproval — CAB authority + quorum', ...)`:
```typescript
  it('records a retrospective approval on an expedited emergency without changing status', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'implemented', opcoId: 'opco-1', requesterId: 'req',
      opco: { slug: 'ghana' }, infrastructureType: 'Wifi', riskLevel: 'emergency',
      isEmergency: true, expedited: true, title: 'x', approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retroApprovedAt: expect.any(Date) }) })
    )
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/test/actions/approvals.test.ts`
Expected: the new test fails (a non-pending change currently throws "Change is not pending").

- [ ] **Step 3: Implement the retrospective branch**

In `src/server/actions/approvals.ts`, replace:
```typescript
  if (!change) throw new Error("Change not found")
  if (change.status !== "pending") throw new Error("Change is not pending")
```
with:
```typescript
  if (!change) throw new Error("Change not found")
  const isRetrospective = change.status === "implemented" && change.isEmergency && change.expedited === true
  if (change.status !== "pending" && !isRetrospective) throw new Error("Change is not pending")
```

Then, immediately after the `const approval = await db.approval.create({ ... })` line, insert the retrospective short-circuit (before the `allApprovals`/quorum block):
```typescript
  if (isRetrospective) {
    if (decision === "approve") {
      await db.changeRequest.update({ where: { id: changeId }, data: { retroApprovedAt: new Date() } })
    }
    await db.auditLog.create({
      data: {
        changeId, actorId: user.id,
        action: decision === "approve" ? "retro_approved" : "retro_rejected",
        note: comment,
      },
    })
    return approval
  }
```

(The existing SoD check `change.requesterId === user.id` and `canUserApproveChange` authority check run *before* this and still apply. A single retrospective approval suffices — no quorum.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/test/actions/approvals.test.ts`
Expected: all pass (existing + new).

- [ ] **Step 5: Type-check + commit**

```bash
pnpm tsc --noEmit
git add src/server/actions/approvals.ts src/test/actions/approvals.test.ts
git commit -m "feat(approvals): retrospective approval for expedited emergency changes"
```

---

## Task 5: Dashboard overdue-retro metric (TDD)

**Files:**
- Modify: `src/lib/dashboard-metrics.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/status-bar.tsx`
- Modify: `src/lib/i18n.ts`
- Test: `src/lib/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/dashboard-metrics.test.ts`, add:
```typescript
import { buildDashboardData, type DashboardChange } from "@/lib/dashboard-metrics"

it("counts overdue emergency retrospective reviews", () => {
  const now = Date.parse("2026-06-06T12:00:00Z")
  const mk = (over: { id: string; due: string | null; approved: string | null }): DashboardChange => ({
    id: over.id, title: "e", status: "implemented", riskLevel: "emergency", isEmergency: true,
    slaDeadline: null, plannedStart: null, opcoName: "Ghana", opcoSlug: "ghana", ownerInitials: "X",
    expedited: true, retroApprovalDueAt: over.due, retroApprovedAt: over.approved,
  })
  const changes = [
    mk({ id: "overdue", due: "2026-06-06T10:00:00Z", approved: null }), // past due, not approved → counts
    mk({ id: "approved", due: "2026-06-06T10:00:00Z", approved: "2026-06-06T11:00:00Z" }), // approved → no
    mk({ id: "future", due: "2026-06-07T10:00:00Z", approved: null }), // not yet due → no
  ]
  const data = buildDashboardData(changes, now)
  expect(data.counts.overdueRetro).toBe(1)
})
```

- [ ] **Step 2: Run — expect FAIL** (`overdueRetro` undefined / type errors on new fields)

Run: `pnpm test src/lib/dashboard-metrics.test.ts`

- [ ] **Step 3: Extend `DashboardChange`, `counts`, and the builder**

In `src/lib/dashboard-metrics.ts`:

Add three fields to the `DashboardChange` interface (after `ownerInitials: string`):
```typescript
  expedited: boolean
  retroApprovalDueAt: string | null
  retroApprovedAt: string | null
```

Add `overdueRetro: number` to the `counts` type in `DashboardData`:
```typescript
    emergency: number; scheduledToday: number; readyToAdvance: number; overdueRetro: number
```

In `buildDashboardData`, before the `return {`, add:
```typescript
  const overdueRetro = changes.filter(
    (c) => c.expedited && c.status === "implemented" && c.retroApprovedAt == null &&
      c.retroApprovalDueAt != null && Date.parse(c.retroApprovalDueAt) < nowMs,
  ).length
```
and add `overdueRetro,` to the returned `counts` object.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/lib/dashboard-metrics.test.ts`

- [ ] **Step 5: Map the new fields in `src/app/page.tsx`**

In the `db.changeRequest.findMany` `select` (lines ~35-40), add to the field list:
```typescript
        expedited: true, retroApprovalDueAt: true, retroApprovedAt: true,
```
In the `changes: DashboardChange[] = rows.map(...)` object (lines ~54-60), add:
```typescript
    expedited: r.expedited,
    retroApprovalDueAt: r.retroApprovalDueAt?.toISOString() ?? null,
    retroApprovedAt: r.retroApprovedAt?.toISOString() ?? null,
```

- [ ] **Step 6: Surface it in the status bar**

In `src/lib/i18n.ts`, add a key to BOTH the `en` and `fr` maps (next to `"dashboard.status.emergency"`):
```typescript
  "dashboard.status.overdueRetro": "overdue emergency review",   // en
```
```typescript
  "dashboard.status.overdueRetro": "revue d'urgence en retard",  // fr
```

In `src/components/dashboard/status-bar.tsx`, after the `counts.emergency > 0` segment block, add:
```tsx
      {counts.overdueRetro > 0 && (
        <Seg><b className="text-rose-600 dark:text-rose-400">{counts.overdueRetro}</b> {t(language, "dashboard.status.overdueRetro")}</Seg>
      )}
```

- [ ] **Step 7: Type-check + commit**

```bash
pnpm tsc --noEmit && pnpm test src/lib/dashboard-metrics.test.ts
git add src/lib/dashboard-metrics.ts src/lib/dashboard-metrics.test.ts src/app/page.tsx src/components/dashboard/status-bar.tsx src/lib/i18n.ts
git commit -m "feat(dashboard): surface overdue emergency retrospective reviews"
```

---

## Task 6: Change-detail UI — PIR form, implementer line, retro state

**Files:**
- Create: `src/app/(dashboard)/changes/[id]/pir-form.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx` (serialize new fields)
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Serialize the new fields into the detail page**

In `src/app/(dashboard)/changes/[id]/page.tsx`, the `serialize(change)` function (and the `getChange` include already returns the full change) — add to the returned `SerializedChange` object:
```typescript
    implementedAt: change.implementedAt?.toISOString() ?? null,
    implementer: change.implementedBy ? { name: change.implementedBy.name ?? null, email: change.implementedBy.email } : null,
    expedited: change.expedited,
    retroApprovalDueAt: change.retroApprovalDueAt?.toISOString() ?? null,
    retroApprovedAt: change.retroApprovedAt?.toISOString() ?? null,
    hasPir: change.pir != null,
```
Ensure `getChange` includes the relations: in `src/server/actions/changes.ts` `getChange`, extend its `include` with `implementedBy: true, pir: true` (the function already includes `opco`, `requester`, `approvals`, `auditTrail`, `attachments`).

- [ ] **Step 2: Extend the `SerializedChange` type**

In `change-detail-client.tsx`, add to the `SerializedChange` type:
```typescript
  implementedAt: string | null
  implementer: { name: string | null; email: string } | null
  expedited: boolean
  retroApprovalDueAt: string | null
  retroApprovedAt: string | null
  hasPir: boolean
```

- [ ] **Step 3: Create the PIR form component**

```tsx
// src/app/(dashboard)/changes/[id]/pir-form.tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { submitPostImplementationReview } from "@/server/actions/pir"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

type Outcome = "success" | "partial" | "failed"

export default function PirForm({ changeId }: { changeId: string }) {
  const language = useStore((s) => s.language)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>("success")
  const [summary, setSummary] = useState("")
  const [backoutUsed, setBackoutUsed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        await submitPostImplementationReview(changeId, { outcome, summary, backoutUsed })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to submit PIR")
      }
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">{t(language, "pir.title")}</h4>
      <label className="block text-xs font-medium text-muted-foreground">
        {t(language, "pir.outcome")}
        <select
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
        >
          <option value="success">{t(language, "pir.outcome.success")}</option>
          <option value="partial">{t(language, "pir.outcome.partial")}</option>
          <option value="failed">{t(language, "pir.outcome.failed")}</option>
        </select>
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        {t(language, "pir.summary")}
        <textarea
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={backoutUsed} onChange={(e) => setBackoutUsed(e.target.checked)} />
        {t(language, "pir.backoutUsed")}
      </label>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Button className="w-full" disabled={isPending || !summary.trim()} onClick={submit}>
        {t(language, "pir.submit")}
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Add i18n keys** (en + fr) in `src/lib/i18n.ts`:
```typescript
  "pir.title": "Post-Implementation Review",
  "pir.outcome": "Outcome",
  "pir.outcome.success": "Success",
  "pir.outcome.partial": "Partial",
  "pir.outcome.failed": "Failed",
  "pir.summary": "Summary",
  "pir.backoutUsed": "Backout/rollback was used",
  "pir.submit": "Record PIR & verify",
  "detail.implementedBy": "Implemented by",
  "detail.retroDue": "Retrospective approval due",
  "detail.retroApproved": "Retrospectively approved",
```
(French: translate the values; keep keys identical.)

- [ ] **Step 5: Wire into `change-detail-client.tsx`**

a) Import the form near the other imports:
```tsx
import PirForm from "./pir-form"
```

b) Replace the verify button block (the `{a.verify && ( … )}` block, lines ~440-449) with the PIR form, shown when the change is implemented and the user can act:
```tsx
            {change.status === "implemented" && (caps.canApprove || caps.isAdmin) && !change.hasPir && (
              <PirForm changeId={change.id} />
            )}
```

c) In the `a` capability object (lines ~110-114), remove the now-unused `verify` entry (and remove `"verified"` from the `handleStatusChange` union type at line ~174 → `"implemented" | "closed" | "draft"`).

d) Add an implementer line in the overview/detail section (near where requester is shown):
```tsx
            {change.implementer && (
              <div><dt className="text-muted-foreground">{t(language, "detail.implementedBy")}</dt>
                <dd>{change.implementer.name ?? change.implementer.email}</dd></div>
            )}
```

e) Add a retrospective badge for expedited emergencies (near the status header):
```tsx
            {change.expedited && !change.retroApprovedAt && change.retroApprovalDueAt && (
              <span className="rounded-md bg-rose-100 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {t(language, "detail.retroDue")}: {new Date(change.retroApprovalDueAt).toLocaleString()}
              </span>
            )}
```

> Match the surrounding markup style for the overview `<dl>`/grid and the header area — adapt the wrappers above to the existing structure rather than copying verbatim if the classNames differ.

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/changes/[id]" src/lib/i18n.ts src/server/actions/changes.ts
git commit -m "feat(detail): PIR form, implementer line, and emergency retrospective badge"
```

---

## Task 7: Final verification + branch consolidation

> Per `memory/feedback_phase_gates.md`: run deslop and ensure all tests pass before done.

- [ ] **Step 1: deslop the new/changed server logic**

Invoke the `deslop` skill on `src/server/actions/pir.ts`, `src/server/actions/changes.ts`, `src/server/actions/approvals.ts`. Apply findings.

- [ ] **Step 2: Lint + type-check**

Run: `pnpm lint && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: all suites pass (Docker up for the Testcontainers isolation test).

- [ ] **Step 4: Re-seed (schema changed) + manual/Playwright smoke**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" pnpm exec tsx prisma/seed.ts
```
Then with `pnpm dev` running, drive via the Playwright MCP (per `memory/feedback_playwright_smoke_tests.md`), logged in as devops:
1. Take an `approved` change → **implement** it (records implementer) → the change-detail shows the PIR form → submit a PIR → status becomes **verified**.
2. Confirm direct verify is impossible (no verify button; only the PIR form path).
3. Create + submit an **emergency** change → **implement from pending** (expedited) → confirm the "retrospective approval due" badge + that PIR is blocked until a retrospective approval is recorded → record retrospective approval → submit PIR → verified.
4. Confirm the dashboard status bar shows "overdue emergency review" when an expedited change passes its 48h deadline unapproved (temporarily seed/adjust `retroApprovalDueAt` to the past to observe).

- [ ] **Step 5: Commit any deslop/smoke fixes**

```bash
git add -A && git commit -m "chore: deslop + smoke fixes for ISO P0 hardening"
```

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch to verify tests and merge `feat/iso-p0-pir-sod-emergency` → `dev` (per `memory/project_branch_topology`).

---

## Self-Review Notes (for the implementer)

- **`verified` is reachable only via `submitPostImplementationReview`.** `updateChangeStatus` throws on `toStatus === "verified"`. The UI verify button is replaced by the PIR form.
- **SoD is lenient by design** (blocks only the *sole* approver). Multi-approver changes and non-approver admins can implement; emergencies (0 approvers) are never blocked.
- **Retrospective reject** records `retro_rejected` in the audit log and does **not** roll back — out-of-band governance handling, by design.
- **`expedited` stays true after retro approval**; "overdue" is gated on `retroApprovedAt == null`, so approved emergencies drop off the dashboard metric.
- **Seed** has no PIRs; existing seeded changes are unaffected (all new fields are nullable / default false).
