# CAB-based Approval Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CAB membership the single source of approval authority, routed by infrastructure type (Equiano → group CAB; everything else → the change's OpCo CAB), with delegations as temporary stand-in authority — replacing the demo-era `User.isGroupCto` flag.

**Architecture:** A new server module `src/server/approval-authority.ts` centralizes "who approves this change" (routed-CAB members + active delegates) and the can-approve predicate. `submitApproval`, `submitChange` (notifications), `getChange`, the approvals queue, and the change-detail page all call it. The `isGroupCto` column and its four ad-hoc checks are removed. `ApproverDelegation.opcoId` becomes nullable to allow group-level delegation.

**Tech Stack:** Next.js App Router, Prisma v7 (`@prisma/adapter-pg`), Postgres, Vitest, existing CAB model (`CABMembership` with nullable `opcoId` = group CAB), `ApproverDelegation`, `@/lib/permissions`.

**Spec:** `docs/superpowers/specs/2026-06-05-approval-routing-cab-design.md`

**Branch:** `feat/approval-routing-by-infra` (already checked out; currently holds the demo-era work to be reworked).

**Local DB note:** `prisma migrate dev` needs a TTY; in this environment create the migration SQL by hand and apply with `migrate deploy` (as the repo's prior migrations were). Use the dev URL inline: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms"`.

---

## File Structure

**Create:**
- `src/server/approval-authority.ts` — routed-CAB resolution, can-approve predicate, approvable-changes query.
- `src/test/server/approval-authority.test.ts` — unit tests (db mocked).
- `prisma/migrations/20260605120000_cab_authority_model/migration.sql` — drop `isGroupCto`, make delegation `opcoId` nullable.

**Modify:**
- `prisma/schema.prisma` — remove `User.isGroupCto`; `ApproverDelegation.opcoId` → nullable.
- `src/lib/approver-routing.ts` — add pure `routedCabOpcoId`.
- `src/server/actions/changes.ts` — `submitChange` notifies routed CAB; remove `resolveApproverUsers` and the `isGroupCto` read-access branch in `getChange`.
- `src/server/actions/approvals.ts` — CAB-based authority + quorum; record `isCab: true`; drop `isGroupCto`.
- `src/server/actions/cab.ts` — `addCabMember` accepts `admin` as well as `approver`.
- `src/app/(dashboard)/approvals/page.tsx` — queue via `listApprovableChanges`; drop `isGroupCto`.
- `src/app/(dashboard)/changes/[id]/page.tsx` — `caps.canApprove` via authority module; drop `isGroupCto`.
- `src/app/(dashboard)/requests/page.tsx` — approver-preview data from CAB membership.
- `src/app/(dashboard)/approval-matrix/page.tsx` — approvers-per-OpCo from CAB membership.
- `prisma/seed.ts` — remove `isGroupCto`; seat Samuel (group CAB + all OpCo CABs) and resident CTOs (OpCo admin + OpCo CAB); one sample delegation.
- `src/server/email.ts` + `.env.example` — formalize/ document the existing transport.
- `src/test/actions/changes.test.ts`, `src/test/actions/approvals.test.ts` — update to the new model.
- `.gitignore` — ignore `.codex/`.

**Delete:** `fix-email.ts`, `update-keycloak-id.ts` (throwaway scripts; `fix-email.ts` breaks `pnpm tsc`).

---

## Task 1: Schema — drop isGroupCto, nullable delegation opcoId

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260605120000_cab_authority_model/migration.sql`

- [ ] **Step 1: Edit the schema**

In `model User`, delete the line:
```prisma
  isGroupCto   Boolean  @default(false)
```

In `model ApproverDelegation`, make `opcoId` optional and add the relation/back-reference is not needed (it has no `opco` relation field currently). Change:
```prisma
  opcoId     String
```
to:
```prisma
  opcoId     String?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260605120000_cab_authority_model/migration.sql`:
```sql
-- Drop the demo-era Group CTO flag (authority now comes from CAB membership)
ALTER TABLE "User" DROP COLUMN "isGroupCto";

-- Allow group-level delegations (opcoId NULL = group CAB)
ALTER TABLE "ApproverDelegation" ALTER COLUMN "opcoId" DROP NOT NULL;
```

- [ ] **Step 3: Apply + regenerate**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" pnpm prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" pnpm prisma generate
```
Expected: "All migrations have been successfully applied." and a regenerated client.

> If `migrate deploy` reports drift because the DB still has the demo `isGroupCto` data, that's fine — the column drop resolves it. Do NOT reset the database.

- [ ] **Step 4: Type-check (expect errors that later tasks fix)**

Run: `pnpm tsc --noEmit`
Expected: errors only where code still references `isGroupCto` (changes.ts, approvals.ts, the pages, seed). These are addressed in later tasks. Confirm there are no *other* schema errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): drop isGroupCto; allow group-level delegation (nullable opcoId)"
```

---

## Task 2: Routing helper — routedCabOpcoId (pure, TDD)

**Files:**
- Modify: `src/lib/approver-routing.ts`
- Test: `src/test/lib/approver-routing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/lib/approver-routing.test.ts
import { describe, it, expect } from "vitest"
import { isGroupLevelInfra, routedCabOpcoId } from "@/lib/approver-routing"

