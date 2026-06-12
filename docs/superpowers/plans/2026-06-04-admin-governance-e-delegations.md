# Admin & Governance — Plan E: Approver Delegations Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed approver delegations — an admin grants one approver's approval rights to another for a date range — with approver-eligibility on both sides, soft revoke, and atomic auditing.

**Architecture:** New `src/server/actions/delegations.ts`. Management is an OpCo-admin capability, so it reuses the existing `canManageUsers` gate; reads use the existing `canAudit` (so auditors can see delegations). Both the delegator and delegatee must hold an active `approver` assignment in the OpCo. Revoke is soft (`isActive = false`). The `ApproverDelegation` model already exists — **no migration**.

**Tech Stack:** Next.js server actions, Prisma v7, Vitest + mocked Prisma client, `recordAdminAction`.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-and-governance-design.md` (Delegations — "In, admin-managed").

**Depends on:** Plan A (`recordAdminAction`, mock-DB `$transaction` idiom). The delegations **UI** is Plan F.

---

## File Structure

- `src/server/actions/delegations.ts` — **new**: `createDelegation`, `revokeDelegation`, `listDelegations`, plus a private `resolveOpCo` (by slug) helper.
- Test: `src/test/actions/delegations.test.ts` (**new**).

> **Authorization note:** delegation *management* is the same capability as user management (admin of the OpCo or group_admin), so this reuses `canManageUsers` rather than introducing a 4th identical helper. Delegation *reads* use `canAudit` (admins + auditors + group-level), per the spec's "group_auditor read" row.

> **`ApproverDelegation` has no `opco` relation** (just an `opcoId` column). `revokeDelegation` therefore loads the delegation, then looks up the OpCo by `opcoId` to authorize against its slug.

---

## Task 1: `createDelegation`

**Files:**
- Create: `src/server/actions/delegations.ts`
- Test: `src/test/actions/delegations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/delegations.test.ts`:

```ts
// src/test/actions/delegations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-gha",
    email: "gha@t.co",
    name: "Ghana Admin",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  userOpCoAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) }, // approver by default
  approverDelegation: {
    create: vi.fn().mockResolvedValue({ id: "del-1" }),
    update: vi.fn().mockResolvedValue({ id: "del-1" }),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { createDelegation } from "@/server/actions/delegations"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }
const ghanaRequester = {
  keycloakId: "kc-ghr", email: "ghr@t.co", name: "GhR",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
  realmRoles: [],
}

const validUntil = new Date("2026-12-31")

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "a1" })
})

