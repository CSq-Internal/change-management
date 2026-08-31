# Requester-Selected Approvers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let requesters name their own approvers from an OpCo-scoped (or, for Equiano infra, group-CAB-only) picker on the request form, and require at least one named approver before a change can be submitted.

**Architecture:** One eligibility rule lives in `src/server/approval-authority.ts` and is consumed by the picker, by `createChange`, by `setChangeApprovers`, and by `setChangeAssignees` — so the UI can never offer someone the server will reject. Requester-named approvers are *additive*: the routed CAB keeps its authority and is still notified. Enforcement of the mandatory rule is server-side in `submitChange`, with the form disabling Submit as a convenience only.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma v7 + `@prisma/adapter-pg`, Vitest + React Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-23-requester-selected-approvers-design.md`

## Global Constraints

- Use `pnpm` for every command. `package-lock.json` does not exist; `pnpm-lock.yaml` is authoritative.
- Group-level infra is defined **only** by `EQUIANO_INFRA_TYPES` / `isGroupLevelInfra()` in `src/lib/approver-routing.ts` (`"Equiano Optics"`, `"Equiano IP"`). Never hard-code those strings anywhere else.
- For Equiano infra, eligible approvers are **group CAB members only** (`CABMembership` where `opcoId IS NULL`). The OpCo `approver`/`admin` clause does **not** apply.
- Server action errors are plain English strings, not i18n keys — match the existing `"Cannot submit: required field(s) missing: …"` phrasing style in `src/server/actions/changes.ts`.
- All new user-visible UI strings go in `src/lib/i18n.ts` in **both** the EN and FR maps.
- No database migration. `ChangeAssignee` already has `@@unique([changeId, userId])`; do not add a unique constraint to `Approval`.
- Requester-named approvers are additive. Never remove or bypass `getRoutedApprovers`.
- Path alias `@/*` maps to `src/*`.
- Run `pnpm tsc --noEmit` and `pnpm lint` clean before the final commit of each task.

---

### Task 1: Shared approver-eligibility rule

Creates the single source of truth. Everything else consumes it.

**Files:**
- Modify: `src/server/approval-authority.ts` (add exports at end of file)
- Test: `src/test/server/approval-authority.test.ts` (extend)

**Interfaces:**
- Consumes: `isGroupLevelInfra` from `@/lib/approver-routing`; `getPrisma` from `@/server/db`.
- Produces:
  - `listEligibleApprovers(opcoId: string, infrastructureType: string, excludeUserId?: string): Promise<ApproverUser[]>`
  - `listEligibleApproversForScope(opcoSlug: string, infrastructureType: string, excludeUserId?: string): Promise<ApproverUser[]>`
  - `isEligibleApprover(userId: string, opcoId: string, infrastructureType: string): Promise<boolean>`
  - `ApproverUser` is the existing local type `{ id: string; name: string | null; email: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/server/approval-authority.test.ts`. First add `userOpCoAssignment` and `opCo` to the existing `mockDb` object at the top of the file (it currently lacks both):

```ts
const mockDb = {
  approverAssignment: { findMany: vi.fn() },
  cABMembership: { findMany: vi.fn() },
  approverDelegation: { findMany: vi.fn() },
  changeAssignee: { findMany: vi.fn() },
  changeRequest: { findMany: vi.fn() },
  userOpCoAssignment: { findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
}
```

Add both to the existing `beforeEach` reset block:

```ts
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-1" })
```

Extend the import line to pull in the new functions:

```ts
import {
  getRoutedApprovers, getNamedApprovers, canUserApproveChange, listApprovableChanges,
  listEligibleApprovers, listEligibleApproversForScope, isEligibleApprover,
} from "@/server/approval-authority"
```

Then append these test blocks:

```ts
describe("listEligibleApprovers", () => {
  it("non-Equiano infra: returns OpCo CAB members plus OpCo approver/admin role holders", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
      { user: { id: "adm1", name: "Adm One", email: "adm1@c.com", isActive: true } },
    ])

    const out = await listEligibleApprovers("opco-1", "Wifi")

    expect(out.map((u) => u.id).sort()).toEqual(["adm1", "appr1", "cab1"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", isActive: true }) })
    )
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          opcoId: "opco-1", isActive: true, role: { in: ["approver", "admin"] },
        }),
      })
    )
  })

  it("Equiano infra: returns group CAB members ONLY and never queries OpCo role holders", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "samuel", name: "Samuel", email: "s@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
    ])

    const out = await listEligibleApprovers("opco-1", "Equiano Optics")

    expect(out.map((u) => u.id)).toEqual(["samuel"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
    expect(mockDb.userOpCoAssignment.findMany).not.toHaveBeenCalled()
  })

  it("excludes inactive users", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "live", name: "Live", email: "live@c.com", isActive: true } },
      { user: { id: "gone", name: "Gone", email: "gone@c.com", isActive: false } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["live"])
  })

  it("excludes excludeUserId (the requester)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "me", name: "Me", email: "me@c.com", isActive: true } },
      { user: { id: "other", name: "Other", email: "other@c.com", isActive: true } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi", "me")
    expect(out.map((u) => u.id)).toEqual(["other"])
  })

  it("dedupes a user who is both a CAB member and an OpCo approver", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "dual", name: "Dual", email: "dual@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "dual", name: "Dual", email: "dual@c.com", isActive: true } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["dual"])
  })

  it("does NOT include delegates (they derive authority via getRoutedApprovers)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    mockDb.approverDelegation.findMany.mockResolvedValue([
      { toUser: { id: "delegate", name: "Del", email: "del@c.com" } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["cab1"])
  })
})

describe("listEligibleApproversForScope", () => {
  it("resolves the OpCo slug to an id and delegates to listEligibleApprovers", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-9" })
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    const out = await listEligibleApproversForScope("ghana", "Wifi")
    expect(mockDb.opCo.findUnique).toHaveBeenCalledWith({ where: { slug: "ghana" }, select: { id: true } })
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-9" }) })
    )
    expect(out.map((u) => u.id)).toEqual(["cab1"])
  })

  it("returns an empty list for an unknown OpCo slug", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    const out = await listEligibleApproversForScope("nowhere", "Wifi")
    expect(out).toEqual([])
  })
})

describe("isEligibleApprover", () => {
  it("agrees with listEligibleApprovers — true for a listed user", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    expect(await isEligibleApprover("cab1", "opco-1", "Wifi")).toBe(true)
  })

  it("false for a user absent from the eligible list", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
    expect(await isEligibleApprover("rando", "opco-1", "Wifi")).toBe(false)
  })

  it("false for an OpCo approver on an Equiano change (group-only tightening)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
    ])
    expect(await isEligibleApprover("appr1", "opco-1", "Equiano IP")).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/server/approval-authority.test.ts`

Expected: FAIL — `listEligibleApprovers is not a function` (and the same for the other two new exports).

- [ ] **Step 3: Write the implementation**

Append to the end of `src/server/approval-authority.ts`, and add `isGroupLevelInfra` to the existing import from `@/lib/approver-routing` on line 3:

```ts
import { routedCabOpcoId, isGroupLevelInfra } from "@/lib/approver-routing"
```

```ts
/**
 * Users a requester may name as an approver on a change in this scope.
 *
 * Equiano infra is group-level: the group CAB and nobody else. All other infra is
 * per-OpCo: the OpCo CAB plus resident approver/admin role holders.
 *
 * Delegates are deliberately absent — a delegate's authority is time-boxed and already
 * resolved by getRoutedApprovers at notification time. Naming one directly would create
 * a second grant that outlives the delegation window.
 */