describe("isGroupLevelInfra", () => {
  it("is true for Equiano infra only", () => {
    expect(isGroupLevelInfra("Equiano Optics")).toBe(true)
    expect(isGroupLevelInfra("Equiano IP")).toBe(true)
    expect(isGroupLevelInfra("Backbone IP Network")).toBe(false)
  })
})

describe("routedCabOpcoId", () => {
  it("routes Equiano to the group CAB (null)", () => {
    expect(routedCabOpcoId("Equiano Optics", "opco-1")).toBeNull()
  })
  it("routes other infra to the change's OpCo CAB", () => {
    expect(routedCabOpcoId("Wifi", "opco-1")).toBe("opco-1")
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`routedCabOpcoId` not exported)

Run: `pnpm test src/test/lib/approver-routing.test.ts`

- [ ] **Step 3: Implement**

Append to `src/lib/approver-routing.ts`:
```typescript
/**
 * The CAB a change routes to: the group CAB (null) for Equiano (group-level) infra,
 * otherwise the change's own OpCo CAB.
 */
export function routedCabOpcoId(infraType: string, changeOpcoId: string): string | null {
  return isGroupLevelInfra(infraType) ? null : changeOpcoId
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/test/lib/approver-routing.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/approver-routing.ts src/test/lib/approver-routing.test.ts
git commit -m "feat(routing): add routedCabOpcoId (group CAB for Equiano, else OpCo CAB)"
```

---

## Task 3: Approval-authority module (TDD)

**Files:**
- Create: `src/server/approval-authority.ts`
- Test: `src/test/server/approval-authority.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/approval-authority.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  cABMembership: { findMany: vi.fn() },
  approverDelegation: { findMany: vi.fn() },
  changeRequest: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { getRoutedApprovers, canUserApproveChange, listApprovableChanges } from "@/server/approval-authority"

const equianoChange = { infrastructureType: "Equiano Optics", opcoId: "opco-1" }
const wifiChange = { infrastructureType: "Wifi", opcoId: "opco-1" }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.approverDelegation.findMany.mockResolvedValue([])
})

describe("getRoutedApprovers", () => {
  it("Equiano → queries the group CAB (opcoId null)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { userId: "samuel", user: { id: "samuel", name: "Samuel", email: "s@c.com" } },
    ])
    const out = await getRoutedApprovers(equianoChange)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
    expect(out.map((u) => u.id)).toEqual(["samuel"])
  })

  it("other infra → queries the change's OpCo CAB and includes active delegates", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { userId: "cto", user: { id: "cto", name: "CTO", email: "cto@c.com" } },
    ])
    mockDb.approverDelegation.findMany.mockResolvedValue([
      { toUser: { id: "deputy", name: "Deputy", email: "d@c.com" } },
    ])
    const out = await getRoutedApprovers(wifiChange)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", isActive: true }) })
    )
    expect(out.map((u) => u.id).sort()).toEqual(["cto", "deputy"])
  })
})

describe("canUserApproveChange", () => {
  it("group_admin can always approve", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
    expect(await canUserApproveChange({ userId: "x", realmRoles: ["group_admin"], change: wifiChange })).toBe(true)
  })
  it("a routed CAB member can approve", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }])
    expect(await canUserApproveChange({ userId: "cto", realmRoles: [], change: wifiChange })).toBe(true)
  })
  it("a non-member non-admin cannot", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }])
    expect(await canUserApproveChange({ userId: "stranger", realmRoles: [], change: wifiChange })).toBe(false)
  })
})

describe("listApprovableChanges", () => {
  it("group_admin sees all pending", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([{ id: "c1", infrastructureType: "Wifi", opcoId: "opco-1" }])
    const out = await listApprovableChanges({ userId: "x", realmRoles: ["group_admin"] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
  it("a CAB member sees only changes routed to their CAB", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: "c1", infrastructureType: "Wifi", opcoId: "opco-1" },
      { id: "c2", infrastructureType: "Wifi", opcoId: "opco-2" },
    ])
    // member of opco-1 CAB only
    mockDb.cABMembership.findMany.mockImplementation(({ where }: { where: { opcoId: string | null } }) =>
      Promise.resolve(where.opcoId === "opco-1" ? [{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }] : [])
    )
    const out = await listApprovableChanges({ userId: "cto", realmRoles: [] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `pnpm test src/test/server/approval-authority.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/server/approval-authority.ts
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import { routedCabOpcoId } from "@/lib/approver-routing"

type ChangeForAuth = { infrastructureType: string; opcoId: string }
type ApproverUser = { id: string; name: string | null; email: string }

/**
 * Users authorized to approve a change: active members of the routed CAB
 * (group CAB for Equiano, the change's OpCo CAB otherwise) plus anyone holding
 * an active delegation from one of those members. Deduplicated by id.
 */
export async function getRoutedApprovers(change: ChangeForAuth): Promise<ApproverUser[]> {
  const db = getPrisma()
  const cabOpcoId = routedCabOpcoId(change.infrastructureType, change.opcoId)

  const members = await db.cABMembership.findMany({
    where: { opcoId: cabOpcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  const memberIds = members.map((m) => m.userId)

  const now = new Date()
  const delegations = memberIds.length === 0 ? [] : await db.approverDelegation.findMany({
    where: {
      opcoId: cabOpcoId, isActive: true,
      fromUserId: { in: memberIds },
      validFrom: { lte: now }, validUntil: { gte: now },
    },
    include: { toUser: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of [...members.map((m) => m.user), ...delegations.map((d) => d.toUser)]) {
    if (!seen.has(u.id)) { seen.add(u.id); out.push(u) }
  }
  return out
}

export async function canUserApproveChange(args: {
  userId: string
  realmRoles: string[]
  change: ChangeForAuth
}): Promise<boolean> {
  if (isGroupAdmin(args.realmRoles)) return true
  const approvers = await getRoutedApprovers(args.change)
  return approvers.some((u) => u.id === args.userId)
}

/** Pending changes the user is authorized to approve (group_admin sees all). */
export async function listApprovableChanges(args: { userId: string; realmRoles: string[] }) {
  const db = getPrisma()
  const pending = await db.changeRequest.findMany({
    where: { status: "pending" },
    include: { requester: true, opco: true, approvals: true },
    orderBy: { createdAt: "asc" },
  })
  if (isGroupAdmin(args.realmRoles)) return pending

  const visible = []
  for (const c of pending) {
    if (await canUserApproveChange({ userId: args.userId, realmRoles: args.realmRoles, change: c })) {
      visible.push(c)
    }
  }
  return visible
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/test/server/approval-authority.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/server/approval-authority.ts src/test/server/approval-authority.test.ts
git commit -m "feat(approvals): CAB-membership authority module (routing + delegates + visibility)"
```

---

## Task 4: submitChange notifies the routed CAB

**Files:**
- Modify: `src/server/actions/changes.ts`
- Modify: `src/test/actions/changes.test.ts`

- [ ] **Step 1: Replace the notification block + remove resolveApproverUsers**

In `submitChange`, replace the recipients block:
```typescript
  // Notify approvers resolved by infrastructure type (Equiano → Group CTO only;
  // others → resident OpCo approver(s) + Group CTO as secondee).
  const recipients = await resolveApproverUsers(change.opcoId, change.infrastructureType)
```
with:
```typescript
  // Notify the routed CAB's members (group CAB for Equiano, OpCo CAB otherwise) + active delegates.
  const recipients = await getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId })
```

Delete the entire `export async function resolveApproverUsers(...) { ... }` definition.

Update imports at the top of `changes.ts`: remove `isGroupLevelInfra` import if it's now unused after the `getChange` edit in Task 6 (leave it for now if still referenced); add:
```typescript
import { getRoutedApprovers, canUserApproveChange } from "@/server/approval-authority"
```

- [ ] **Step 2: Update the notification test**

In `src/test/actions/changes.test.ts`: add `cABMembership` and `approverDelegation` to `mockDb` (near `userOpCoAssignment`):
```typescript
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  approverDelegation: { findMany: vi.fn().mockResolvedValue([]) },
```
And in the `beforeEach` reset block, add:
```typescript
  mockDb.cABMembership.findMany.mockReset()
  mockDb.cABMembership.findMany.mockResolvedValue([])
  mockDb.approverDelegation.findMany.mockReset()
  mockDb.approverDelegation.findMany.mockResolvedValue([])
```

Replace the existing "calls sendApprovalRequestEmail for each approver" test body with a CAB-based one:
```typescript
  it('emails each routed CAB member on submit', async () => {
    mockDb.cABMembership.findMany.mockResolvedValueOnce([
      { userId: 'cto', user: { id: 'cto', email: 'cto@csquared.com', name: 'Resident CTO' } },
      { userId: 'samuel', user: { id: 'samuel', email: 'samuel@csquared.com', name: 'Samuel' } },
    ])
    await submitChange('cr-1')
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'cto@csquared.com' })
    )
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'samuel@csquared.com' })
    )
  })
```
Remove the old assertion that referenced `userOpCoAssignment.findMany` for notifications (the `expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith(...)` block in that test).

- [ ] **Step 3: Run — expect PASS**

Run: `pnpm test src/test/actions/changes.test.ts`
Expected: PASS (happy-path submit uses the default empty CAB mock; the new test asserts CAB notifications).

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: `changes.ts` no longer errors on `resolveApproverUsers`; remaining errors are in approvals.ts/pages (later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(changes): notify routed CAB on submit; remove resolveApproverUsers"
```

---

## Task 5: submitApproval — CAB authority + quorum

**Files:**
- Modify: `src/server/actions/approvals.ts`
- Modify: `src/test/actions/approvals.test.ts`

- [ ] **Step 1: Rewrite the authority + quorum logic**

In `src/server/actions/approvals.ts`, replace the imports line:
```typescript
import { isGroupAdmin, canApprove } from "@/lib/permissions"
import { checkCabQuorum } from "@/lib/cab-quorum"
import { sendStatusChangeEmail } from "@/server/email"
import { isGroupLevelInfra } from "@/lib/approver-routing"
```
with:
```typescript
import { checkCabQuorum } from "@/lib/cab-quorum"
import { sendStatusChangeEmail } from "@/server/email"
import { isGroupLevelInfra } from "@/lib/approver-routing"
import { canUserApproveChange } from "@/server/approval-authority"
```

Replace the authorization block:
```typescript
  const isGroupCto = user.isGroupCto === true
  const isAllowedApprover = isGroupLevelInfra(change.infrastructureType)
    ? isGroupAdmin(session.realmRoles) || isGroupCto
    : isGroupAdmin(session.realmRoles) || isGroupCto || canApprove(session.organizations, change.opco.slug)

  if (!isAllowedApprover) {
    throw new Error("Forbidden: not authorized to approve in this OpCo")
  }
```
with:
```typescript
  const allowed = await canUserApproveChange({
    userId: user.id,
    realmRoles: session.realmRoles,
    change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
  })
  if (!allowed) {
    throw new Error("Forbidden: not authorized to approve this change")
  }
```

Change the approval record to always mark CAB authority (this path is now CAB-only):
```typescript
  const approval = await db.approval.create({
    data: { changeId, approverId: user.id, decision, comment, isCab: true },
  })

  const allApprovals = [...change.approvals, { isCab: true, decision, approverId: user.id }]
  const needsCab =
    !isGroupLevelInfra(change.infrastructureType) &&
    (change.riskLevel === "high" || change.riskLevel === "emergency")
  const quorumMet = needsCab ? checkCabQuorum(allApprovals) : decision === "approve"
```

(The `isCab` function parameter is now ignored; leave the signature unchanged for the client call site.)

- [ ] **Step 2: Update the approvals test**

Open `src/test/actions/approvals.test.ts`. It currently exercises the `isGroupCto`/`canApprove` paths. Replace the `@/server/approval-authority` usage by mocking it, and cover the new behavior. Add near the top mocks:
```typescript
vi.mock("@/server/approval-authority", () => ({
  canUserApproveChange: vi.fn().mockResolvedValue(true),
}))
```
Add the import:
```typescript
import { canUserApproveChange } from "@/server/approval-authority"
```
Ensure the `mockDb.user.findUnique` no longer needs `isGroupCto`. Add/replace tests:
```typescript
  it("forbids when the authority predicate denies", async () => {
    vi.mocked(canUserApproveChange).mockResolvedValueOnce(false)
    await expect(submitApproval("cr-1", "approve", undefined, false)).rejects.toThrow(/Forbidden/)
  })

  it("single approval advances a low-risk change", async () => {
    vi.mocked(canUserApproveChange).mockResolvedValue(true)
    // change mock: status pending, riskLevel low, infra Wifi, a different requester
    await submitApproval("cr-1", "approve", undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "approved" } })
    )
  })

  it("Equiano is single-approval even at high risk", async () => {
    // change mock: riskLevel high, infrastructureType 'Equiano Optics'
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: "cr-1", status: "pending", opcoId: "opco-1", requesterId: "req",
      opco: { slug: "ghana" }, infrastructureType: "Equiano Optics",
      riskLevel: "high", title: "x", approvals: [],
    })
    await submitApproval("cr-1", "approve", undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "approved" } })
    )
  })

  it("non-Equiano high risk needs 2 CAB approvals (quorum)", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: "cr-1", status: "pending", opcoId: "opco-1", requesterId: "req",
      opco: { slug: "ghana" }, infrastructureType: "Backbone IP Network",
      riskLevel: "high", title: "x",
      approvals: [], // first vote → no quorum yet
    })
    await submitApproval("cr-1", "approve", undefined, false)
    // only one CAB approve → not advanced to approved
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "approved" } })
    )
  })
```
Adjust the shared `change` mock used by the happy-path tests so it has `infrastructureType` and `riskLevel` fields (e.g. default `infrastructureType: "Wifi"`, `riskLevel: "low"`, `requesterId` different from the approving user, `approvals: []`). Keep the existing SoD test (requester cannot approve own) — it must run *before* the authority predicate or be independent; verify it still passes (the requester check is after `canUserApproveChange`, so set `canUserApproveChange` → true and `requesterId === user.id`).

- [ ] **Step 3: Run — expect PASS**

Run: `pnpm test src/test/actions/approvals.test.ts`

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: approvals.ts clean; remaining errors only in the pages (Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/approvals.ts src/test/actions/approvals.test.ts
git commit -m "feat(approvals): CAB-membership authority + Equiano single / risk-based quorum"
```

---

## Task 6: Visibility + read access (remove remaining isGroupCto)

**Files:**
- Modify: `src/app/(dashboard)/approvals/page.tsx`
- Modify: `src/server/actions/changes.ts` (`getChange`)
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx`

- [ ] **Step 1: Approvals queue via listApprovableChanges**

Replace the body of `src/app/(dashboard)/approvals/page.tsx` from the `currentUser`/`seeAll`/`where`/`changes` section with:
```typescript
  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.user.keycloakId }, select: { id: true } })
  if (!me) redirect("/login")

  const changes = await listApprovableChanges({ userId: me.id, realmRoles: session.user.realmRoles })

  const serializable = changes.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    riskLevel: c.riskLevel,
    createdAt: c.createdAt,
    requester: { name: c.requester.name, email: c.requester.email },
    opco: { name: c.opco.name, slug: c.opco.slug },
    approvals: c.approvals.map((a) => ({ isCab: a.isCab, decision: a.decision, approverId: a.approverId })),
  }))

  return <ApprovalsClient changes={serializable} isCabMember={true} />
```
Update imports: remove `isGroupAdmin, isGroupLevel` if now unused; add `import { listApprovableChanges } from "@/server/approval-authority"`. Remove the "Approver Access Required" card branch (an empty queue is the natural empty state). Keep `getPrisma` import.

- [ ] **Step 2: getChange read access**

In `src/server/actions/changes.ts` `getChange`, replace the `isGroupCto` branch:
```typescript
  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    const user = await db.user.findUnique({
      where: { keycloakId: session.keycloakId },
      select: { isGroupCto: true },
    })
    if (!user?.isGroupCto) return null
  }
```
with:
```typescript
  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    const user = await db.user.findUnique({
      where: { keycloakId: session.keycloakId },
      select: { id: true },
    })
    const canApprove = user
      ? await canUserApproveChange({
          userId: user.id, realmRoles: session.realmRoles,
          change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
        })
      : false
    if (!canApprove) return null
  }
```
(`canUserApproveChange` is imported in Task 4.)

- [ ] **Step 3: change-detail caps**

In `src/app/(dashboard)/changes/[id]/page.tsx`, replace the `currentUser` (`isGroupCto`) lookup and `caps.canApprove` line:
```typescript
  const currentUser = await db.user.findUnique({
    where: { keycloakId: me.keycloakId },
    select: { isGroupCto: true },
  })
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApprove(me.organizations, slug) || isGroupAdmin(me.realmRoles) || currentUser?.isGroupCto === true,
    ...
```
with:
```typescript
  const meUser = await db.user.findUnique({ where: { keycloakId: me.keycloakId }, select: { id: true } })
  const canApproveThis = meUser
    ? await canUserApproveChange({
        userId: meUser.id, realmRoles: me.realmRoles,
        change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
      })
    : false
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApproveThis,
    ...
```
Add `import { canUserApproveChange } from "@/server/approval-authority"`. Remove the now-unused `canApprove` permission import if nothing else uses it in the file (keep `isGroupAdmin`/`hasRoleInOpCo` if still used by `isAdmin`/`isCabMember`).

- [ ] **Step 4: Type-check + run affected tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/actions/changes.test.ts`
Expected: PASS; no remaining `isGroupCto` references (`grep -rn isGroupCto src` returns nothing).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/approvals/page.tsx" "src/app/(dashboard)/changes/[id]/page.tsx" src/server/actions/changes.ts
git commit -m "feat(approvals): CAB-scoped queue + read/approve caps; drop final isGroupCto checks"
```

---

## Task 7: Approver-preview + approval-matrix from CAB membership

**Files:**
- Modify: `src/app/(dashboard)/requests/page.tsx`
- Modify: `src/app/(dashboard)/approval-matrix/page.tsx`

- [ ] **Step 1: Requests page — feed the preview from CAB membership**

In `src/app/(dashboard)/requests/page.tsx`, replace the `groupCtos` + `assignments`/`approversByOpco` block with CAB-derived data:
```typescript
  const opcoRecords = await db.opCo.findMany({
    where: { slug: { in: opcoOptions } },
    select: { id: true, slug: true },
  })
  const groupCtos = (await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    include: { user: { select: { name: true, email: true } } },
  })).map((m) => m.user)

  const opcoCab = await db.cABMembership.findMany({
    where: { opcoId: { in: opcoRecords.map((o) => o.id) }, isActive: true },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversByOpco: Record<string, { name: string | null; email: string }[]> = {}
  for (const o of opcoRecords) approversByOpco[o.slug] = []
  for (const m of opcoCab) {
    if (m.opco) approversByOpco[m.opco.slug]?.push({ name: m.user.name, email: m.user.email })
  }
```
The `<RequestForm ... groupCtos={groupCtos} approversByOpco={approversByOpco} />` props stay the same; only the data source changed. (The form's preview logic — group CAB names for Equiano, OpCo CAB + secondee otherwise — is unchanged and still correct.)

- [ ] **Step 2: Approval-matrix — approvers per OpCo from CAB**

In `src/app/(dashboard)/approval-matrix/page.tsx`, replace the `opcos`/`approversBySlug` query (currently reads OpCo `users` with role approver) with CAB membership, and the `groupCtos` query to read the group CAB:
```typescript
  const groupCtos = (await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    include: { user: { select: { name: true, email: true } } },
  })).map((m) => m.user)
  const groupCtoNames = groupCtos.map((c) => c.name ?? c.email)
  const groupCtoLabel = groupCtoNames.length > 0 ? groupCtoNames.join(", ") : "—"

  const opcoCab = await db.cABMembership.findMany({
    where: { opcoId: { not: null }, isActive: true },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversBySlug: Record<string, string[]> = {}
  for (const m of opcoCab) {
    if (!m.opco) continue
    ;(approversBySlug[m.opco.slug] ??= []).push(m.user.name ?? m.user.email)
  }
```
Leave the JSX (routing table + per-OpCo cards) as is.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/requests/page.tsx" "src/app/(dashboard)/approval-matrix/page.tsx"
git commit -m "feat(approvals): source approver preview + matrix from CAB membership"
```

---

## Task 8: addCabMember accepts admins

**Files:**
- Modify: `src/server/actions/cab.ts`
- Test: `src/test/actions/cab.test.ts` (create if absent; otherwise extend)

- [ ] **Step 1: Relax the eligibility checks**

In `src/server/actions/cab.ts`, both eligibility queries currently require `role: "approver"`. Change both to accept admins too.

Group CAB block:
```typescript
    const eligible = await db.userOpCoAssignment.findFirst({
      where: { userId, role: { in: ["approver", "admin"] }, isActive: true },
    })
    if (!eligible) throw new Error("Forbidden: user must be an approver or admin in at least one OpCo")
```
Per-OpCo block:
```typescript
  const eligible = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId: opco.id, role: { in: ["approver", "admin"] }, isActive: true },
  })
  if (!eligible) throw new Error(`Forbidden: user must be an approver or admin in ${opcoSlug}`)