describe("createDelegation", () => {
  it("rejects a non-admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/Forbidden/)
  })

  it("rejects delegating to oneself", async () => {
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-same", toUserId: "u-same", validUntil })
    ).rejects.toThrow(/itself|same|self/i)
  })

  it("rejects when the delegator is not an approver in the OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null) // from-user lookup
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/approver/i)
  })

  it("rejects when the delegatee is not an approver in the OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst
      .mockResolvedValueOnce({ id: "a1" }) // from-user OK
      .mockResolvedValueOnce(null) // to-user not approver
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/approver/i)
  })

  it("creates a delegation and writes an audit row", async () => {
    await createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    expect(mockDb.approverDelegation.create).toHaveBeenCalledWith({
      data: { opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to", validUntil },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("allows a group_admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    expect(mockDb.approverDelegation.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/delegations.test.ts`
Expected: FAIL — cannot find module `@/server/actions/delegations`.

- [ ] **Step 3: Implement**

Create `src/server/actions/delegations.ts`:

```ts
// src/server/actions/delegations.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageUsers, canAudit } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

// Resolves an OpCo by slug; throws if it doesn't exist.
async function resolveOpCo(db: ReturnType<typeof getPrisma>, slug: string) {
  const opco = await db.opCo.findUnique({ where: { slug } })
  if (!opco) throw new Error(`OpCo not found: ${slug}`)
  return opco
}

// Throws unless the user holds an active approver assignment in the OpCo.
async function assertApprover(
  db: ReturnType<typeof getPrisma>,
  userId: string,
  opcoId: string,
  label: string
) {
  const assignment = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, role: "approver", isActive: true },
  })
  if (!assignment) throw new Error(`Forbidden: ${label} must be an approver in this OpCo`)
}

export async function createDelegation(input: {
  opcoSlug: string
  fromUserId: string
  toUserId: string
  validUntil: Date
}) {
  if (input.fromUserId === input.toUserId) {
    throw new Error("A user cannot delegate to itself")
  }

  const session = await getAppSession()
  if (!canManageUsers(session.organizations, session.realmRoles, input.opcoSlug)) {
    throw new Error(`Forbidden: cannot manage delegations in ${input.opcoSlug}`)
  }

  const db = getPrisma()
  const opco = await resolveOpCo(db, input.opcoSlug)
  await assertApprover(db, input.fromUserId, opco.id, "delegator")
  await assertApprover(db, input.toUserId, opco.id, "delegatee")

  return db.$transaction(async (tx) => {
    const delegation = await tx.approverDelegation.create({
      data: {
        opcoId: opco.id,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        validUntil: input.validUntil,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "delegation.create",
      opcoId: opco.id,
      targetUserId: input.fromUserId,
      summary: `Delegated ${input.fromUserId}'s approvals to ${input.toUserId} in ${input.opcoSlug}`,
      metadata: { toUserId: input.toUserId, validUntil: input.validUntil },
    })
    return delegation
  })
}
```

- [ ] **Step 4: Run green**

Run: `pnpm vitest run src/test/actions/delegations.test.ts`
Expected: PASS (6 cases). Then `pnpm tsc --noEmit` → PASS. No casts.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/delegations.ts src/test/actions/delegations.test.ts
git commit -m "feat(delegations): createDelegation with approver eligibility and audit"
```

---

## Task 2: `revokeDelegation` + `listDelegations`

**Files:**
- Modify: `src/server/actions/delegations.ts`
- Test: `src/test/actions/delegations.test.ts`

- [ ] **Step 1: Add failing tests**

Extend the import:

```ts
import { createDelegation, revokeDelegation, listDelegations } from "@/server/actions/delegations"
```

Add a `ghanaAuditor` fixture near the others:

```ts
const ghanaAuditor = {
  keycloakId: "kc-gaud", email: "gaud@t.co", name: "GhAud",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["auditor"] }],
  realmRoles: [],
}
```

Append:

```ts
describe("revokeDelegation", () => {
  it("throws when the delegation does not exist", async () => {
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce(null)
    await expect(revokeDelegation("missing")).rejects.toThrow(/not found/i)
  })

  it("rejects a non-admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce({ id: "del-1", opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to" })
    await expect(revokeDelegation("del-1")).rejects.toThrow(/Forbidden/)
  })

  it("soft-revokes a delegation and writes an audit row", async () => {
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce({ id: "del-1", opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to" })
    await revokeDelegation("del-1")
    expect(mockDb.approverDelegation.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { isActive: false },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("listDelegations", () => {
  it("lets an OpCo admin list delegations", async () => {
    await listDelegations("ghana")
    expect(mockDb.approverDelegation.findMany).toHaveBeenCalledWith({
      where: { opcoId: "opco-gh", isActive: true },
      include: { fromUser: true, toUser: true },
    })
  })

  it("lets an auditor read delegations", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAuditor)
    await listDelegations("ghana")
    expect(mockDb.approverDelegation.findMany).toHaveBeenCalledTimes(1)
  })

  it("rejects a plain requester", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    await expect(listDelegations("ghana")).rejects.toThrow(/Forbidden/)
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/delegations.test.ts -t "revokeDelegation|listDelegations"`
Expected: FAIL — `revokeDelegation is not a function` (etc.).

- [ ] **Step 3: Implement**

Append to `src/server/actions/delegations.ts`:

```ts
export async function revokeDelegation(delegationId: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const delegation = await db.approverDelegation.findUnique({ where: { id: delegationId } })
  if (!delegation) throw new Error("Delegation not found")

  const opco = await db.opCo.findUnique({ where: { id: delegation.opcoId } })
  if (!opco) throw new Error("OpCo not found")
  if (!canManageUsers(session.organizations, session.realmRoles, opco.slug)) {
    throw new Error(`Forbidden: cannot manage delegations in ${opco.slug}`)
  }

  await db.$transaction(async (tx) => {
    await tx.approverDelegation.update({ where: { id: delegationId }, data: { isActive: false } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "delegation.revoke",
      opcoId: opco.id,
      targetUserId: delegation.fromUserId,
      summary: `Revoked delegation ${delegationId} in ${opco.slug}`,
    })
  })
}

export async function listDelegations(opcoSlug: string) {
  const session = await getAppSession()
  if (!canAudit(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot read delegations in ${opcoSlug}`)
  }
  const db = getPrisma()
  const opco = await resolveOpCo(db, opcoSlug)
  return db.approverDelegation.findMany({
    where: { opcoId: opco.id, isActive: true },
    include: { fromUser: true, toUser: true },
  })
}
```

- [ ] **Step 4: Run green (FULL file)**

Run: `pnpm vitest run src/test/actions/delegations.test.ts`
Expected: PASS (create + revoke + list). Then `pnpm tsc --noEmit` → PASS. No casts.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/delegations.ts src/test/actions/delegations.test.ts
git commit -m "feat(delegations): revokeDelegation (soft) + listDelegations with read authz"
```

---

## Task 3: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` (Docker available → integration tests run too).
Expected: PASS — all suites incl. `delegations.test.ts`.

- [ ] **Step 2: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors (pre-existing `security/detect-object-injection` warnings unchanged).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(delegations): deslop pass for delegations backend"
```

---

## Self-Review (author's check against the spec)

- **Admin-managed** (spec §Delegations: "In — admin-managed"): `canManageUsers` gate on create/revoke. ✓
- **Approver eligibility both sides** (spec: "both must hold approver in the OpCo"): `assertApprover` for delegator and delegatee. ✓
- **Date range**: `validFrom` defaults to now (schema), `validUntil` from input. ✓
- **Soft revoke**: `isActive = false`. ✓
- **Reads** (spec §Authority Matrix: group_auditor read): `listDelegations` via `canAudit`. ✓
- **Self-delegation guard**: `fromUserId === toUserId` rejected. ✓
- **Atomic audit** (spec §Transaction & audit pattern): every mutation wraps writes + `recordAdminAction` in `$transaction`. ✓
- **Out of scope**: enforcing delegations during the actual approval workflow (a change-lifecycle concern, separate); delegations UI (Plan F).