export async function listEligibleApprovers(
  opcoId: string,
  infrastructureType: string,
  excludeUserId?: string,
): Promise<ApproverUser[]> {
  const db = getPrisma()
  const groupLevel = isGroupLevelInfra(infrastructureType)

  const cab = await db.cABMembership.findMany({
    where: { opcoId: groupLevel ? null : opcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })
  const candidates = cab.map((m) => m.user)

  if (!groupLevel) {
    const roleHolders = await db.userOpCoAssignment.findMany({
      where: { opcoId, isActive: true, role: { in: ["approver", "admin"] } },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    })
    candidates.push(...roleHolders.map((a) => a.user))
  }

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of candidates) {
    if (!u.isActive) continue
    if (u.id === excludeUserId) continue
    if (seen.has(u.id)) continue
    seen.add(u.id)
    out.push({ id: u.id, name: u.name, email: u.email })
  }
  return out
}

/** Slug-keyed variant, for callers that have an OpCo slug rather than an id (the request form). */
export async function listEligibleApproversForScope(
  opcoSlug: string,
  infrastructureType: string,
  excludeUserId?: string,
): Promise<ApproverUser[]> {
  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug }, select: { id: true } })
  if (!opco) return []
  return listEligibleApprovers(opco.id, infrastructureType, excludeUserId)
}