```

- [ ] **Step 2: Add a focused test**

Create/extend `src/test/actions/cab.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-admin", email: "a@c.com", name: "A",
    organizations: [{ id: "org-1", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    realmRoles: ["group_admin"],
  }),
}))
const mockDb = {
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-1", slug: "ghana" }) },
  userOpCoAssignment: { findFirst: vi.fn() },
  cABMembership: { findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: "m1" }), create: vi.fn().mockResolvedValue({ id: "m1" }) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))
vi.mock("@/server/audit", () => ({ recordAdminAction: vi.fn().mockResolvedValue(undefined) }))

import { addCabMember } from "@/server/actions/cab"

beforeEach(() => vi.clearAllMocks())

it("seats an OpCo admin (no separate approver role) on the OpCo CAB", async () => {
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg", role: "admin" })
  await expect(addCabMember("cto-user", "ghana")).resolves.toBeDefined()
  expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ role: { in: ["approver", "admin"] } }) })
  )
})
```

- [ ] **Step 3: Run — expect PASS**

Run: `pnpm test src/test/actions/cab.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/cab.ts src/test/actions/cab.test.ts
git commit -m "feat(cab): allow seating OpCo/group admins (admin ⊇ approver)"
```

---

## Task 9: Seed — CAB seating, no isGroupCto

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Replace the Group CTO + resident CTO seeding**

Remove the `isGroupCto` user upsert. Replace the "Group CTO" and "resident CTO" blocks with role + CAB seating. After the resident-CTO loop, also seat Samuel on the group CAB and every OpCo CAB, and add one sample delegation.

Replace the block that currently starts at `// Group CTO — approves Equiano ...` through the end of the resident-CTO loop with:
```typescript
  // Group CTO (Samuel): group admin, seated on the group CAB and every OpCo CAB (secondee).
  const samuel = await prisma.user.upsert({
    where: { email: 'syeboah@csquared.com' },
    update: { name: 'Samuel Yeboah' },
    create: { keycloakId: '3feaae6a-8611-45e2-aa73-4a32eacc722f', email: 'syeboah@csquared.com', name: 'Samuel Yeboah' },
  })
  // group CAB (opcoId null) — find-then-create (NULL opcoId isn't uniquely upsertable)
  const samuelGroup = await prisma.cABMembership.findFirst({ where: { userId: samuel.id, opcoId: null } })
  if (!samuelGroup) await prisma.cABMembership.create({ data: { userId: samuel.id, opcoId: null } })
  console.log('Seeded Group CTO Samuel + group CAB membership')

  const residentCtoNames: Record<string, string> = {
    ghana: 'Ama Owusu', uganda: 'David Okello', drc: 'Céline Mbiya',
    togo: 'Kossi Adjavon', liberia: 'Joseph Kollie', mauritius: 'Priya Ramphul',
  }
  for (const o of opcos) {
    const opco = await prisma.opCo.findUnique({ where: { slug: o.slug } })
    if (!opco) continue
    // Resident CTO: OpCo admin + OpCo CAB member.
    const cto = await prisma.user.upsert({
      where: { email: `${o.slug}.cto@csquared.com` },
      update: { name: residentCtoNames[o.slug] },
      create: { keycloakId: `seed-${o.slug}-cto`, email: `${o.slug}.cto@csquared.com`, name: residentCtoNames[o.slug] },
    })
    await prisma.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: cto.id, opcoId: opco.id } },
      update: { role: 'admin', isActive: true },
      create: { userId: cto.id, opcoId: opco.id, role: 'admin', isActive: true },
    })
    await prisma.cABMembership.upsert({
      where: { userId_opcoId: { userId: cto.id, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId: cto.id, opcoId: opco.id },
    })
    // Samuel as secondee on every OpCo CAB.
    await prisma.cABMembership.upsert({
      where: { userId_opcoId: { userId: samuel.id, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId: samuel.id, opcoId: opco.id },
    })
  }
  console.log('Seeded resident CTOs (admin + OpCo CAB) and Samuel as secondee on all OpCo CABs')

  // Sample delegation: Ghana CTO delegates to a deputy for the next 30 days.
  const ghanaOpco = await prisma.opCo.findUnique({ where: { slug: 'ghana' } })
  const ghanaCto = await prisma.user.findUnique({ where: { email: 'ghana.cto@csquared.com' } })
  if (ghanaOpco && ghanaCto) {
    const deputy = await prisma.user.upsert({
      where: { email: 'ghana.deputy@csquared.com' },
      update: { name: 'Kofi Deputy' },
      create: { keycloakId: 'seed-ghana-deputy', email: 'ghana.deputy@csquared.com', name: 'Kofi Deputy' },
    })
    const existing = await prisma.approverDelegation.findFirst({
      where: { fromUserId: ghanaCto.id, toUserId: deputy.id, opcoId: ghanaOpco.id, isActive: true },
    })
    if (!existing) {
      await prisma.approverDelegation.create({
        data: {
          opcoId: ghanaOpco.id, fromUserId: ghanaCto.id, toUserId: deputy.id,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    }
    console.log('Seeded sample delegation: Ghana CTO → deputy')
  }
```

