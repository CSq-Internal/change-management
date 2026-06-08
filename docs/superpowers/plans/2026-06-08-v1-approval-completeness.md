# v1.0 Bundle 4 — Approval Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable per-(infra×opco) approver overrides, requester-named assignees (`ChangeAssignee` + role) who may approve or implement, and deactivation handling that ends a user's approver roles, notifies remaining approvers, and warns about orphaned pending changes.

**Architecture:** All additive and opt-in — CAB routing stays the fallback, nothing is seeded, the existing approval tests stay green. `getRoutedApprovers` consults `ApproverAssignment` overrides before CAB; `canUserApproveChange` gains a `changeId` to also honour approver-role `ChangeAssignee`s; `deactivateUser` captures the user's pending-approval footprint, ends their CAB/overrides, then notifies the remainder and returns orphans. Quorum is untouched (`submitApproval` already records `isCab: true` for every authorized approval).

**Tech Stack:** Next.js 16 App Router, Prisma v7, Vitest (db-mocked), `notifyEvent` (Bundle 3), Playwright MCP.

---

## File Structure

**Create:** `src/server/actions/approval-matrix.ts` (+test), `src/server/actions/assignees.ts` (+test), `src/server/approver-reassign.ts` (+test), `src/app/(dashboard)/approval-matrix/approval-matrix-client.tsx`, `src/app/(dashboard)/changes/[id]/assignees-dialog.tsx`, `prisma/migrations/20260608140000_approval_completeness/migration.sql`.

**Modify:** `prisma/schema.prisma`, `src/server/approval-authority.ts` (+test), `src/server/actions/changes.ts`, `src/server/actions/approvals.ts`, `src/server/actions/users.ts`, `src/app/(dashboard)/approval-matrix/page.tsx`, `src/app/(dashboard)/changes/[id]/page.tsx`, `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`, `src/app/(dashboard)/users/users-client.tsx`, `src/lib/i18n.ts`.

---

## Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/20260608140000_approval_completeness/migration.sql`

- [ ] **Step 1: Add the model, enum, and role field**

In `prisma/schema.prisma`:

```prisma
model ApproverAssignment {
  id                 String   @id @default(cuid())
  infrastructureType String
  opcoId             String?
  opco               OpCo?    @relation(fields: [opcoId], references: [id])
  userId             String
  user               User     @relation("ApproverAssignments", fields: [userId], references: [id])
  isActive           Boolean  @default(true)
  createdById        String
  createdAt          DateTime @default(now())

  @@unique([infrastructureType, opcoId, userId])
  @@index([infrastructureType, opcoId])
  @@index([userId])
}

enum AssigneeRole {
  approver
  implementer
}
```

Modify `model ChangeAssignee` to add the role + user relation:

```prisma
model ChangeAssignee {
  id       String        @id @default(cuid())
  changeId String
  change   ChangeRequest @relation(fields: [changeId], references: [id])
  userId   String
  user     User          @relation("ChangeAssignments", fields: [userId], references: [id])
  role     AssigneeRole  @default(implementer)

  @@unique([changeId, userId])
}
```

Back-relations: in `model User` add `approverAssignments ApproverAssignment[] @relation("ApproverAssignments")` and `changeAssignments ChangeAssignee[] @relation("ChangeAssignments")`; in `model OpCo` add `approverAssignments ApproverAssignment[]`.

- [ ] **Step 2: Migration SQL**

Create `prisma/migrations/20260608140000_approval_completeness/migration.sql`:

```sql
CREATE TYPE "AssigneeRole" AS ENUM ('approver', 'implementer');

ALTER TABLE "ChangeAssignee" ADD COLUMN "role" "AssigneeRole" NOT NULL DEFAULT 'implementer';

CREATE TABLE "ApproverAssignment" (
    "id" TEXT NOT NULL,
    "infrastructureType" TEXT NOT NULL,
    "opcoId" TEXT,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApproverAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApproverAssignment_infrastructureType_opcoId_userId_key" ON "ApproverAssignment"("infrastructureType", "opcoId", "userId");
CREATE INDEX "ApproverAssignment_infrastructureType_opcoId_idx" ON "ApproverAssignment"("infrastructureType", "opcoId");
CREATE INDEX "ApproverAssignment_userId_idx" ON "ApproverAssignment"("userId");

ALTER TABLE "ApproverAssignment" ADD CONSTRAINT "ApproverAssignment_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApproverAssignment" ADD CONSTRAINT "ApproverAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

(`ChangeAssignee.user` FK already exists at the column level via `userId`; only the Prisma relation is new — no SQL FK needed if `userId` had no constraint before. If `pnpm prisma migrate diff` later complains, add `ALTER TABLE "ChangeAssignee" ADD CONSTRAINT "ChangeAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` — but only if it doesn't already exist.)

- [ ] **Step 3: Generate + type-check**