/** Membership test against the same list, so the check can never diverge from the picker. */
export async function isEligibleApprover(
  userId: string,
  opcoId: string,
  infrastructureType: string,
): Promise<boolean> {
  const eligible = await listEligibleApprovers(opcoId, infrastructureType)
  return eligible.some((u) => u.id === userId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/server/approval-authority.test.ts`

Expected: PASS — all pre-existing tests plus 11 new ones.

- [ ] **Step 5: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/approval-authority.ts src/test/server/approval-authority.test.ts
git commit -m "feat(approvals): shared approver-eligibility rule, Equiano group-only

Adds listEligibleApprovers / listEligibleApproversForScope / isEligibleApprover
as the single source of truth for who may be named an approver. Equiano infra
resolves to group CAB members only; the OpCo approver/admin clause no longer
applies to group-level infra."
```

---

### Task 2: Point `assignees.ts` at the shared rule and guard the last approver

Deletes the divergent private copy of the rule and adds the invariant that a submitted change keeps at least one approver.

**Files:**
- Modify: `src/server/actions/assignees.ts`
- Test: `src/test/actions/assignees.test.ts` (extend)

**Interfaces:**
- Consumes: `isEligibleApprover(userId, opcoId, infrastructureType)` from Task 1.
- Produces: `setChangeApprovers(changeId: string, approverIds: string[]): Promise<void>` — replaces only `role: "approver"` rows, leaving implementers untouched.

- [ ] **Step 1: Write the failing tests**

In `src/test/actions/assignees.test.ts`, add `status` to the `changeRequest.findUnique` mock in **both** the `mockDb` literal and the `beforeEach` reset, and add a `deleteMany` to the `tx.changeAssignee` mock:

```ts
const tx = {
  changeAssignee: {
    deleteMany: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  },
  auditLog: { create: vi.fn(async () => ({})) },
}
```

```ts
const CHANGE = {
  id: 'c1', status: 'draft', requesterId: 'user-req', opcoId: 'opco-1',
  opco: { slug: 'ghana' }, infrastructureType: 'Wifi',
}
```

Use `CHANGE` in both the `mockDb` literal and the `beforeEach` reset:

```ts
  mockDb.changeRequest.findUnique.mockResolvedValue(CHANGE)
```

Replace the `@/server/db`-only mock section by also mocking the shared rule, so these tests exercise `assignees.ts` and not Task 1's query:

```ts
vi.mock('@/server/approval-authority', () => ({
  isEligibleApprover: vi.fn(async () => false),
}))

import { setChangeAssignees, setChangeApprovers } from '@/server/actions/assignees'
import { isEligibleApprover } from '@/server/approval-authority'
```

Add to `beforeEach`:

```ts
  vi.mocked(isEligibleApprover).mockResolvedValue(false)
```

The three pre-existing tests need updating to drive the mocked rule instead of the raw DB:
- `'rejects an approver-role assignee who is not an eligible approver'` — leave as-is; the default mock returns `false`.
- `'accepts an approver-role assignee who holds approver authority in the OpCo'` — replace the `mockDb.userOpCoAssignment.findFirst.mockResolvedValue(...)` line with `vi.mocked(isEligibleApprover).mockResolvedValue(true)`.
- `'saves an implementer-role assignee (no eligibility check)'` — leave as-is.

Then append:

```ts
describe('setChangeAssignees — eligibility delegation', () => {
  it('calls the shared rule with the change opcoId and infrastructureType', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }])
    expect(isEligibleApprover).toHaveBeenCalledWith('appr1', 'opco-1', 'Wifi')
  })

  it('rejects an OpCo approver on an Equiano change (regression: routing leak)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, infrastructureType: 'Equiano IP' })
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }]))
      .rejects.toThrow(/not an eligible approver/i)
  })
})

describe('setChangeAssignees — last-approver guard', () => {
  it('rejects removing the last approver when the change is pending', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    await expect(setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }]))
      .rejects.toThrow(/at least one named approver/i)
  })

  it('allows removing the last approver while the change is still a draft', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'draft' })
    await setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'impl1' }) })
    )
  })

  it('allows a pending change to keep an approver while changing implementers', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeAssignees('c1', [
      { userId: 'appr1', role: 'approver' },
      { userId: 'impl2', role: 'implementer' },
    ])
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
  })
})

describe('setChangeApprovers', () => {
  it('deletes only approver rows, leaving implementers intact', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeApprovers('c1', ['appr1'])
    expect(tx.changeAssignee.deleteMany).toHaveBeenCalledWith({
      where: { changeId: 'c1', role: 'approver' },
    })
  })

  it('creates an approver row per id', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeApprovers('c1', ['appr1', 'appr2'])
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { changeId: 'c1', userId: 'appr1', role: 'approver' } })
    )
  })

  it('rejects an ineligible approver id', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(setChangeApprovers('c1', ['rando']))
      .rejects.toThrow(/not an eligible approver/i)
  })

  it('rejects clearing every approver on a pending change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    await expect(setChangeApprovers('c1', []))
      .rejects.toThrow(/at least one named approver/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/actions/assignees.test.ts`

Expected: FAIL — `setChangeApprovers is not a function`, and the last-approver-guard tests fail because no such guard exists yet.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/server/actions/assignees.ts` with:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { isEligibleApprover } from "@/server/approval-authority"

type AssigneeInput = { userId: string; role: "approver" | "implementer" }

const NO_APPROVER_ERROR =
  "Cannot save: a submitted change must have at least one named approver"

/**
 * Shared authz + change lookup for both setters. Only the requester or an admin may
 * change who is assigned to a change.
 */
async function loadChangeForAssigneeWrite(changeId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.keycloakId },
    select: { id: true },
  })
  if (!me) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    select: {
      id: true, status: true, requesterId: true, opcoId: true,
      infrastructureType: true, opco: { select: { slug: true } },
    },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin =
    isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== me.id && !isAdmin) {
    throw new Error("Forbidden: only the requester or an admin can set assignees")
  }
  return { db, me, change }
}

async function assertApproversEligible(
  approverIds: string[],
  opcoId: string,
  infrastructureType: string,
) {
  for (const userId of approverIds) {
    if (!(await isEligibleApprover(userId, opcoId, infrastructureType))) {
      throw new Error("Assignee is not an eligible approver for this change's scope")
    }
  }
}

export async function listChangeAssignees(changeId: string) {
  const db = getPrisma()
  return db.changeAssignee.findMany({
    where: { changeId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

export async function setChangeAssignees(changeId: string, assignees: AssigneeInput[]) {
  const { db, me, change } = await loadChangeForAssigneeWrite(changeId)

  const approverIds = assignees.filter((a) => a.role === "approver").map((a) => a.userId)
  // A change past draft must never be left without an approver — otherwise a requester
  // could submit with one and immediately strip it back out.
  if (change.status !== "draft" && approverIds.length === 0) {
    throw new Error(NO_APPROVER_ERROR)
  }
  await assertApproversEligible(approverIds, change.opcoId, change.infrastructureType)

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

/**
 * Replace only the approver rows. Used by the request form, which knows about approvers
 * but not implementers — a full setChangeAssignees call from there would silently delete
 * implementers named on the change-detail page.
 */
export async function setChangeApprovers(changeId: string, approverIds: string[]) {
  const { db, me, change } = await loadChangeForAssigneeWrite(changeId)

  if (change.status !== "draft" && approverIds.length === 0) {
    throw new Error(NO_APPROVER_ERROR)
  }
  await assertApproversEligible(approverIds, change.opcoId, change.infrastructureType)

  await db.$transaction(async (tx) => {
    await tx.changeAssignee.deleteMany({ where: { changeId, role: "approver" } })
    for (const userId of approverIds) {
      await tx.changeAssignee.create({ data: { changeId, userId, role: "approver" } })
    }
    await tx.auditLog.create({
      data: {
        changeId, actorId: me.id, action: "approvers_set",
        note: `Named ${approverIds.length} approver(s)`,
      },
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/actions/assignees.test.ts`

Expected: PASS — 3 updated pre-existing tests plus 9 new ones.

- [ ] **Step 5: Confirm nothing else consumed the deleted private helper**

Run: `grep -rn "isEligibleApprover" src --include="*.ts" --include="*.tsx"`

Expected: references only in `src/server/approval-authority.ts`, `src/server/actions/assignees.ts`, and the two test files. No other file should define its own copy.

- [ ] **Step 6: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`

Expected: no type or lint errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/assignees.ts src/test/actions/assignees.test.ts
git commit -m "refactor(assignees): use shared eligibility rule, guard last approver

Deletes the private isEligibleApprover copy in favour of the shared rule, so
Equiano changes now correctly reject OpCo approvers. Adds setChangeApprovers,
which replaces only approver rows, and blocks removing the last approver once
a change is past draft."
```

---

### Task 3: `createChange` accepts `approverIds`

**Files:**
- Modify: `src/server/actions/changes.ts:17-33` (the `CreateChangeInput` type) and `:81-121` (`createChange`)
- Test: `src/test/actions/changes.test.ts` (extend)

**Interfaces:**
- Consumes: `isEligibleApprover` from Task 1.
- Produces: `createChange(opcoSlug, data)` where `data.approverIds?: string[]`. Writes `ChangeRequest`, `ChangeAssignee[]` (role `"approver"`), and the `created` audit row in one `$transaction`.

- [ ] **Step 1: Write the failing tests**

In `src/test/actions/changes.test.ts`, add `$transaction` and `changeAssignee.create` to `mockDb`:

```ts
const tx = {
  changeRequest: {
    create: vi.fn().mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: 'cr-new', status: 'draft', ...(data as object) })
    ),
  },
  changeAssignee: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
```

Add to the `mockDb` object literal:

```ts
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
```

Mock the shared rule (add near the other `vi.mock` calls, before the `import` of the actions):

```ts
vi.mock('@/server/approval-authority', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/approval-authority')>()
  return { ...actual, isEligibleApprover: vi.fn(async () => true) }
})
```

Import it alongside the existing imports:

```ts
import { isEligibleApprover } from '@/server/approval-authority'
```

Add to `beforeEach`:

```ts
  tx.changeRequest.create.mockClear()
  tx.changeAssignee.create.mockClear()
  tx.auditLog.create.mockClear()
  vi.mocked(isEligibleApprover).mockResolvedValue(true)
```

Then append:

```ts
describe('createChange — approverIds', () => {
  const baseInput = {
    title: 'Router update', description: 'BGP config',
    category: 'config' as const, riskLevel: 'low' as const,
    contactEmail: 'test@csquared.com', infrastructureType: 'Wifi',
  }

  it('writes an approver ChangeAssignee row per id', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1', 'appr2'] })
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
    expect(tx.changeAssignee.create).toHaveBeenCalledWith({
      data: { changeId: 'cr-new', userId: 'appr1', role: 'approver' },
    })
  })

  it('validates each id against the shared eligibility rule', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1'] })
    expect(isEligibleApprover).toHaveBeenCalledWith('appr1', 'opco-1', 'Wifi')
  })

  it('succeeds with no approverIds — drafts are exempt', async () => {
    const out = await createChange('ghana', baseInput)
    expect(out.id).toBe('cr-new')
    expect(tx.changeAssignee.create).not.toHaveBeenCalled()
  })

  it('throws on an ineligible id and writes no ChangeRequest', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(createChange('ghana', { ...baseInput, approverIds: ['rando'] }))
      .rejects.toThrow(/not an eligible approver/i)
    expect(tx.changeRequest.create).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('throws when an OpCo approver is named on an Equiano change', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(createChange('ghana', {
      ...baseInput, infrastructureType: 'Equiano IP', approverIds: ['appr1'],
    })).rejects.toThrow(/not an eligible approver/i)
  })

  it('does not strip approverIds into the ChangeRequest row', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1'] })
    const created = tx.changeRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(created.data).not.toHaveProperty('approverIds')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/actions/changes.test.ts -t "createChange — approverIds"`

Expected: FAIL — `approverIds` is not a recognised property, and `tx.changeAssignee.create` is never called.

- [ ] **Step 3: Write the implementation**

Add `approverIds` to `CreateChangeInput` in `src/server/actions/changes.ts`:

```ts
type CreateChangeInput = {
  title: string
  description: string
  category: ChangeCategory
  riskLevel: RiskLevel
  contactEmail: string
  infrastructureType: string
  changeReason?: string
  impactScope?: string
  implementationPlan?: string
  testingPlan?: string
  backoutPlan?: string
  changeWindow?: string
  plannedStart?: Date
  plannedEnd?: Date
  isEmergency?: boolean
  /** Requester-nominated approvers. Additive — routed CAB approvers keep their authority. */
  approverIds?: string[]
}
```

Add `isEligibleApprover` to the existing `@/server/approval-authority` import on line 9:

```ts
import { getRoutedApprovers, getNamedApprovers, canUserApproveChange, isEligibleApprover } from "@/server/approval-authority"
```

Replace the body of `createChange` from the `slaDeadline` line to the `return change` line:

```ts
  const slaDeadline = new Date()
  slaDeadline.setHours(slaDeadline.getHours() + SLA_HOURS[data.riskLevel])

  const { approverIds = [], ...changeData } = data

  // Validate before opening the transaction so a bad id leaves nothing behind.
  for (const userId of approverIds) {
    if (!(await isEligibleApprover(userId, opco.id, data.infrastructureType))) {
      throw new Error("Assignee is not an eligible approver for this change's scope")
    }
  }

  const change = await db.$transaction(async (tx) => {
    const created = await tx.changeRequest.create({
      data: { ...changeData, opcoId: opco.id, requesterId: user.id, status: "draft", slaDeadline },
    })
    for (const userId of approverIds) {
      await tx.changeAssignee.create({ data: { changeId: created.id, userId, role: "approver" } })
    }
    await tx.auditLog.create({
      data: { changeId: created.id, actorId: user.id, action: "created", toStatus: "draft" },
    })
    return created
  })

  return change
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/actions/changes.test.ts`

Expected: PASS — all pre-existing `createChange` tests plus 6 new ones.

- [ ] **Step 5: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(changes): createChange accepts requester-nominated approverIds

Validates each id against the shared eligibility rule before opening a
transaction, then writes ChangeRequest + ChangeAssignee rows + the audit row
atomically. Drafts remain exempt: omitting approverIds still succeeds."
```

---

### Task 4: Mandatory approver gate in `submitChange`

The authoritative enforcement point for the invariant.

**Files:**
- Modify: `src/server/actions/changes.ts:150-231` (`submitChange`)
- Test: `src/test/actions/changes.test.ts` (extend)

**Interfaces:**
- Consumes: the `changeAssignee` relation on `ChangeRequest`.
- Produces: `submitChange` throws `"Cannot submit: at least one approver must be named"` when no approver is named.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/actions/changes.test.ts`:

```ts
describe('submitChange — mandatory approver', () => {
  const SUBMITTABLE = {
    id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
    opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
    riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
    infrastructureType: 'Backbone IP Network',
    isEmergency: false,
    plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
    attachments: [],
  }

  it('throws when the change has no named approver', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...SUBMITTABLE, assignees: [] })
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('succeeds when one approver is named', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE,
      assignees: [{ userId: 'appr1', role: 'approver' }],
    })
    await submitChange('cr-1')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cr-1' }, data: { status: 'pending' } })
    )
  })

  it('ignores implementer assignees when counting approvers', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE,
      assignees: [{ userId: 'impl1', role: 'implementer' }],
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
  })

  it('blocks an emergency change with no named approver (no exemption by design)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE, isEmergency: true, riskLevel: 'emergency', assignees: [],
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/actions/changes.test.ts -t "submitChange — mandatory approver"`

Expected: FAIL — the first test does not throw; `changeRequest.update` is called.

- [ ] **Step 3: Write the implementation**

In `submitChange`, extend the `findUnique` include on line 157 to load assignees:

```ts
  const change = await db.changeRequest.findUnique({
    where: { id }, include: { opco: true, attachments: true, assignees: true },
  })
```

Then insert the gate immediately after the existing `missingFields` check (after line 182, before the blackout block):

```ts
  // At least one approver must be named before a change can enter the approval flow.
  // Requester-named approvers are additive — the routed CAB keeps its authority — but
  // the nomination itself is mandatory.
  const namedApprovers = change.assignees.filter((a) => a.role === "approver")
  if (namedApprovers.length === 0) {
    throw new Error("Cannot submit: at least one approver must be named")
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/actions/changes.test.ts`

Expected: PASS. Pre-existing `submitChange` tests that do not set `assignees` will now fail — update each of their `changeRequest.findUnique` mocks to include `assignees: [{ userId: 'appr1', role: 'approver' }]`. This is expected: those tests assert the happy path, which now requires an approver.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: all pass. Any other suite that submits a change (for example `src/test/server/notify.test.ts`) needs the same `assignees` addition to its mock.

- [ ] **Step 6: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/changes.ts src/test/
git commit -m "feat(changes): require at least one named approver to submit

submitChange now refuses a change with no ChangeAssignee of role approver,
alongside the existing required-field and required-document gates. No
emergency exemption: a change nobody can approve should fail loudly at submit
rather than sit unnoticed in pending."
```

---

### Task 5: Duplicate-vote guard in `submitApproval`

**Files:**
- Modify: `src/server/actions/approvals.ts:32-52`
- Test: `src/test/actions/approvals.test.ts` (extend)

**Interfaces:**
- Consumes: the existing `change.approvals` array and the `isRetrospective` flag.
- Produces: `submitApproval` throws `"You have already voted on this change"` on a repeat non-retrospective vote.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/actions/approvals.test.ts`:

```ts
describe('submitApproval — duplicate vote guard', () => {
  const PENDING = {
    id: 'cr-1', status: 'pending', riskLevel: 'low', infrastructureType: 'Wifi',
    opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
  }

  it('rejects a second vote from the same user on a pending change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true }],
    })
    await expect(submitApproval('cr-1', 'approve', undefined, true))
      .rejects.toThrow(/already voted/i)
    expect(mockDb.approval.create).not.toHaveBeenCalled()
  })

  it('allows a first vote when others have already voted', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'someone-else-entirely', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.approval.create).toHaveBeenCalled()
  })

  it('allows a retrospective vote from a user who already voted normally', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      status: 'implemented', isEmergency: true, expedited: true,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.approval.create).toHaveBeenCalled()
  })
})

describe('submitApproval — named approvers count toward quorum', () => {
  it('two distinct approvers satisfy quorum on a high-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      id: 'cr-1', status: 'pending', riskLevel: 'high', infrastructureType: 'Wifi',
      opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
      approvals: [{ approverId: 'first-approver', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cr-1' }, data: { status: 'approved' } })
    )
  })

  it('a single approver does not satisfy quorum on a high-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      id: 'cr-1', status: 'pending', riskLevel: 'high', infrastructureType: 'Wifi',
      opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
      approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/actions/approvals.test.ts -t "duplicate vote guard"`

Expected: FAIL — the first test does not throw; `approval.create` is called.

- [ ] **Step 3: Write the implementation**

In `src/server/actions/approvals.ts`, insert immediately after the `isRetrospective` / status check block (after line 33, before the `canUserApproveChange` call):

```ts
  // One vote per approver per change. Deliberately application-level rather than a DB
  // unique constraint: an emergency can legitimately collect a normal approval, be
  // expedited-implemented, then receive a retrospective approval from the same person.
  if (!isRetrospective && change.approvals.some((a) => a.approverId === user.id)) {
    throw new Error("You have already voted on this change")
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/actions/approvals.test.ts`

Expected: PASS — all pre-existing tests plus 5 new ones.

- [ ] **Step 5: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`

Expected: no errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/approvals.ts src/test/actions/approvals.test.ts
git commit -m "fix(approvals): reject duplicate votes, pin quorum semantics

One vote per approver per change, application-level so the legitimate
expedited-then-retrospective path still works. Adds tests pinning that named
approvers count toward CAB quorum and that one approver alone does not."
```

---

### Task 6: Fix the change-detail assignee picker

Bug fix — the dialog currently offers every OpCo user and omits group CAB members on Equiano changes.

**Files:**
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx:105-110`
- Test: none (server component data wiring; covered by Task 1's rule tests)

**Interfaces:**
- Consumes: `listEligibleApprovers(opcoId, infrastructureType, excludeUserId?)` from Task 1.
- Produces: unchanged `assigneeCandidates: { id: string; label: string }[]` prop shape, so `change-detail-client.tsx` and `assignees-dialog.tsx` need no edits.

- [ ] **Step 1: Replace the candidate query**

In `src/app/(dashboard)/changes/[id]/page.tsx`, add the import:

```ts
import { listEligibleApprovers } from "@/server/approval-authority"
```

Replace lines 105-110:

```ts
  const assigneeCandidates = Array.from(new Map(
    (await db.userOpCoAssignment.findMany({
      where: { opco: { slug }, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    })).map((a) => [a.user.id, { id: a.user.id, label: a.user.name ?? a.user.email }])
  ).values())
```

with:

```ts
  // Approver-eligible users for this change's scope — group CAB only for Equiano infra.
  // The requester is excluded: submitApproval rejects self-approval, so offering them
  // would be a dead end. Uses the same rule setChangeAssignees enforces, so the picker
  // can never offer someone the save will refuse.
  const assigneeCandidates = (
    await listEligibleApprovers(change.opcoId, change.infrastructureType, change.requesterId)
  ).map((u) => ({ id: u.id, label: u.name ?? u.email }))
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`

Expected: no errors. If `db` or `slug` becomes unused in this file, remove the now-orphaned reference — but only if this change is what orphaned it.

- [ ] **Step 3: Lint and full suite**

Run: `pnpm lint && pnpm test`

Expected: no errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/changes/[id]/page.tsx"
git commit -m "fix(changes): detail-page assignee picker uses the eligibility rule

The dialog listed every active user in the change's OpCo regardless of role,
so it offered people setChangeAssignees would reject, and omitted group CAB
members entirely on Equiano changes."
```

---

### Task 7: Approver picker on the request form

Converts the existing read-only "Approver routing" preview card into a live picker.

**Files:**
- Modify: `src/app/(dashboard)/requests/new/page.tsx` (replace the `groupCtos` / `approversByOpco` loading)
- Modify: `src/app/(dashboard)/requests/request-form.tsx:59-63` (props), `:123-125` (derived state), `:129-237` (`save`), `:310-336` (the routing card)
- Modify: `src/lib/i18n.ts` (EN block near line 455, FR block near line 1193)
- Create: `src/server/actions/eligible-approvers.ts`
- Test: `src/test/app/requests/approver-picker.test.tsx`

**Interfaces:**
- Consumes: `listEligibleApproversForScope` (Task 1), `createChange` with `approverIds` (Task 3), `setChangeApprovers` (Task 2).
- Produces: server action `listEligibleApproversAction(opcoSlug: string, infrastructureType: string): Promise<{ id: string; name: string | null; email: string }[]>`.

- [ ] **Step 1: Create the client-callable server action**

`listEligibleApproversForScope` lives in `approval-authority.ts`, which is not a `"use server"` module and must stay importable from server components. Create a thin `"use server"` wrapper so the client form can call it:

Create `src/server/actions/eligible-approvers.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isMemberOfOpCo } from "@/lib/permissions"
import { listEligibleApproversForScope } from "@/server/approval-authority"

/**
 * Approver candidates for a scope the caller is allowed to raise changes in.
 * Mirrors createChange's authz gate so the picker cannot enumerate other OpCos.
 */
export async function listEligibleApproversAction(opcoSlug: string, infrastructureType: string) {
  const session = await getAppSession()
  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.keycloakId },
    select: { id: true },
  })
  return listEligibleApproversForScope(opcoSlug, infrastructureType, me?.id)
}
```

- [ ] **Step 2: Add the i18n strings**

In `src/lib/i18n.ts`, add to the **EN** map next to the existing `requests.approverRouting` keys (~line 455):

```ts
    "requests.selectApprovers": "Approvers",
    "requests.selectApproversHint": "Choose at least one approver. Equiano changes are approved by the group CAB.",
    "requests.approversNone": "No eligible approvers are configured for this OpCo. Contact your OpCo administrator.",
    "requests.approversNoneGroup": "No group CAB members are configured. Contact your group administrator.",
    "requests.approversLoadFailed": "Could not load approvers.",
    "requests.approversRetry": "Retry",
    "requests.approversCleared": "Your selected approvers no longer apply to this infrastructure type and have been cleared.",
    "requests.toast.approverMissing": "Approver required",
    "requests.toast.approverMissingDesc": "Name at least one approver before submitting.",
```

Add to the **FR** map next to the matching keys (~line 1193):

```ts
    "requests.selectApprovers": "Approbateurs",
    "requests.selectApproversHint": "Choisissez au moins un approbateur. Les changements Equiano sont approuvés par le CAB groupe.",
    "requests.approversNone": "Aucun approbateur éligible n'est configuré pour cette OpCo. Contactez votre administrateur OpCo.",
    "requests.approversNoneGroup": "Aucun membre du CAB groupe n'est configuré. Contactez votre administrateur groupe.",
    "requests.approversLoadFailed": "Impossible de charger les approbateurs.",
    "requests.approversRetry": "Réessayer",
    "requests.approversCleared": "Vos approbateurs sélectionnés ne s'appliquent plus à ce type d'infrastructure et ont été effacés.",
    "requests.toast.approverMissing": "Approbateur requis",
    "requests.toast.approverMissingDesc": "Nommez au moins un approbateur avant de soumettre.",
```

- [ ] **Step 3: Simplify the page's data loading**

In `src/app/(dashboard)/requests/new/page.tsx`, delete the `groupCtos`, `opcoCab`, and `approversByOpco` blocks and their `opcoRecords` dependency if nothing else uses it, and stop passing those two props. The picker loads its own data client-side, because the list depends on the infra type the user has not chosen yet at render time. The file becomes:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isGroupLevel } from "@/lib/permissions"
import { OPCO_SLUGS } from "@/lib/opco"
import RequestForm from "../request-form"

export default async function NewRequestPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const opcoOptions = isGroupLevel(session.user.realmRoles)
    ? [...OPCO_SLUGS]
    : session.user.organizations.map((o) => o.alias)

  return <RequestForm opcoOptions={opcoOptions} defaultEmail={session.user.email ?? ""} />
}
```

- [ ] **Step 4: Write the failing picker tests**

Create `src/test/app/requests/approver-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { listEligibleApproversAction, createChange, submitChange, updateChange } = vi.hoisted(() => ({
  listEligibleApproversAction: vi.fn(),
  createChange: vi.fn().mockResolvedValue({ id: "cr-new" }),
  submitChange: vi.fn().mockResolvedValue({}),
  updateChange: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/server/actions/eligible-approvers", () => ({ listEligibleApproversAction }))
vi.mock("@/server/actions/changes", () => ({ createChange, submitChange, updateChange }))
vi.mock("@/server/actions/assignees", () => ({ setChangeApprovers: vi.fn().mockResolvedValue({}) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import RequestForm from "@/app/(dashboard)/requests/request-form"

const APPROVERS = [
  { id: "appr1", name: "Ada", email: "ada@csquared.com" },
  { id: "appr2", name: "Kofi", email: "kofi@csquared.com" },
]

function renderForm() {
  return render(<RequestForm opcoOptions={["ghana"]} defaultEmail="me@csquared.com" />)
}

beforeEach(() => {
  vi.clearAllMocks()
  listEligibleApproversAction.mockResolvedValue(APPROVERS)
})

describe("request form approver picker", () => {
  it("does not query until an infrastructure type is chosen", () => {
    renderForm()
    expect(listEligibleApproversAction).not.toHaveBeenCalled()
  })

  it("loads candidates for the chosen OpCo and infrastructure type", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("Infrastructure type"), { target: { value: "Wifi" } })
    await waitFor(() =>
      expect(listEligibleApproversAction).toHaveBeenCalledWith("ghana", "Wifi")
    )
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
  })

  it("re-queries and clears selection when the infrastructure type changes to Equiano", async () => {
    renderForm()
    const infra = screen.getByLabelText("Infrastructure type")

    fireEvent.change(infra, { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    listEligibleApproversAction.mockResolvedValue([
      { id: "cto", name: "Group CTO", email: "cto@csquared.com" },
    ])
    fireEvent.change(infra, { target: { value: "Equiano IP" } })

    await waitFor(() =>
      expect(listEligibleApproversAction).toHaveBeenCalledWith("ghana", "Equiano IP")
    )
    await waitFor(() => expect(screen.getByText("cto@csquared.com")).toBeInTheDocument())
    expect(screen.queryByText("ada@csquared.com")).not.toBeInTheDocument()
    expect(screen.getByText(/no longer apply to this infrastructure type/i)).toBeInTheDocument()
  })

  it("shows the OpCo empty state when no approvers are configured", async () => {
    listEligibleApproversAction.mockResolvedValue([])
    renderForm()
    fireEvent.change(screen.getByLabelText("Infrastructure type"), { target: { value: "Wifi" } })
    await waitFor(() =>
      expect(screen.getByText(/no eligible approvers are configured for this opco/i)).toBeInTheDocument()
    )
  })

  it("shows the group empty state for Equiano infra", async () => {
    listEligibleApproversAction.mockResolvedValue([])
    renderForm()
    fireEvent.change(screen.getByLabelText("Infrastructure type"), { target: { value: "Equiano IP" } })
    await waitFor(() =>
      expect(screen.getByText(/no group cab members are configured/i)).toBeInTheDocument()
    )
  })

  it("shows an error with retry when the load fails, and retry re-queries", async () => {
    listEligibleApproversAction.mockRejectedValueOnce(new Error("boom"))
    renderForm()
    fireEvent.change(screen.getByLabelText("Infrastructure type"), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText(/could not load approvers/i)).toBeInTheDocument())

    listEligibleApproversAction.mockResolvedValue(APPROVERS)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
  })

  it("passes selected approverIds to createChange", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("Infrastructure type"), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    fireEvent.change(screen.getByLabelText("Change title"), { target: { value: "T" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "D" } })
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() =>
      expect(createChange).toHaveBeenCalledWith(
        "ghana",
        expect.objectContaining({ approverIds: ["appr1"] })
      )
    )
  })
})
```

Field labels in these tests must match the form's actual rendered labels. Before writing assertions, run `pnpm vitest run src/test/app/requests/approver-picker.test.tsx` once and read the printed DOM to confirm each `getByLabelText` target — adjust the query strings to match rather than renaming the form's existing labels.

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run src/test/app/requests/approver-picker.test.tsx`

Expected: FAIL — no approver picker is rendered.

- [ ] **Step 6: Implement the picker in the form**

In `src/app/(dashboard)/requests/request-form.tsx`:

Replace the `groupCtos` / `approversByOpco` props (lines 59-63) with nothing — remove both from the `Props` type and from the destructured parameter list. Remove the now-unused `Approver` type if nothing else references it.

Add near the other `useState` declarations:

```tsx
  const [approverIds, setApproverIds] = useState<string[]>([])
  const [eligible, setEligible] = useState<{ id: string; name: string | null; email: string }[]>([])
  const [approverLoad, setApproverLoad] = useState<"idle" | "loading" | "error" | "ready">("idle")
  const [approversCleared, setApproversCleared] = useState(false)
  const [approverReload, setApproverReload] = useState(0)
```

Replace the derived `groupCtoNames` / `residentNames` lines (123-125) with the loader:

```tsx
  // Candidates depend on OpCo + infra type, so they load client-side once both are known.
  // Changing infra type re-queries and drops any selection that no longer applies.
  useEffect(() => {
    if (!infrastructureType || !opcoSlug) {
      setEligible([])
      setApproverLoad("idle")
      return
    }
    let cancelled = false
    setApproverLoad("loading")
    listEligibleApproversAction(opcoSlug, infrastructureType)
      .then((rows) => {
        if (cancelled) return
        setEligible(rows)
        setApproverLoad("ready")
        setApproverIds((prev) => {
          const allowed = new Set(rows.map((r) => r.id))
          const kept = prev.filter((id) => allowed.has(id))
          setApproversCleared(kept.length < prev.length)
          return kept
        })
      })
      .catch(() => {
        if (cancelled) return
        setEligible([])
        setApproverLoad("error")
      })
    return () => { cancelled = true }
  }, [opcoSlug, infrastructureType, approverReload])
```

Add the imports — merge `useEffect` into the file's existing `from "react"` import rather than adding a second one:

```tsx
import { useState, useEffect } from "react"
import { listEligibleApproversAction } from "@/server/actions/eligible-approvers"
import { setChangeApprovers } from "@/server/actions/assignees"
```

Replace the read-only routing card (lines 310-336) with the picker:

```tsx
        {infrastructureType && (
          <Card className="border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/40">
            <CardHeader>
              <CardTitle className="text-base">
                {t(language, "requests.selectApprovers")} <span className="text-rose-600">*</span>
              </CardTitle>
              <CardDescription>{t(language, "requests.selectApproversHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {approverLoad === "loading" && <p className="text-muted-foreground">…</p>}

              {approverLoad === "error" && (
                <div className="space-y-2">
                  <p className="text-rose-600">{t(language, "requests.approversLoadFailed")}</p>
                  <Button variant="outline" onClick={() => setApproverReload((n) => n + 1)}>
                    {t(language, "requests.approversRetry")}
                  </Button>
                </div>
              )}

              {approverLoad === "ready" && eligible.length === 0 && (
                <p className="text-rose-600">
                  {isGroupLevelInfra(infrastructureType)
                    ? t(language, "requests.approversNoneGroup")
                    : t(language, "requests.approversNone")}
                </p>
              )}

              {approverLoad === "ready" && eligible.length > 0 && (
                <>
                  {approversCleared && (
                    <p className="text-amber-700 dark:text-amber-400">
                      {t(language, "requests.approversCleared")}
                    </p>
                  )}
                  {eligible.map((a) => (
                    <label key={a.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={a.email}
                        checked={approverIds.includes(a.id)}
                        onChange={(e) =>
                          setApproverIds((prev) =>
                            e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                          )
                        }
                      />
                      <span>{a.name ?? a.email}</span>
                      <span className="text-muted-foreground">{a.email}</span>
                    </label>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}
```

In `save()`, add the client-side guard next to the existing document check (inside `if (submit)`, after the `missingDocs` block):

```tsx
      if (approverIds.length === 0) {
        toast({
          title: t(language, "requests.toast.approverMissing"),
          description: t(language, "requests.toast.approverMissingDesc"),
          variant: "error",
        })
        return
      }
```

Add `approverIds` to the `payload` object:

```tsx
      approverIds,
```

And in the persist branch, keep approvers in sync on the update path — `updateChange` does not accept `approverIds`, and a full `setChangeAssignees` would delete implementers:

```tsx
      let id = persistedId
      if (id) {
        await updateChange(id, payload)
        await setChangeApprovers(id, approverIds)
      } else {
        const created = await createChange(opcoSlug, payload)
        id = created.id
        setPersistedId(id)
      }
```

Finally, disable Submit while no approver is selected. Find the submit `Button` in the footer and extend its existing `disabled` expression with `|| approverIds.length === 0`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/test/app/requests/approver-picker.test.tsx`

Expected: PASS — 7 tests.

- [ ] **Step 8: Check for orphaned code**

Run: `grep -rn "groupCtos\|approversByOpco\|requests.residentApprovers\|requests.secondee\|requests.groupCto\|requests.approverRouting" src`

Expected: no remaining references in `.tsx` files. Remove the now-unused i18n keys (`requests.approverRouting`, `requests.approverRoutingHint`, `requests.residentApprovers`, `requests.secondee`, `requests.groupCto`, `requests.noApprover`) from **both** the EN and FR maps — these were orphaned by this task's change, so removing them is in scope.

Also confirm the edit-mode caller still type-checks: `grep -rn "<RequestForm" src` and update any call site that still passes the deleted props.

- [ ] **Step 9: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`

Expected: no errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/app/\(dashboard\)/requests src/lib/i18n.ts src/server/actions/eligible-approvers.ts src/test/app/requests/approver-picker.test.tsx
git commit -m "feat(requests): requester picks approvers on the request form

Replaces the read-only approver-routing preview with a live picker scoped to
the change's OpCo, or the group CAB for Equiano infra. Re-queries when the
infrastructure type changes and clears selections that no longer apply.
Submit is disabled until an approver is chosen; submitChange remains the
authoritative gate."
```

---

### Task 8: End-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full suite, types, lint, build**

```bash
pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build
```

Expected: all tests pass, no type or lint errors, build succeeds.

- [ ] **Step 2: Start the local stack**

Follow `reference_local_dev_stack`: bring up docker-compose Postgres (`:5433`) + Keycloak, run `pnpm prisma migrate deploy` and the seed with `DATABASE_URL` passed inline, then `pnpm dev`. Sign in as `devops@csquared.com` / `Admin2025$`.

- [ ] **Step 3: Browser smoke — non-Equiano path**

Using the Playwright MCP against the running app:

1. Go to `/requests/new`, pick OpCo **Ghana**, infra type **Wifi**.
2. Confirm the Approvers card lists OpCo CAB members and OpCo `approver`/`admin` role holders, and that the signed-in requester is **not** listed.
3. Confirm Submit is disabled with nothing selected.
4. Select one approver, fill the required fields, submit.
5. Confirm the change reaches `pending` and lands on `/changes/<id>` with the approver shown.

- [ ] **Step 4: Browser smoke — Equiano path**

1. Start a new request, choose infra type **Wifi**, select an OpCo approver.
2. Switch infra type to **Equiano IP**.
3. Confirm the list swaps to group CAB members only, the previous selection is cleared, and the "no longer apply" notice appears.

- [ ] **Step 5: Browser smoke — mandatory gate**

1. Save a draft with no approver — confirm it saves.
2. Attempt to submit it — confirm the "Approver required" toast and that the change stays `draft`.

- [ ] **Step 6: Verify the audit trail**

On the change-detail page, confirm an `approvers_set` or `created` audit row is present, and that the CAB approvers still appear in the approvals queue for a routed approver (additive behaviour intact).

- [ ] **Step 7: Merge**

```bash
git checkout dev
git merge --no-ff feat/approver-selection-notifications
pnpm test
git push origin dev
```

Expected: tests green before push.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| Problem 1 — picker on the wrong page | 7 |
| Problem 2 — candidate list ignores the rule | 6, 7 |
| Problem 3 — Equiano exception unreachable in UI | 1, 7 |
| Problem 4 — Equiano routing leak in `isEligibleApprover` | 1, 2 |
| Problem 5 — duplicated eligibility rule | 1, 2, 6 |
| Decision — additive, not replacing | 4 (gate only; `getRoutedApprovers` untouched), 5 (quorum tests) |
| Decision — named approvers count toward quorum | 5 |
| Decision — Equiano group-only | 1 |
| Decision — one eligibility implementation | 1, 2, 6 |
| Decision — mandatory at submit | 4 (server), 2 (last-approver guard), 7 (form) |
| Eligibility rule (incl. requester exclusion, no delegates) | 1 |
| `createChange` transactional `approverIds` | 3 |
| Picker re-queries on infra change, clears stale picks | 7 |
| Blocking empty-state naming the scope | 7 |
| Duplicate-vote guard, no DB constraint | 5 |
| Error handling — failed picker load keeps Submit disabled | 7 |
| i18n EN + FR | 7 |

Every spec requirement maps to at least one task.

**Type consistency:** `listEligibleApprovers(opcoId, infrastructureType, excludeUserId?)` takes an OpCo **id**; `listEligibleApproversForScope(opcoSlug, …)` takes a **slug** and is the only variant the client action uses. `isEligibleApprover(userId, opcoId, infrastructureType)` takes an id and an infra type — note this differs from the deleted private helper's `(db, userId, opcoId, cabOpcoId)` signature, which is why Task 2 rewrites every call site. `setChangeApprovers(changeId, approverIds)` takes bare ids; `setChangeAssignees(changeId, assignees)` keeps its `{ userId, role }[]` shape. `ApproverUser` is `{ id, name: string | null, email }` throughout.

**Known follow-on:** Task 4 breaks pre-existing `submitChange` happy-path tests that do not mock `assignees`. This is called out inline in Task 4 Steps 4-5 rather than left as a surprise.