- [ ] **Step 2: Run the seed**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/csquared_cms" npx tsx prisma/seed.ts
```
Expected: all "Seeded …" logs, no errors.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): seat Samuel (group+OpCo CABs) and resident CTOs (admin+CAB); sample delegation"
```

---

## Task 10: Formalize email + cleanup

**Files:**
- Modify: `.env.example`
- Modify: `src/server/email.ts` (tidy only)
- Delete: `fix-email.ts`, `update-keycloak-id.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Document the email env vars**

Append to `.env.example`:
```bash
# Email (Resend primary; Gmail app-password fallback for Google Workspace)
SMTP_USER=                 # Gmail/Workspace address used as SMTP sender (fallback)
APP_PASSWORD=              # Gmail app password for SMTP_USER (fallback)
TEST_EMAIL_RECIPIENT=      # dev only: redirect all outgoing mail here to avoid spamming
```

- [ ] **Step 2: Tidy the dev `from` in email.ts**

In `src/server/email.ts`, keep the transport logic; make the dev `from` configurable rather than hardcoded to `onboarding@resend.dev`:
```typescript
const isDev = process.env.NODE_ENV !== "production"
const FROM = process.env.EMAIL_FROM ?? (isDev ? "onboarding@resend.dev" : "CSquared CMS <noreply@csquared.com>")
```
Add `EMAIL_FROM=` to `.env.example` under the email section with a comment `# optional explicit From address`.

