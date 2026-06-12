# Admin & Governance — Plan C: CAB Membership Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side CAB (Change Advisory Board) membership management — per-OpCo CABs and a single group CAB — with approver-eligibility, soft-remove + revive, the `NULL`-opcoId group guard, and atomic auditing.

**Architecture:** New `src/server/actions/cab.ts`. Per-OpCo CAB membership is managed by OpCo admins (or group_admin) via `canManageCab`; the group CAB is group_admin-only (`isGroupAdmin`). CAB eligibility requires the target to hold an active `approver` assignment (in the OpCo for a per-OpCo CAB; in **any** OpCo for the group CAB). Per-OpCo rows use the `@@unique([userId, opcoId])` constraint + `upsert` to revive; **group rows (`opcoId: null`) can't use `upsert`** (Postgres treats NULL as distinct — proven by the existing integration test), so they're handled with an explicit find-then-create/update guard. Every mutation is atomic with one `AdminAuditLog` row.

**Tech Stack:** Next.js server actions, Prisma v7, Vitest + mocked Prisma client, `recordAdminAction`.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-and-governance-design.md` (CAB section).

**Depends on:** Plan A (the `CABMembership` model + foundation migration already exist — **no migration here**; `recordAdminAction`; the mock-DB `$transaction` idiom). The CAB **UI** (repurposing `/approval-matrix`) is **Plan F**, not this plan.

---

## File Structure

- `src/lib/permissions.ts` — add `canManageCab(orgs, realmRoles, opcoSlug)` (group_admin or OpCo admin). Group-CAB management uses the existing `isGroupAdmin`; group/per-OpCo **reads** use the existing `isGroupLevel` / `canAudit` — no new read helpers.
- `src/server/actions/cab.ts` — **new**: `addCabMember`, `removeCabMember`, `listCabMembers`.
- Tests: `src/test/lib/permissions.test.ts` (extend), `src/test/actions/cab.test.ts` (**new**).

> **Eligibility rule (per spec):** the target must hold an active `approver` assignment. Note this is the literal `approver` role — an OpCo `admin` who lacks a separate `approver` assignment is **not** auto-eligible. (If you later want "anyone who can approve," widen the eligibility query; flagged as a follow-up, not built here.)

> **Helper duplication note:** `canManageCab` is logically identical to `canManageUsers`/`canManageTeams` today (group_admin or OpCo admin), but is a distinct authorization concept and matches the established per-domain helper convention. Implement it directly; do not delegate. (A future refactor could collapse all three into one `isOpCoAdmin` primitive — out of scope here.)

---

## Task 1: `canManageCab` helper

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/test/lib/permissions.test.ts` (add `canManageCab` to the existing `@/lib/permissions` import):

```ts
describe("canManageCab", () => {
  const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]
  const ghanaApproverOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["approver"] }]

  it("allows a group_admin to manage any OpCo's CAB", () => {
    expect(canManageCab([], ["group_admin"], "ghana")).toBe(true)
  })

  it("allows an OpCo admin to manage their OpCo's CAB", () => {
    expect(canManageCab(ghanaAdminOrgs, [], "ghana")).toBe(true)
  })

  it("forbids an OpCo admin in an OpCo they don't administer", () => {
    expect(canManageCab(ghanaAdminOrgs, [], "uganda")).toBe(false)
  })

  it("forbids a mere approver (eligibility is not management)", () => {
    expect(canManageCab(ghanaApproverOrgs, [], "ghana")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canManageCab`
Expected: FAIL — `canManageCab is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/permissions.ts`:

```ts
export function canManageCab(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string
): boolean {
  return isGroupAdmin(realmRoles) || hasRoleInOpCo(organizations, opcoSlug, "admin")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canManageCab`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(permissions): add canManageCab helper"
```

---

## Task 2: `addCabMember` (per-OpCo + group)

**Files:**
- Create: `src/server/actions/cab.ts`
- Test: `src/test/actions/cab.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/cab.test.ts`:

```ts
// src/test/actions/cab.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-ghr",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  userOpCoAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) }, // eligible by default
  cABMembership: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "cab-1" }),
    update: vi.fn().mockResolvedValue({ id: "cab-1" }),
    upsert: vi.fn().mockResolvedValue({ id: "cab-1" }),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { addCabMember } from "@/server/actions/cab"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }
const ghanaAdmin = {
  keycloakId: "kc-gha", email: "gha@t.co", name: "GhA",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
  realmRoles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "a1" })
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
})