Run: `pnpm prisma generate && pnpm tsc --noEmit`
Expected: PASS. (Do NOT `migrate deploy` — applied live at smoke.)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260608140000_approval_completeness/migration.sql
git commit -m "feat(approval): add ApproverAssignment + ChangeAssignee.role schema"
```

---

## Task 2: Override-aware routing + named approvers (TDD)

**Files:** `src/server/approval-authority.ts`, `src/test/server/approval-authority.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/approval-authority.test.ts`:

```ts
// src/test/server/approval-authority.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  approverAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  approverDelegation: { findMany: vi.fn().mockResolvedValue([]) },
  changeAssignee: { findMany: vi.fn().mockResolvedValue([]) },
  changeRequest: { findMany: vi.fn().mockResolvedValue([]) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { getRoutedApprovers, getNamedApprovers, canUserApproveChange } from '@/server/approval-authority'

const change = { infrastructureType: 'Wifi', opcoId: 'opco-1' }
const u = (id: string) => ({ id, name: id, email: `${id}@x.com`, isActive: true })

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.approverAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
  mockDb.approverDelegation.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockResolvedValue([])
})

describe('getRoutedApprovers', () => {
  it('falls back to CAB membership when no override exists', async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: 'cab1', user: u('cab1') }])
    const out = await getRoutedApprovers(change)
    expect(out.map((x) => x.id)).toEqual(['cab1'])
    expect(mockDb.approverAssignment.findMany).toHaveBeenCalled()
  })

  it('uses the override and ignores CAB when an override exists', async () => {
    mockDb.approverAssignment.findMany.mockResolvedValue([{ user: u('ovr1') }, { user: u('ovr2') }])
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: 'cab1', user: u('cab1') }])
    const out = await getRoutedApprovers(change)
    expect(out.map((x) => x.id).sort()).toEqual(['ovr1', 'ovr2'])
    expect(mockDb.cABMembership.findMany).not.toHaveBeenCalled()
  })

  it('excludes inactive override users', async () => {
    mockDb.approverAssignment.findMany.mockResolvedValue([{ user: { ...u('ovr1'), isActive: false } }, { user: u('ovr2') }])
    const out = await getRoutedApprovers(change)
    expect(out.map((x) => x.id)).toEqual(['ovr2'])
  })
})

describe('getNamedApprovers', () => {
  it('returns active approver-role assignees', async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u('named1') }])
    const out = await getNamedApprovers('c1')
    expect(out.map((x) => x.id)).toEqual(['named1'])
    expect(mockDb.changeAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ changeId: 'c1', role: 'approver' }) })
    )
  })
})