- [ ] **Step 3: Remove throwaway scripts + ignore .codex**

Run:
```bash
git rm -f --ignore-unmatch fix-email.ts update-keycloak-id.ts 2>/dev/null; rm -f fix-email.ts update-keycloak-id.ts
printf '\n.codex/\n' >> .gitignore
```
Decide on `AGENTS.md`: keep it (it's a useful Codex guide) — `git add AGENTS.md`. (If undesired, `rm AGENTS.md` instead.)

- [ ] **Step 4: Verify build is unblocked**

Run: `pnpm tsc --noEmit`
Expected: PASS (the `dotenv`-importing `fix-email.ts` is gone).

- [ ] **Step 5: Commit**

```bash
git add .env.example src/server/email.ts .gitignore AGENTS.md
git commit -m "chore(email): document transport env; tidy dev From; remove throwaway scripts"
```

---

## Task 11: Final verification + branch consolidation

> Per `memory/feedback_phase_gates.md`: run deslop and ensure all tests pass before done.

- [ ] **Step 1: No isGroupCto remnants**

Run: `grep -rn "isGroupCto" src prisma | grep -v node_modules`
Expected: no output.

- [ ] **Step 2: deslop the new/changed server logic**

Invoke the `deslop` skill on `src/server/approval-authority.ts`, `src/server/actions/approvals.ts`, `src/server/actions/changes.ts`, `src/server/actions/cab.ts`. Apply findings.

- [ ] **Step 3: Lint + type-check**

Run: `pnpm lint && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: PASS (all suites, incl. the new approval-authority + cab tests and updated changes/approvals tests). Docker must be up for the Testcontainers isolation test.

- [ ] **Step 5: Manual smoke (dev stack up, seeded)**

1. `pnpm dev`, log in as `devops@csquared.com`.
2. Create + submit a **Wifi** change in Ghana → it appears in the approvals queue; the resident CTO (and Samuel) are the routed approvers; approve as devops → `approved`.
3. Create + submit an **Equiano Optics** change → routed to Samuel/group CAB only; an OpCo-only member cannot approve; devops (group_admin) or Samuel can.
4. Confirm the request-form preview and the Approval Matrix page reflect CAB membership.

- [ ] **Step 6: Commit any deslop/lint fixes**

```bash
git add -A
git commit -m "chore: deslop + lint pass for CAB approval routing"
```

---

## Self-Review Notes (for the implementer)

- **`isCab` is now server-set to `true`** for every approval through `submitApproval` (the path is CAB-only); the client's `isCabMember` argument is vestigial but harmless. Quorum (`checkCabQuorum`) still needs 2 *distinct* approver ids.
- **N+1 in `listApprovableChanges`/`canUserApproveChange`** (a couple of queries per pending change). Fine at current scale; optimize only if the pending list grows large.
- **Equiano + delegation:** group-level delegation now works because `opcoId` is nullable; a delegation with `opcoId = null` stands in for a group-CAB member (Samuel).
- **`approver` role retained:** still the CAB-seating prerequisite and used by lifecycle actions (`updateChangeStatus`); only the *approval decision* moved to CAB membership.