describe("addCabMember — per-OpCo", () => {
  it("rejects a non-admin", async () => {
    await expect(addCabMember("user-2", "ghana")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a target who is not an approver in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addCabMember("user-2", "ghana")).rejects.toThrow(/approver/i)
  })

  it("upserts an eligible approver and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await addCabMember("user-2", "ghana")
    expect(mockDb.cABMembership.upsert).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("addCabMember — group", () => {
  it("rejects an OpCo admin (group CAB is group_admin-only)", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(addCabMember("user-2", null)).rejects.toThrow(/Forbidden/)
  })

  it("rejects a target who is not an approver in any OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addCabMember("user-2", null)).rejects.toThrow(/approver/i)
  })

  it("creates a new group membership and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await addCabMember("user-2", null)
    expect(mockDb.cABMembership.create).toHaveBeenCalledTimes(1)
    expect(mockDb.cABMembership.upsert).not.toHaveBeenCalled() // group can't upsert on NULL opcoId
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("revives an existing soft-removed group membership instead of duplicating", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.cABMembership.findFirst.mockResolvedValueOnce({ id: "cab-old", isActive: false })
    await addCabMember("user-2", null)
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { id: "cab-old" },
      data: { isActive: true, endedAt: null },
    })
    expect(mockDb.cABMembership.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/cab.test.ts`
Expected: FAIL — cannot find module `@/server/actions/cab`.

- [ ] **Step 3: Implement `addCabMember`**

Create `src/server/actions/cab.ts`:

```ts
// src/server/actions/cab.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageCab, isGroupAdmin } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

export async function addCabMember(userId: string, opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  // --- Group CAB (opcoId = null) ---
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can manage the group CAB")
    }
    const eligible = await db.userOpCoAssignment.findFirst({
      where: { userId, role: "approver", isActive: true },
    })
    if (!eligible) throw new Error("Forbidden: user must be an approver in at least one OpCo")

    // Postgres treats NULL opcoId as distinct, so upsert can't dedupe group rows —
    // find-then-create/update guards against duplicates.
    const existing = await db.cABMembership.findFirst({ where: { userId, opcoId: null } })
    return db.$transaction(async (tx) => {
      const member = existing
        ? await tx.cABMembership.update({
            where: { id: existing.id },
            data: { isActive: true, endedAt: null },
          })
        : await tx.cABMembership.create({ data: { userId, opcoId: null } })
      await recordAdminAction(tx, {
        actorKeycloakId: session.keycloakId,
        action: "cab.add",
        targetUserId: userId,
        summary: `Added user ${userId} to the group CAB`,
      })
      return member
    })
  }

  // --- Per-OpCo CAB ---
  if (!canManageCab(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage the CAB in ${opcoSlug}`)
  }
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)

  const eligible = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId: opco.id, role: "approver", isActive: true },
  })
  if (!eligible) throw new Error(`Forbidden: user must be an approver in ${opcoSlug}`)

  return db.$transaction(async (tx) => {
    const member = await tx.cABMembership.upsert({
      where: { userId_opcoId: { userId, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId, opcoId: opco.id },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "cab.add",
      opcoId: opco.id,
      targetUserId: userId,
      summary: `Added user ${userId} to the ${opcoSlug} CAB`,
    })
    return member
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/actions/cab.test.ts`
Expected: PASS. Then `pnpm tsc --noEmit` → PASS. No casts on `recordAdminAction(tx, ...)`.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/cab.ts src/test/actions/cab.test.ts
git commit -m "feat(cab): addCabMember with approver eligibility, group NULL-guard, and audit"
```

---

## Task 3: `removeCabMember` + `listCabMembers`

**Files:**
- Modify: `src/server/actions/cab.ts`
- Test: `src/test/actions/cab.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/test/actions/cab.test.ts`, extend the import:

```ts
import { addCabMember, removeCabMember, listCabMembers } from "@/server/actions/cab"
```

Add a `groupAuditor` fixture near the others:

```ts
const groupAuditor = { keycloakId: "kc-gaud", email: "gaud@t.co", name: "Gaud", organizations: [], realmRoles: ["group_auditor"] }
```

Append these describe blocks:

```ts
describe("removeCabMember", () => {
  it("soft-removes a per-OpCo member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await removeCabMember("user-2", "ghana")
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { userId_opcoId: { userId: "user-2", opcoId: "opco-gh" } },
      data: { isActive: false, endedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("rejects a non-admin removing a per-OpCo member", async () => {
    await expect(removeCabMember("user-2", "ghana")).rejects.toThrow(/Forbidden/)
  })

  it("soft-removes a group member (group_admin) and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.cABMembership.findFirst.mockResolvedValueOnce({ id: "cab-g", isActive: true })
    await removeCabMember("user-2", null)
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { id: "cab-g" },
      data: { isActive: false, endedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("rejects an OpCo admin removing a group member", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(removeCabMember("user-2", null)).rejects.toThrow(/Forbidden/)
  })
})

describe("listCabMembers", () => {
  it("lets an OpCo admin list their CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await listCabMembers("ghana")
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith({
      where: { opcoId: "opco-gh", isActive: true },
      include: { user: true },
    })
  })

  it("rejects a plain requester listing a per-OpCo CAB", async () => {
    await expect(listCabMembers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_auditor read the group CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAuditor)
    await listCabMembers(null)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith({
      where: { opcoId: null, isActive: true },
      include: { user: true },
    })
  })

  it("rejects an OpCo admin reading the group CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(listCabMembers(null)).rejects.toThrow(/Forbidden/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/cab.test.ts -t "removeCabMember|listCabMembers"`
Expected: FAIL — `removeCabMember is not a function` (and `listCabMembers`).

- [ ] **Step 3: Implement**

Update the import line in `src/server/actions/cab.ts` to add the read helpers:

```ts
import { canManageCab, isGroupAdmin, isGroupLevel, canAudit } from "@/lib/permissions"
```

Append:

```ts
export async function removeCabMember(userId: string, opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can manage the group CAB")
    }
    const existing = await db.cABMembership.findFirst({
      where: { userId, opcoId: null, isActive: true },
    })
    if (!existing) throw new Error("User is not an active group CAB member")
    await db.$transaction(async (tx) => {
      await tx.cABMembership.update({
        where: { id: existing.id },
        data: { isActive: false, endedAt: new Date() },
      })
      await recordAdminAction(tx, {
        actorKeycloakId: session.keycloakId,
        action: "cab.remove",
        targetUserId: userId,
        summary: `Removed user ${userId} from the group CAB`,
      })
    })
    return
  }

  if (!canManageCab(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage the CAB in ${opcoSlug}`)
  }
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)

  await db.$transaction(async (tx) => {
    await tx.cABMembership.update({
      where: { userId_opcoId: { userId, opcoId: opco.id } },
      data: { isActive: false, endedAt: new Date() },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "cab.remove",
      opcoId: opco.id,
      targetUserId: userId,
      summary: `Removed user ${userId} from the ${opcoSlug} CAB`,
    })
  })
}

export async function listCabMembers(opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  if (opcoSlug === null) {
    // Group CAB read: group_admin or group_auditor.
    if (!isGroupLevel(session.realmRoles)) {
      throw new Error("Forbidden: cannot read the group CAB")
    }
    return db.cABMembership.findMany({ where: { opcoId: null, isActive: true }, include: { user: true } })
  }

  // Per-OpCo CAB read: admins or auditors of that OpCo (or any group-level role).
  if (!canAudit(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot read the CAB in ${opcoSlug}`)
  }
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)
  return db.cABMembership.findMany({ where: { opcoId: opco.id, isActive: true }, include: { user: true } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/actions/cab.test.ts`
Expected: PASS (all add/remove/list cases). Then `pnpm tsc --noEmit` → PASS. No casts.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/cab.ts src/test/actions/cab.test.ts
git commit -m "feat(cab): removeCabMember (soft) + listCabMembers with read authz"
```

---

## Task 4: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` (Docker available → integration tests run too).
Expected: PASS — all suites incl. the new `cab.test.ts` cases.

- [ ] **Step 2: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors (the pre-existing `security/detect-object-injection` warnings are unchanged).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(cab): deslop pass for CAB backend"
```

---

## Self-Review (author's check against the spec)

- **Per-OpCo + group CAB** (spec §CAB scope): `opcoSlug: string | null` switch in every action. ✓
- **Eligibility = approver** (spec): `userOpCoAssignment.findFirst` for `role: "approver"` — scoped to the OpCo (per-OpCo) or any OpCo (group). ✓
- **Who manages** (spec §Authority Matrix): per-OpCo via `canManageCab`; group via `isGroupAdmin`. ✓
- **Reads** (spec: group_auditor read all; per-OpCo auditor read): group via `isGroupLevel`, per-OpCo via `canAudit`. ✓
- **Soft-remove + revive** (spec §Data Model): per-OpCo `upsert`; group find-then-create/update; remove sets `isActive:false, endedAt`. ✓
- **NULL-opcoId group guard** (spec §Uniqueness; proven by `TC-INT-CAB-001`): explicit find-then-write, never `upsert`, for group rows. ✓
- **Atomic audit** (spec §Transaction & audit pattern): every mutation wraps writes + `recordAdminAction` in `$transaction`. ✓
- **Out of scope**: CAB engagement rules (when the group CAB supersedes an OpCo CAB — separate spec); CAB UI (Plan F).