describe('canUserApproveChange', () => {
  it('is true for a group admin', async () => {
    expect(await canUserApproveChange({ userId: 'x', realmRoles: ['group_admin'], change })).toBe(true)
  })
  it('is true for a named approver-role assignee', async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u('named1') }])
    expect(await canUserApproveChange({ userId: 'named1', realmRoles: [], change, changeId: 'c1' })).toBe(true)
  })
  it('is false for an unrelated user', async () => {
    expect(await canUserApproveChange({ userId: 'nope', realmRoles: [], change, changeId: 'c1' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run → FAIL** (`getNamedApprovers` not exported / override branch missing).

- [ ] **Step 3: Edit `src/server/approval-authority.ts`**

Replace `getRoutedApprovers` with the override-aware version and add `getNamedApprovers`; extend `canUserApproveChange`; pass `changeId` in `listApprovableChanges`:

```ts
export async function getRoutedApprovers(change: ChangeForAuth): Promise<ApproverUser[]> {
  const db = getPrisma()
  const cabOpcoId = routedCabOpcoId(change.infrastructureType, change.opcoId)

  // Per-(infra, level) explicit overrides replace CAB routing when present.
  const overrides = await db.approverAssignment.findMany({
    where: { infrastructureType: change.infrastructureType, opcoId: cabOpcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })

  let routedUsers: ApproverUser[]
  if (overrides.length > 0) {
    routedUsers = overrides
      .filter((o) => o.user.isActive)
      .map((o) => ({ id: o.user.id, name: o.user.name, email: o.user.email }))
  } else {
    const members = await db.cABMembership.findMany({
      where: { opcoId: cabOpcoId, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    routedUsers = members.map((m) => m.user)
  }

  const routedIds = routedUsers.map((u) => u.id)
  const now = new Date()
  const delegations = routedIds.length === 0 ? [] : await db.approverDelegation.findMany({
    where: {
      opcoId: cabOpcoId, isActive: true,
      fromUserId: { in: routedIds },
      validFrom: { lte: now }, validUntil: { gte: now },
    },
    include: { toUser: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of [...routedUsers, ...delegations.map((d) => d.toUser)]) {
    if (!seen.has(u.id)) { seen.add(u.id); out.push(u) }
  }
  return out
}

export async function getNamedApprovers(changeId: string): Promise<ApproverUser[]> {
  const db = getPrisma()
  const rows = await db.changeAssignee.findMany({
    where: { changeId, role: "approver" },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => ({ id: r.user.id, name: r.user.name, email: r.user.email }))
}
```

Extend `canUserApproveChange`:

```ts
export async function canUserApproveChange(args: {
  userId: string
  realmRoles: string[]
  change: ChangeForAuth
  changeId?: string
}): Promise<boolean> {
  if (isGroupAdmin(args.realmRoles)) return true
  const approvers = await getRoutedApprovers(args.change)
  if (approvers.some((u) => u.id === args.userId)) return true
  if (args.changeId) {
    const named = await getNamedApprovers(args.changeId)
    if (named.some((u) => u.id === args.userId)) return true
  }
  return false
}
```

In `listApprovableChanges`, pass the change id:

```ts
    if (await canUserApproveChange({ userId: args.userId, realmRoles: args.realmRoles, change: c, changeId: c.id })) {
      visible.push(c)
    }
```

- [ ] **Step 4: Run → PASS** (`pnpm test src/test/server/approval-authority.test.ts`).

- [ ] **Step 5: Type-check + commit**

Run: `pnpm tsc --noEmit`

```bash
git add src/server/approval-authority.ts src/test/server/approval-authority.test.ts
git commit -m "feat(approval): override-aware routing + named approvers"
```

---

## Task 3: Wire changeId into approvals + submit notifications

**Files:** `src/server/actions/approvals.ts`, `src/server/actions/changes.ts`

- [ ] **Step 1: Pass changeId in submitApproval**

In `src/server/actions/approvals.ts`, the `canUserApproveChange({ ... })` call near the top of `submitApproval` — add `changeId`:

```ts
  const allowed = await canUserApproveChange({
    userId: user.id, realmRoles: session.realmRoles,
    change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
    changeId,
  })
```

- [ ] **Step 2: Submit notifies routed ∪ named approvers**

In `src/server/actions/changes.ts` `submitChange`, add `getNamedApprovers` to the existing `getRoutedApprovers` import. Replace the `approvers` recipients computation in the `approval_requested` `notifyEvent` (from Bundle 3) with the union:

```ts
  const routed = await getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId })
  const named = await getNamedApprovers(change.id)
  const seenA = new Set<string>()
  const recipients = [...routed, ...named]
    .filter((u) => { if (seenA.has(u.id)) return false; seenA.add(u.id); return true })
    .map((u) => ({ userId: u.id, email: u.email, name: u.name }))
  await notifyEvent({
    type: "approval_requested",
    recipients,
    change: { id: change.id, title: change.title, opcoId: change.opcoId },
    context: { requesterName: user.name ?? user.email, riskLevel: change.riskLevel },
  }).catch(() => {})
```

- [ ] **Step 3: Run the existing approval/change tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/actions/approvals.test.ts src/test/actions/changes.test.ts`
Expected: PASS. The `changes.test.ts` notify mock is unchanged; if it asserts on the recipients of `approval_requested`, ensure the mock db `changeAssignee.findMany` (now called by `getNamedApprovers`) returns `[]` — add it to that test's db mock if missing so the union is just the routed set.

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/approvals.ts src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(approval): honour named approvers in approve + submit-notify"
```

---

## Task 4: Approver-override actions (TDD)

**Files:** `src/server/actions/approval-matrix.ts`, `src/test/actions/approval-matrix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/approval-matrix.test.ts`:

```ts
// src/test/actions/approval-matrix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  approverAssignment: { upsert: vi.fn(async () => ({ id: 'a1' })) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  user: { findUnique: vi.fn(async () => ({ id: 'target', isActive: true })) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { addApproverAssignment } from '@/server/actions/approval-matrix'

beforeEach(() => { vi.clearAllMocks(); mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }); mockDb.user.findUnique.mockResolvedValue({ id: 'target', isActive: true }) })

describe('addApproverAssignment', () => {
  it('adds an OpCo override for an OpCo admin + audits it', async () => {
    await addApproverAssignment({ infrastructureType: 'Wifi', opcoSlug: 'ghana', userId: 'target' })
    expect(tx.approverAssignment.upsert).toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'approver_assignment_added' }) })
    )
  })

  it('forbids an OpCo admin adding a group-level override', async () => {
    await expect(addApproverAssignment({ infrastructureType: 'Equiano Optics', opcoSlug: null, userId: 'target' }))
      .rejects.toThrow(/Forbidden/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/actions/approval-matrix.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const ok = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!ok) throw new Error("Forbidden: not authorized to manage approvers for this scope")
  return session
}

export async function listApproverAssignments() {
  const session = await getAppSession()
  const db = getPrisma()
  const slugs = session.organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
  const where = isGroupAdmin(session.realmRoles)
    ? { isActive: true }
    : { isActive: true, OR: [{ opcoId: null }, { opco: { slug: { in: slugs } } }] }
  return db.approverAssignment.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } }, opco: { select: { name: true, slug: true } } },
    orderBy: [{ infrastructureType: "asc" }],
  })
}

export async function addApproverAssignment(input: { infrastructureType: string; opcoSlug: string | null; userId: string }) {
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")
  const target = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true } })
  if (!target || !target.isActive) throw new Error("Approver must be an active user")
  const opcoId = opco?.id ?? null

  return db.$transaction(async (tx) => {
    const assignment = await tx.approverAssignment.upsert({
      where: { infrastructureType_opcoId_userId: { infrastructureType: input.infrastructureType, opcoId, userId: input.userId } },
      create: { infrastructureType: input.infrastructureType, opcoId, userId: input.userId, createdById: (await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } }))!.id },
      update: { isActive: true },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "approver_assignment_added",
      opcoId, summary: `Added approver override (${input.infrastructureType} / ${input.opcoSlug ?? "group"})`,
    })
    return assignment
  })
}

export async function removeApproverAssignment(id: string) {
  const db = getPrisma()
  const existing = await db.approverAssignment.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Assignment not found")
  const session = await assertCanManage(existing.opco?.slug ?? null)
  await db.$transaction(async (tx) => {
    await tx.approverAssignment.update({ where: { id }, data: { isActive: false } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "approver_assignment_removed",
      opcoId: existing.opcoId, summary: `Removed approver override (${existing.infrastructureType} / ${existing.opco?.slug ?? "group"})`,
    })
  })
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/actions/approval-matrix.ts src/test/actions/approval-matrix.test.ts
git commit -m "feat(approval): approver-override CRUD actions"
```

---

## Task 5: Editable approval-matrix page

**Files:** `src/app/(dashboard)/approval-matrix/page.tsx`, `src/app/(dashboard)/approval-matrix/approval-matrix-client.tsx`, `src/lib/i18n.ts`

- [ ] **Step 1: i18n** — in `src/lib/i18n.ts` add to EN:

```ts
    "matrix.overrides.title": "Approver overrides",
    "matrix.overrides.desc": "Assign explicit approvers per infrastructure type and scope. Overrides replace the CAB default for that slot.",
    "matrix.infra": "Infrastructure",
    "matrix.scope": "Scope",
    "matrix.approver": "Approver",
    "matrix.add": "Add override",
    "matrix.remove": "Remove",
    "matrix.group": "Group",
    "matrix.none": "No overrides — CAB defaults apply.",
    "matrix.added": "Override added",
    "matrix.removed": "Override removed",
    "matrix.failed": "Could not update override",
```

and FR:

```ts
    "matrix.overrides.title": "Approbateurs personnalisés",
    "matrix.overrides.desc": "Affecter des approbateurs explicites par type d'infrastructure et périmètre. Remplace le CAB par défaut.",
    "matrix.infra": "Infrastructure",
    "matrix.scope": "Périmètre",
    "matrix.approver": "Approbateur",
    "matrix.add": "Ajouter",
    "matrix.remove": "Supprimer",
    "matrix.group": "Groupe",
    "matrix.none": "Aucun — les valeurs CAB par défaut s'appliquent.",
    "matrix.added": "Ajouté",
    "matrix.removed": "Supprimé",
    "matrix.failed": "Échec de la mise à jour",
```

- [ ] **Step 2: Page** — modify `src/app/(dashboard)/approval-matrix/page.tsx`: keep the existing read-only cards. After computing them, also load the overrides + a candidate-user list and the admin's manageable scopes, then render the new client below. Add near the end (before the final `</div>`):

Add imports at top:
```tsx
import { listApproverAssignments } from "@/server/actions/approval-matrix"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import ApprovalMatrixClient from "./approval-matrix-client"
```

Before the `return`, add:
```tsx
  const canManage = canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
  const assignments = canManage ? await listApproverAssignments() : []
  const overrideRows = assignments.map((a) => ({
    id: a.id, infrastructureType: a.infrastructureType,
    opcoSlug: a.opco?.slug ?? null, opcoName: a.opco?.name ?? null,
    userLabel: a.user.name ?? a.user.email,
  }))
  // Candidate approvers: active CAB members + opco approvers/admins, for the picker.
  const candidates = (await db.cABMembership.findMany({
    where: { isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  })).map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))
  const candidateUsers = Array.from(new Map(candidates.map((c) => [c.id, c])).values())
  const scopes = [
    ...(isGroupAdmin(session.user.realmRoles) ? [{ slug: "", name: "Group" }] : []),
    ...session.user.organizations.filter((o) => o.roles.includes("admin")).map((o) => ({ slug: o.alias, name: o.name })),
  ]
```

Then render `<ApprovalMatrixClient canManage={canManage} infraTypes={INFRA_TYPES} scopes={scopes} candidates={candidateUsers} rows={overrideRows} />` as the last child of the outer `<div>` (after the "Approvers per OpCo" card).

- [ ] **Step 3: Client** — create `src/app/(dashboard)/approval-matrix/approval-matrix-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { addApproverAssignment, removeApproverAssignment } from "@/server/actions/approval-matrix"

type OverrideRow = { id: string; infrastructureType: string; opcoSlug: string | null; opcoName: string | null; userLabel: string }

export default function ApprovalMatrixClient({
  canManage, infraTypes, scopes, candidates, rows,
}: {
  canManage: boolean
  infraTypes: string[]
  scopes: { slug: string; name: string }[]
  candidates: { id: string; label: string }[]
  rows: OverrideRow[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [infra, setInfra] = useState(infraTypes[0] ?? "")
  const [scope, setScope] = useState(scopes[0]?.slug ?? "")
  const [userId, setUserId] = useState(candidates[0]?.id ?? "")

  if (!canManage) return null

  const run = (fn: () => Promise<unknown>, okKey: string) =>
    startTransition(async () => {
      try { await fn(); toast({ title: t(language, okKey), variant: "success" }); router.refresh() }
      catch (err) { toast({ title: t(language, "matrix.failed"), description: err instanceof Error ? err.message : "", variant: "error" }) }
    })

  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-base">{t(language, "matrix.overrides.title")}</CardTitle>
        <CardDescription>{t(language, "matrix.overrides.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">{t(language, "matrix.infra")}
            <select className="mt-1 block w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={infra} onChange={(e) => setInfra(e.target.value)}>
              {infraTypes.map((i) => (<option key={i} value={i}>{i}</option>))}
            </select>
          </label>
          <label className="text-xs">{t(language, "matrix.scope")}
            <select className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (<option key={s.slug} value={s.slug}>{s.name}</option>))}
            </select>
          </label>
          <label className="text-xs">{t(language, "matrix.approver")}
            <select className="mt-1 block w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {candidates.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </label>
          <Button disabled={!infra || !userId} onClick={() => run(() => addApproverAssignment({ infrastructureType: infra, opcoSlug: scope || null, userId }), "matrix.added")}>
            {t(language, "matrix.add")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(language, "matrix.none")}</p>
        ) : (
          <ul className="divide-y divide-border/50 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>{r.infrastructureType} · {r.opcoName ?? t(language, "matrix.group")} · <span className="font-medium">{r.userLabel}</span></span>
                <button className="text-xs text-rose-600 hover:underline" onClick={() => run(() => removeApproverAssignment(r.id), "matrix.removed")}>{t(language, "matrix.remove")}</button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Type-check + lint + commit**

Run: `pnpm tsc --noEmit && pnpm lint` → PASS.

```bash
git add "src/app/(dashboard)/approval-matrix/page.tsx" "src/app/(dashboard)/approval-matrix/approval-matrix-client.tsx" src/lib/i18n.ts
git commit -m "feat(approval): editable approver overrides on approval-matrix"
```

---

## Task 6: Change-assignee actions (TDD)

**Files:** `src/server/actions/assignees.ts`, `src/test/actions/assignees.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/assignees.test.ts`:

```ts
// src/test/actions/assignees.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-req',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  changeAssignee: { deleteMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
  auditLog: { create: vi.fn(async () => ({})) },
}
const mockDb = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-req' })) },
  changeRequest: { findUnique: vi.fn(async () => ({ id: 'c1', requesterId: 'user-req', opcoId: 'opco-1', opco: { slug: 'ghana' }, infrastructureType: 'Wifi' })) },
  userOpCoAssignment: { findFirst: vi.fn(async () => null) },
  cABMembership: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { setChangeAssignees } from '@/server/actions/assignees'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req' })
  mockDb.changeRequest.findUnique.mockResolvedValue({ id: 'c1', requesterId: 'user-req', opcoId: 'opco-1', opco: { slug: 'ghana' }, infrastructureType: 'Wifi' })
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
})

describe('setChangeAssignees', () => {
  it('saves an implementer-role assignee (no eligibility check)', async () => {
    await setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'impl1', role: 'implementer' }) })
    )
  })

  it('rejects an approver-role assignee who is not an eligible approver', async () => {
    await expect(setChangeAssignees('c1', [{ userId: 'rando', role: 'approver' }]))
      .rejects.toThrow(/not an eligible approver/i)
  })

  it('accepts an approver-role assignee who holds approver authority in the OpCo', async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: 'a', role: 'approver' })
    await setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'appr1', role: 'approver' }) })
    )
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/actions/assignees.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { routedCabOpcoId } from "@/lib/approver-routing"

type AssigneeInput = { userId: string; role: "approver" | "implementer" }

async function isEligibleApprover(
  db: ReturnType<typeof getPrisma>, userId: string, opcoId: string, cabOpcoId: string | null
): Promise<boolean> {
  const opcoRole = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, isActive: true, role: { in: ["approver", "admin"] } },
  })
  if (opcoRole) return true
  const cab = await db.cABMembership.findFirst({ where: { userId, opcoId: cabOpcoId, isActive: true } })
  return !!cab
}

export async function listChangeAssignees(changeId: string) {
  const db = getPrisma()
  return db.changeAssignee.findMany({
    where: { changeId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

export async function setChangeAssignees(changeId: string, assignees: AssigneeInput[]) {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    select: { id: true, requesterId: true, opcoId: true, infrastructureType: true, opco: { select: { slug: true } } },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== me.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can set assignees")

  // Validate approver-role assignees are eligible approvers.
  const cabOpcoId = routedCabOpcoId(change.infrastructureType, change.opcoId)
  for (const a of assignees.filter((x) => x.role === "approver")) {
    if (!(await isEligibleApprover(db, a.userId, change.opcoId, cabOpcoId)))
      throw new Error("Assignee is not an eligible approver for this change's scope")
  }

  await db.$transaction(async (tx) => {
    await tx.changeAssignee.deleteMany({ where: { changeId } })
    for (const a of assignees) {
      await tx.changeAssignee.create({ data: { changeId, userId: a.userId, role: a.role } })
    }
    await tx.auditLog.create({
      data: { changeId, actorId: me.id, action: "assignees_set", note: `Set ${assignees.length} assignee(s)` },
    })
  })
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/actions/assignees.ts src/test/actions/assignees.test.ts
git commit -m "feat(approval): change-assignee actions with approver eligibility"
```

---

## Task 7: Assignees on change detail

**Files:** `src/app/(dashboard)/changes/[id]/page.tsx`, `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`, `src/app/(dashboard)/changes/[id]/assignees-dialog.tsx`, `src/lib/i18n.ts`

- [ ] **Step 1: i18n** — in `src/lib/i18n.ts` add to EN:

```ts
    "assignees.implementers": "Assigned to",
    "assignees.approvers": "Named approvers",
    "assignees.manage": "Manage assignees",
    "assignees.none": "None",
    "assignees.add": "Add",
    "assignees.role": "Role",
    "assignees.role.approver": "Approver",
    "assignees.role.implementer": "Implementer",
    "assignees.save": "Save",
    "assignees.saved": "Assignees updated",
    "assignees.failed": "Could not update assignees",
```

and FR:

```ts
    "assignees.implementers": "Affecté à",
    "assignees.approvers": "Approbateurs désignés",
    "assignees.manage": "Gérer les affectations",
    "assignees.none": "Aucun",
    "assignees.add": "Ajouter",
    "assignees.role": "Rôle",
    "assignees.role.approver": "Approbateur",
    "assignees.role.implementer": "Réalisateur",
    "assignees.save": "Enregistrer",
    "assignees.saved": "Affectations mises à jour",
    "assignees.failed": "Échec de la mise à jour",
```

- [ ] **Step 2: Load + serialize assignees** — in `src/app/(dashboard)/changes/[id]/page.tsx`, the `getChange` result is serialized. Add assignees to the serialized `SerializedChange`. In the `serialize` function add:

```ts
    assignees: change.assignees.map((a) => ({
      userId: a.userId, role: a.role,
      label: a.user.name ?? a.user.email,
    })),
```

This requires `getChange` to include assignees with the user. In `src/server/actions/changes.ts` `getChange`, add to the `include`: `assignees: { include: { user: { select: { name: true, email: true } } } },`. Also pass a `canManageAssignees` flag in `caps`: in `page.tsx` add to `caps` `canManageAssignees: caps.isRequester || caps.isAdmin` (compute after `caps` is built, or inline). Provide the candidate user list for the dialog: load active users in the change's OpCo:

```ts
  const assigneeCandidates = (await db.userOpCoAssignment.findMany({
    where: { opco: { slug }, isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  })).map((a) => ({ id: a.user.id, label: a.user.name ?? a.user.email }))
  const candidateUnique = Array.from(new Map(assigneeCandidates.map((c) => [c.id, c])).values())
```
Pass `assigneeCandidates={candidateUnique}` to `ChangeDetailClient`.

- [ ] **Step 3: Types + render** — in `change-detail-client.tsx`, add to `SerializedChange`:

```ts
  assignees: { userId: string; role: string; label: string }[]
```

Add to `Caps`: `canManageAssignees: boolean`. Add a prop `assigneeCandidates: { id: string; label: string }[]` to the component signature and the page's render. Import the dialog and add two cards in the right column (near the Actions/Status cards), plus a manage button:

```tsx
import AssigneesDialog from "./assignees-dialog"
// ...inside component state:
const [assigneesOpen, setAssigneesOpen] = useState(false)
// ...in the right column JSX:
<Card className="border-border/80 bg-card/95">
  <CardHeader className="pb-2 flex-row items-center justify-between">
    <CardTitle className="text-sm">{t(language, "assignees.implementers")}</CardTitle>
    {caps.canManageAssignees && (
      <button className="text-xs text-primary hover:underline" onClick={() => setAssigneesOpen(true)}>{t(language, "assignees.manage")}</button>
    )}
  </CardHeader>
  <CardContent className="text-sm">
    {change.assignees.filter((a) => a.role === "implementer").map((a) => <div key={a.userId}>{a.label}</div>)}
    {change.assignees.filter((a) => a.role === "implementer").length === 0 && <span className="text-muted-foreground">{t(language, "assignees.none")}</span>}
  </CardContent>
</Card>
<Card className="border-border/80 bg-card/95">
  <CardHeader className="pb-2"><CardTitle className="text-sm">{t(language, "assignees.approvers")}</CardTitle></CardHeader>
  <CardContent className="text-sm">
    {change.assignees.filter((a) => a.role === "approver").map((a) => <div key={a.userId}>{a.label}</div>)}
    {change.assignees.filter((a) => a.role === "approver").length === 0 && <span className="text-muted-foreground">{t(language, "assignees.none")}</span>}
  </CardContent>
</Card>
{assigneesOpen && (
  <AssigneesDialog
    changeId={change.id}
    candidates={assigneeCandidates}
    current={change.assignees.map((a) => ({ userId: a.userId, role: a.role as "approver" | "implementer" }))}
    onClose={() => setAssigneesOpen(false)}
  />
)}
```

(Adapt to the file's actual right-column structure; place the two cards alongside the existing Status/Actions cards.)

- [ ] **Step 4: Dialog** — create `src/app/(dashboard)/changes/[id]/assignees-dialog.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { setChangeAssignees } from "@/server/actions/assignees"

type Entry = { userId: string; role: "approver" | "implementer" }

export default function AssigneesDialog({
  changeId, candidates, current, onClose,
}: {
  changeId: string
  candidates: { id: string; label: string }[]
  current: Entry[]
  onClose: () => void
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [entries, setEntries] = useState<Entry[]>(current)
  const [pickUser, setPickUser] = useState(candidates[0]?.id ?? "")
  const [pickRole, setPickRole] = useState<"approver" | "implementer">("implementer")

  const add = () => {
    if (!pickUser || entries.some((e) => e.userId === pickUser)) return
    setEntries((e) => [...e, { userId: pickUser, role: pickRole }])
  }
  const remove = (userId: string) => setEntries((e) => e.filter((x) => x.userId !== userId))
  const labelOf = (id: string) => candidates.find((c) => c.id === id)?.label ?? id

  const save = () => startTransition(async () => {
    try {
      await setChangeAssignees(changeId, entries)
      toast({ title: t(language, "assignees.saved"), variant: "success" })
      onClose(); router.refresh()
    } catch (err) {
      toast({ title: t(language, "assignees.failed"), description: err instanceof Error ? err.message : "", variant: "error" })
    }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !isPending && onClose()}>
      <Card className="w-full max-w-md border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">{t(language, "assignees.manage")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <select className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={pickUser} onChange={(e) => setPickUser(e.target.value)}>
              {candidates.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={pickRole} onChange={(e) => setPickRole(e.target.value as Entry["role"])}>
              <option value="implementer">{t(language, "assignees.role.implementer")}</option>
              <option value="approver">{t(language, "assignees.role.approver")}</option>
            </select>
            <Button variant="outline" onClick={add}>{t(language, "assignees.add")}</Button>
          </div>
          <ul className="divide-y divide-border/50 text-sm">
            {entries.map((e) => (
              <li key={e.userId} className="flex items-center justify-between py-2">
                <span>{labelOf(e.userId)} · {t(language, `assignees.role.${e.role}`)}</span>
                <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(e.userId)}>✕</button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>{t(language, "risk.cancel")}</Button>
            <Button onClick={save} disabled={isPending}>{t(language, "assignees.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Type-check + lint + commit**

Run: `pnpm tsc --noEmit && pnpm lint` → PASS. (If `getChange`'s return type drives `serialize`, confirm the `assignees` include compiles; if the existing `caps` object is built in `page.tsx`, add `canManageAssignees` there and thread `assigneeCandidates` through the client props + the `page.tsx` render call.)

```bash
git add "src/app/(dashboard)/changes/[id]/page.tsx" "src/app/(dashboard)/changes/[id]/change-detail-client.tsx" "src/app/(dashboard)/changes/[id]/assignees-dialog.tsx" src/server/actions/changes.ts src/lib/i18n.ts
git commit -m "feat(approval): surface + manage change assignees on detail"
```

---

## Task 8: Deactivation reassignment helper (TDD)

**Files:** `src/server/approver-reassign.ts`, `src/test/server/approver-reassign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/approver-reassign.test.ts`:

```ts
// src/test/server/approver-reassign.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  changeRequest: { findMany: vi.fn().mockResolvedValue([]) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

const auth = {
  getRoutedApprovers: vi.fn().mockResolvedValue([]),
  getNamedApprovers: vi.fn().mockResolvedValue([]),
}
vi.mock('@/server/approval-authority', () => auth)
vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))

import { notifyRemainingAndDetectOrphans } from '@/server/approver-reassign'
import { notifyEvent } from '@/server/notify'

const footprint = [{ id: 'c1', reference: 12, title: 'X', infrastructureType: 'Wifi', opcoId: 'opco-1' }]

beforeEach(() => { vi.clearAllMocks(); auth.getRoutedApprovers.mockResolvedValue([]); auth.getNamedApprovers.mockResolvedValue([]) })

describe('notifyRemainingAndDetectOrphans', () => {
  it('flags a change with no remaining approvers as orphaned', async () => {
    const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
    expect(orphaned.map((o) => o.reference)).toEqual([12])
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('notifies remaining approvers and does not orphan', async () => {
    auth.getRoutedApprovers.mockResolvedValue([{ id: 'u2', name: 'U2', email: 'u2@x.com' }])
    const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
    expect(orphaned).toEqual([])
    expect(notifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval_requested', recipients: [{ userId: 'u2', email: 'u2@x.com', name: 'U2' }] })
    )
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/approver-reassign.ts`:

```ts
import { getPrisma } from "@/server/db"
import { getRoutedApprovers, getNamedApprovers } from "@/server/approval-authority"
import { notifyEvent } from "@/server/notify"

export type FootprintChange = { id: string; reference: number; title: string; infrastructureType: string; opcoId: string }

/** Pending changes the user is a routed or named approver of. Call BEFORE deactivation. */
export async function approverPendingFootprint(userId: string): Promise<FootprintChange[]> {
  const db = getPrisma()
  const pending = await db.changeRequest.findMany({
    where: { status: "pending" },
    select: { id: true, reference: true, title: true, infrastructureType: true, opcoId: true },
  })
  const out: FootprintChange[] = []
  for (const c of pending) {
    const routed = await getRoutedApprovers({ infrastructureType: c.infrastructureType, opcoId: c.opcoId })
    const named = await getNamedApprovers(c.id)
    if ([...routed, ...named].some((u) => u.id === userId)) out.push(c)
  }
  return out
}

/** After deactivation: notify remaining approvers; collect changes left with none. */
export async function notifyRemainingAndDetectOrphans(
  footprint: FootprintChange[]
): Promise<{ orphaned: { id: string; reference: number; title: string }[] }> {
  const orphaned: { id: string; reference: number; title: string }[] = []
  for (const c of footprint) {
    const routed = await getRoutedApprovers({ infrastructureType: c.infrastructureType, opcoId: c.opcoId })
    const named = await getNamedApprovers(c.id)
    const seen = new Set<string>()
    const remaining = [...routed, ...named].filter((u) => { if (seen.has(u.id)) return false; seen.add(u.id); return true })
    if (remaining.length === 0) {
      orphaned.push({ id: c.id, reference: c.reference, title: c.title })
      continue
    }
    await notifyEvent({
      type: "approval_requested",
      recipients: remaining.map((u) => ({ userId: u.id, email: u.email, name: u.name })),
      change: { id: c.id, title: c.title, opcoId: c.opcoId },
    }).catch(() => {})
  }
  return { orphaned }
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/approver-reassign.ts src/test/server/approver-reassign.test.ts
git commit -m "feat(approval): deactivation footprint + orphan detection"
```

---

## Task 9: Deactivation integration + orphan warning

**Files:** `src/server/actions/users.ts`, `src/app/(dashboard)/users/users-client.tsx`

- [ ] **Step 1: Integrate into `deactivateUser`**

In `src/server/actions/users.ts`, add imports: `import { approverPendingFootprint, notifyRemainingAndDetectOrphans } from "@/server/approver-reassign"`.

In `deactivateUser`, **before** the `$transaction`, capture the footprint:

```ts
  const footprint = await approverPendingFootprint(userId)
```

**Inside** the existing `$transaction(async (tx) => { ... })`, after the `userOpCoAssignment.updateMany`, add:

```ts
    await tx.cABMembership.updateMany({ where: { userId, isActive: true }, data: { isActive: false, endedAt: new Date() } })
    await tx.approverAssignment.updateMany({ where: { userId, isActive: true }, data: { isActive: false } })
```

**After** the transaction returns, add and return:

```ts
  const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
  return { orphanedChanges: orphaned }
```

(The function currently returns nothing; adding a return is backward-compatible.)

- [ ] **Step 2: Update the deactivate test (if present)**

Run `pnpm exec grep -rln "deactivateUser" src/test` — if a test exists, add `cABMembership.updateMany`/`approverAssignment.updateMany` to its tx mock and `changeRequest.findMany` (returns `[]`) so `approverPendingFootprint` resolves, plus `vi.mock('@/server/approver-reassign', ...)` or `@/server/notify`. Keep its existing assertions green. If no test references `deactivateUser`, skip.

- [ ] **Step 3: Orphan warning in the client**

In `src/app/(dashboard)/users/users-client.tsx`, change `handleDeactivate` to read the result:

```ts
      const res = await deactivateUser(confirmUser.id)
      const orphans = (res as { orphanedChanges?: { reference: number }[] })?.orphanedChanges ?? []
      toast({
        title: t(language, "users.toast.deactivated"),
        description: orphans.length > 0
          ? `⚠ ${orphans.length} pending change(s) now have no approver: ${orphans.map((o) => `#${o.reference}`).join(", ")}`
          : confirmUser.email,
        variant: orphans.length > 0 ? "error" : "success",
      })
```

(Keep the rest of the handler — `setConfirmUser(null)`, `router.refresh()`, catch — unchanged.)

- [ ] **Step 4: Type-check + lint + tests + commit**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS (Testcontainers suites need Docker — known-OK).

```bash
git add src/server/actions/users.ts "src/app/(dashboard)/users/users-client.tsx" src/test
git commit -m "feat(approval): end approver roles + warn on orphaned changes at deactivation"
```

---

## Task 10: Full verification + live migration + Playwright smoke

**Files:** none (verification)

- [ ] **Step 1: Full gate** — `pnpm tsc --noEmit && pnpm lint && pnpm test`. tsc clean, lint 0 errors, all suites pass (existing approval/quorum/SoD tests stay green + new `approval-authority`, `approval-matrix`, `assignees`, `approver-reassign`). Fix regressions.

- [ ] **Step 2: Build** — `pnpm build` succeeds.

- [ ] **Step 3: Apply migration live + restart dev**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/csquared_cms' pnpm prisma migrate deploy
```
Restart `pnpm dev`.

- [ ] **Step 4: Playwright smoke** (`devops@csquared.com` / `Admin2025$`):
  - **Override:** on `/approval-matrix`, add an approver override for (Wifi, Ghana) naming a non-CAB user; confirm that user can now approve a pending Wifi/Ghana change (open it as that scope, or verify `listApprovableChanges` includes them) and the CAB default no longer routes. Remove the override; confirm CAB routing returns.
  - **Assignees:** on a change detail, open "Manage assignees", add an implementer and an eligible approver; confirm both render in the "Assigned to" / "Named approvers" cards; confirm an ineligible approver is rejected with a toast.
  - **Deactivation:** make a user the *sole* approver of a pending change (override), deactivate them in `/users`, confirm the toast warns the change is now orphaned (by reference) and the change is no longer approvable by that user.

- [ ] **Step 5: Final commit (only if smoke required fixes)**

```bash
git add -A && git commit -m "fix(bundle4): smoke-test adjustments"
```

---

## Self-Review notes (spec coverage)

- **Part A:** Task 1 (model), Task 2 (override-aware `getRoutedApprovers`), Task 4 (CRUD + audit), Task 5 (editable matrix). ✅
- **Part B:** Task 1 (`AssigneeRole` + `ChangeAssignee.role`), Task 2 (`getNamedApprovers` + `canUserApproveChange(changeId)`), Task 3 (submit-notify union + `submitApproval` changeId + `listApprovableChanges`), Task 6 (eligibility-checked `setChangeAssignees`), Task 7 (detail cards + dialog). ✅
- **Part C:** Task 8 (footprint + orphan detection), Task 9 (`deactivateUser` integration + non-blocking warning). ✅
- **Quorum untouched** — `isCab: true` already records every authorized approval; no change. Existing approval tests stay green (override/named/deactivation paths inert without data).
- **i18n (en+fr):** Tasks 5, 7. ✅
