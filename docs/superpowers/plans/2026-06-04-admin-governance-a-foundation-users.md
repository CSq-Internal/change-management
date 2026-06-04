# Admin & Governance — Plan A: Foundation + Users/Roles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shared schema/audit/permission foundation for the whole Admin & Governance feature, then extend user/role management with add-by-email onboarding, a role-assignment privilege ceiling, a last-admin guard, scoped visibility, and atomic admin-action auditing.

**Architecture:** One Prisma migration adds every new model/field the whole feature needs (so later plans only add actions + UI). Admin mutations run inside a `db.$transaction` that also appends exactly one immutable `AdminAuditLog` row via a shared `recordAdminAction` helper. Authorization stays in pure functions in `src/lib/permissions.ts` so it is unit-testable without a DB.

**Tech Stack:** Next.js App Router server actions, Prisma v7 (+ `@prisma/adapter-pg`), Vitest + mocked Prisma client, NextAuth session via `getAppSession`.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-and-governance-design.md`

**This is Plan A of a sequenced set.** Later plans (separate files, written on request): **B** Teams, **C** CAB (per-OpCo + group), **D** OpCo lifecycle, **E** Delegations, **F** Admin Console UI. The schema migration here is the foundation for all of them.

---

## File Structure

- `prisma/schema.prisma` — add `TeamRole` enum, `TeamMember.role`, `CABMembership`, `AdminAuditLog`, `OpCo.archivedAt` (+ back-relations on `User`/`OpCo`).
- `src/lib/permissions.ts` — add `canAssignRole` (privilege ceiling). Reuse existing `manageableOpCoSlugs` for visibility (no new visibility helper — DRY).
- `src/server/audit.ts` — **new**: `recordAdminAction(tx, input)` shared audit appender.
- `src/server/actions/users.ts` — replace `createUser` with `onboardUser` (add-by-email + ceiling + audit); add ceiling + audit to `setUserAssignments`; add last-admin guard + audit to `deactivateUser`/`reactivateUser`; add `assertNotLastAdmin` helper.
- `src/app/(dashboard)/users/onboard-wizard.tsx` — update the single caller `createUser` → `onboardUser`.
- `src/app/(dashboard)/users/page.tsx` — scope the directory query to **managed** OpCos (admin), not all memberships.
- Tests: `src/test/lib/permissions.test.ts` (extend), `src/test/actions/users-authz.test.ts` (extend), `src/test/actions/admin-audit.test.ts` (**new**).

---

## Task 1: Schema foundation migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the `TeamRole` enum and `TeamMember.role` field**

In `prisma/schema.prisma`, add the enum next to the other enums (after `ChangeCategory`):

```prisma
enum TeamRole {
  lead
  member
}
```

Add the `role` field to `model TeamMember` (after `userId`):

```prisma
model TeamMember {
  id     String   @id @default(cuid())
  teamId String
  team   Team     @relation(fields: [teamId], references: [id])
  userId String
  role   TeamRole @default(member)

  @@unique([teamId, userId])
}
```

- [ ] **Step 2: Add `CABMembership` and `AdminAuditLog` models, and `OpCo.archivedAt`**

Add `archivedAt` to `model OpCo` (after `createdAt`) and the two back-relations:

```prisma
model OpCo {
  // ...existing fields...
  archivedAt DateTime?

  users     UserOpCoAssignment[]
  changes   ChangeRequest[]
  teams     Team[]
  blackouts BlackoutPeriod[]
  cab       CABMembership[]
}
```

Add the back-relations to `model User` (alongside its existing relations):

```prisma
model User {
  // ...existing fields and relations...
  cabMemberships CABMembership[]
  adminActions   AdminAuditLog[] @relation("AdminActor")
}
```

Add the two new models at the end of the schema:

```prisma
model CABMembership {
  id       String    @id @default(cuid())
  userId   String
  user     User      @relation(fields: [userId], references: [id])
  opcoId   String?
  opco     OpCo?     @relation(fields: [opcoId], references: [id])
  isActive Boolean   @default(true)
  addedAt  DateTime  @default(now())
  endedAt  DateTime?

  @@unique([userId, opcoId])
  @@index([opcoId])
  @@index([userId])
}

model AdminAuditLog {
  id           String   @id @default(cuid())
  actorId      String
  actor        User     @relation("AdminActor", fields: [actorId], references: [id])
  action       String
  opcoId       String?
  targetUserId String?
  summary      String
  metadata     Json?
  at           DateTime @default(now())

  @@index([opcoId])
  @@index([actorId])
  @@index([targetUserId])
  @@index([at])
}
```

> Note on uniqueness: `@@unique([userId, opcoId])` enforces one CAB row per user per OpCo. Postgres treats `NULL` `opcoId` (group CAB) as distinct, so group-CAB duplicates are prevented by an app guard in Plan C, not here.

- [ ] **Step 3: Validate the schema and regenerate the client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `pnpm prisma generate`
Expected: generates the Prisma client with the new `CABMembership`, `AdminAuditLog`, `TeamRole` types, no errors.

- [ ] **Step 4: Create the migration file (no DB connection needed)**

Dev has no `DATABASE_URL`, so generate the SQL without applying it:

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/_check.sql || true`

Then create the migration scaffold and let it be applied when a DB is available:

Run: `mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_admin_governance_foundation`

Author `migration.sql` in that folder with the `CREATE TYPE "TeamRole"`, `ALTER TABLE "TeamMember" ADD COLUMN "role"`, `ALTER TABLE "OpCo" ADD COLUMN "archivedAt"`, `CREATE TABLE "CABMembership"`, and `CREATE TABLE "AdminAuditLog"` statements (mirror the SQL `prisma migrate diff` prints for these models). If `docker/` Postgres is running, instead run `pnpm prisma migrate dev --name admin_governance_foundation` and let Prisma author it.

Expected: a `prisma/migrations/<ts>_admin_governance_foundation/migration.sql` exists containing the new type, columns, and tables.

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (the generated client now has the new models; nothing references them yet).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add CABMembership, AdminAuditLog, TeamRole, OpCo.archivedAt foundation"
```

---

## Task 2: `canAssignRole` privilege-ceiling helper

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/test/lib/permissions.test.ts`:

```ts
import { canAssignRole } from "@/lib/permissions"

const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]

describe("canAssignRole", () => {
  it("lets a group_admin assign the admin role in any OpCo", () => {
    expect(canAssignRole([], ["group_admin"], "ghana", "admin")).toBe(true)
  })

  it("lets an OpCo admin assign requester/approver/auditor in their OpCo", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "requester")).toBe(true)
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "approver")).toBe(true)
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "auditor")).toBe(true)
  })

  it("forbids an OpCo admin from minting the admin role", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "admin")).toBe(false)
  })

  it("forbids an OpCo admin assigning in an OpCo they don't manage", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "uganda", "requester")).toBe(false)
  })

  it("never allows assigning realm roles in-app, even for group_admin", () => {
    expect(canAssignRole([], ["group_admin"], "ghana", "group_admin")).toBe(false)
    expect(canAssignRole([], ["group_admin"], "ghana", "group_auditor")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canAssignRole`
Expected: FAIL — `canAssignRole is not a function`.

- [ ] **Step 3: Implement `canAssignRole`**

Append to `src/lib/permissions.ts`:

```ts
const REALM_ROLES = ["group_admin", "group_auditor"]

export function canAssignRole(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string,
  role: string
): boolean {
  if (REALM_ROLES.includes(role)) return false // realm roles are Keycloak-only
  if (isGroupAdmin(realmRoles)) return true // group_admin assigns any OpCo role
  if (role === "admin") return false // OpCo admins cannot mint admins
  return hasRoleInOpCo(organizations, opcoSlug, "admin")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canAssignRole`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(permissions): add canAssignRole privilege-ceiling helper"
```

---

## Task 3: `recordAdminAction` audit helper

**Files:**
- Create: `src/server/audit.ts`
- Test: `src/test/actions/admin-audit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/admin-audit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { recordAdminAction } from "@/server/audit"

function fakeTx(actorId: string | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(actorId ? { id: actorId } : null) },
    adminAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  }
}

describe("recordAdminAction", () => {
  it("resolves the actor by keycloakId and appends one audit row", async () => {
    const tx = fakeTx("actor-db-id")
    await recordAdminAction(tx as never, {
      actorKeycloakId: "kc-actor",
      action: "role.grant",
      opcoId: "opco-gh",
      targetUserId: "target",
      summary: "Granted approver in ghana",
      metadata: { to: "approver" },
    })
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { keycloakId: "kc-actor" },
      select: { id: true },
    })
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "actor-db-id",
        action: "role.grant",
        opcoId: "opco-gh",
        targetUserId: "target",
        summary: "Granted approver in ghana",
        metadata: { to: "approver" },
      },
    })
  })

  it("throws if the actor cannot be resolved", async () => {
    const tx = fakeTx(null)
    await expect(
      recordAdminAction(tx as never, { actorKeycloakId: "ghost", action: "x", summary: "y" })
    ).rejects.toThrow(/actor/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/admin-audit.test.ts`
Expected: FAIL — cannot find module `@/server/audit`.

- [ ] **Step 3: Implement the helper**

Create `src/server/audit.ts`:

```ts
import type { Prisma } from "@prisma/client"

export interface AdminActionInput {
  actorKeycloakId: string
  action: string
  summary: string
  opcoId?: string | null
  targetUserId?: string | null
  metadata?: Prisma.InputJsonValue
}

// Minimal client shape needed; satisfied by both PrismaClient and a transaction client.
type AuditClient = {
  user: { findUnique: (args: unknown) => Promise<{ id: string } | null> }
  adminAuditLog: { create: (args: unknown) => Promise<unknown> }
}

export async function recordAdminAction(tx: AuditClient, input: AdminActionInput): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { keycloakId: input.actorKeycloakId },
    select: { id: true },
  })
  if (!actor) throw new Error("Cannot record admin action: actor not found")

  await tx.adminAuditLog.create({
    data: {
      actorId: actor.id,
      action: input.action,
      opcoId: input.opcoId ?? null,
      targetUserId: input.targetUserId ?? null,
      summary: input.summary,
      metadata: input.metadata,
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/actions/admin-audit.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/audit.ts src/test/actions/admin-audit.test.ts
git commit -m "feat(audit): add recordAdminAction immutable admin-action appender"
```

---

## Task 4: `onboardUser` — add-by-email + privilege ceiling + audit

Replaces `createUser`. Behavior: if the email already exists, **link** (add assignments to the existing identity); otherwise **create** the Keycloak user + DB user. Each assignment is checked with `canAssignRole`. DB writes + audit run in one `$transaction`.

**Files:**
- Modify: `src/server/actions/users.ts:10-56`
- Modify: `src/app/(dashboard)/users/onboard-wizard.tsx:11,89`
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Extend the shared test mock with `$transaction` + `adminAuditLog`**

In `src/test/actions/users-authz.test.ts`, update `mockDb` so the transaction callback receives the same mock, and add the audit model + actor resolution. Replace the `mockDb` definition (lines 19-36) with:

```ts
const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  user: {
    create: vi.fn().mockResolvedValue({ id: "user-new", keycloakId: "kc-new" }),
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null), // email lookup: default "no existing user"
    update: vi.fn().mockResolvedValue({}),
  },
  userOpCoAssignment: {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(2), // default: OpCo has other admins (last-admin guard passes)
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}
```

Add a helper near the top (after the `mockDb` definition) that makes `user.findUnique` answer both the actor lookup (`where.keycloakId`) and the target lookup (`where.id`):

```ts
function mockUsers(opts: { actorId?: string; target?: unknown }) {
  mockDb.user.findUnique.mockImplementation((args: { where: { keycloakId?: string; id?: string } }) => {
    if (args.where.keycloakId) return Promise.resolve({ id: opts.actorId ?? "actor-db-id" })
    return Promise.resolve(opts.target ?? null)
  })
}
```

Update the import on line 40: `createUser` → `onboardUser`.

- [ ] **Step 2: Write the failing tests for `onboardUser`**

Replace the `describe('createUser — authorization', ...)` block with:

```ts
describe("onboardUser — authorization & ceiling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
    mockDb.user.findFirst.mockResolvedValue(null)
    mockUsers({})
  })

  it("rejects a non-admin (ghana/requester) onboarding a user", async () => {
    await expect(onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("rejects an OpCo admin trying to grant the admin role", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "admin" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_admin create a brand-new user and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockUsers({ actorId: "ga-db" })
    const result = await onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(result).toHaveProperty("id", "user-new")
    expect(mockDb.user.create).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("links an existing email instead of creating a new identity", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findFirst.mockResolvedValueOnce({ id: "existing", keycloakId: "kc-existing" })
    mockUsers({ actorId: "ga-db" })
    await onboardUser({
      name: "Existing", email: "exists@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "approver" }],
    })
    expect(mockDb.user.create).not.toHaveBeenCalled()
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t onboardUser`
Expected: FAIL — `onboardUser is not a function`.

- [ ] **Step 4: Implement `onboardUser`**

In `src/server/actions/users.ts`, update the import line and replace `createUser` (lines 10-56). New imports at top:

```ts
import { isGroupAdmin, canManageUsers, canAssignRole } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
```

Replace `createUser` with:

```ts
export async function onboardUser(input: {
  name: string
  email: string
  tempPassword: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  const session = await getAppSession()

  if (input.assignments.length === 0) throw new Error("At least one assignment is required")
  for (const a of input.assignments) {
    if (!canAssignRole(session.organizations, session.realmRoles, a.opcoSlug, a.role)) {
      throw new Error(`Forbidden: cannot assign ${a.role} in ${a.opcoSlug}`)
    }
  }

  const db = getPrisma()
  const existing = await db.user.findFirst({ where: { email: input.email } })

  // Keycloak identity work happens outside the DB transaction (external, non-rollbackable).
  let keycloakId: string
  if (existing) {
    keycloakId = existing.keycloakId
  } else {
    keycloakId = await createKeycloakUser(input.email, input.name, input.tempPassword)
  }
  for (const { opcoSlug } of input.assignments) {
    try {
      await assignToOrganization(keycloakId, opcoSlug)
    } catch (err) {
      console.warn(`[keycloak] org assignment skipped for ${opcoSlug}:`, err)
    }
  }

  return db.$transaction(async (tx) => {
    const user = existing
      ? existing
      : await tx.user.create({ data: { keycloakId, email: input.email, name: input.name } })

    for (const { opcoSlug, role } of input.assignments) {
      const opco = await tx.opCo.findUnique({ where: { slug: opcoSlug } })
      if (!opco) {
        console.warn(`[onboardUser] OpCo not found for slug: ${opcoSlug}`)
        continue
      }
      await tx.userOpCoAssignment.upsert({
        where: { userId_opcoId: { userId: user.id, opcoId: opco.id } },
        update: { role, isActive: true, endedAt: null },
        create: { userId: user.id, opcoId: opco.id, role },
      })
    }

    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: existing ? "user.link" : "user.onboard",
      targetUserId: user.id,
      summary: `${existing ? "Linked" : "Onboarded"} ${input.email} (${input.assignments.map((a) => `${a.role}@${a.opcoSlug}`).join(", ")})`,
      metadata: { assignments: input.assignments },
    })

    return user
  })
}
```

- [ ] **Step 5: Update the caller**

In `src/app/(dashboard)/users/onboard-wizard.tsx`:
- Line 11: `import { createUser } from "@/server/actions/users"` → `import { onboardUser } from "@/server/actions/users"`
- Line 89: `await createUser({ ... })` → `await onboardUser({ ... })`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t onboardUser`
Expected: PASS (all four cases).

- [ ] **Step 7: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS — no remaining references to `createUser`.

- [ ] **Step 8: Commit**

```bash
git add src/server/actions/users.ts src/app/(dashboard)/users/onboard-wizard.tsx src/test/actions/users-authz.test.ts
git commit -m "feat(users): onboardUser with add-by-email, role ceiling, and audit"
```

---

## Task 5: Privilege ceiling + audit in `setUserAssignments`

**Files:**
- Modify: `src/server/actions/users.ts:118-197`
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('setUserAssignments — authorization & diff', ...)` block:

```ts
it("rejects an OpCo admin promoting someone to admin (ceiling)", async () => {
  vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
  mockUsers({ actorId: "gha-db", target: { id: "target", keycloakId: "kc-target" } })
  mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
    { opco: { slug: "ghana", id: "opco-gh" }, role: "requester" },
  ])
  await expect(
    setUserAssignments("target", [{ opcoSlug: "ghana", role: "admin" }])
  ).rejects.toThrow(/Forbidden/)
})

it("writes an audit row when a group_admin changes a role", async () => {
  vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
  mockUsers({ actorId: "ga-db", target: { id: "target", keycloakId: "kc-target" } })
  mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
    { opco: { slug: "ghana", id: "opco-gh" }, role: "requester" },
  ])
  mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-gh", slug: "ghana" })
  await setUserAssignments("target", [{ opcoSlug: "ghana", role: "approver" }])
  expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
})
```

Also update the existing `beforeEach` in that block to use `mockUsers` instead of the old `mockDb.user.findUnique.mockResolvedValue(...)`:

```ts
beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockUsers({ actorId: "actor-db-id", target: { id: "target", keycloakId: "kc-target" } })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t setUserAssignments`
Expected: FAIL — ceiling test still allows admin; no audit row written.

- [ ] **Step 3: Add the ceiling check + wrap writes in a transaction with audit**

In `setUserAssignments`, replace the changed-slug authorization loop (current lines 154-161) with a per-role ceiling check:

```ts
  for (const slug of changed) {
    const desiredRole = desiredBySlug.get(slug)
    // Removal: authorize as "manage users in this OpCo". Add/role-change: authorize the specific role.
    const ok =
      desiredRole === undefined
        ? isGroupAdmin(session.realmRoles) || canManageUsers(session.organizations, session.realmRoles, slug)
        : canAssignRole(session.organizations, session.realmRoles, slug, desiredRole)
    if (!ok) throw new Error(`Forbidden: cannot manage roles in ${slug}`)
  }
```

Wrap the existing write loop (current lines 171-196) in a transaction and append audit at the end. Replace the loop with:

```ts
  await db.$transaction(async (tx) => {
    for (const slug of changed) {
      const desiredRole = desiredBySlug.get(slug)
      if (desiredRole === undefined) {
        const opcoId = current.find((a: { opco: { slug: string; id: string } }) => a.opco.slug === slug)!.opco.id
        await tx.userOpCoAssignment.update({
          where: { userId_opcoId: { userId, opcoId } },
          data: { isActive: false, endedAt: new Date() },
        })
      } else {
        const opco = await tx.opCo.findUnique({ where: { slug } })
        if (!opco) {
          console.warn(`[setUserAssignments] OpCo not found for slug: ${slug}`)
          continue
        }
        await tx.userOpCoAssignment.upsert({
          where: { userId_opcoId: { userId, opcoId: opco.id } },
          update: { role: desiredRole, isActive: true, endedAt: null },
          create: { userId, opcoId: opco.id, role: desiredRole },
        })
        try {
          await assignToOrganization(user.keycloakId, slug)
        } catch (err) {
          console.warn(`[keycloak] org assignment skipped for ${slug}:`, err)
        }
      }
    }

    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "role.update",
      targetUserId: userId,
      summary: `Updated assignments for user ${userId}: ${[...changed].join(", ")}`,
      metadata: { changed: [...changed], desired },
    })
  })
```

> Note: the existing self-lockout check (current lines 163-169) stays exactly where it is, before the transaction.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t setUserAssignments`
Expected: PASS (including the pre-existing diff/self-lockout cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): enforce role ceiling and audit in setUserAssignments"
```

---

## Task 6: Last-admin guard + audit in deactivate/reactivate

`assertNotLastAdmin` blocks an action that would leave an OpCo with zero active admins. Applied in `deactivateUser` (which ends all of a user's assignments) and re-used by `setUserAssignments` when an admin assignment is removed/demoted.

**Files:**
- Modify: `src/server/actions/users.ts:58-116` (and add helper)
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new describe block:

```ts
describe("deactivateUser — last-admin guard & audit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })

  it("blocks deactivating the last admin of an OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockUsers({
      actorId: "ga-db",
      target: {
        id: "target", keycloakId: "kc-target",
        opcoAssignments: [{ role: "admin", opco: { slug: "ghana", id: "opco-gh" } }],
      },
    })
    mockDb.userOpCoAssignment.count.mockResolvedValueOnce(0) // no OTHER active admins in ghana
    await expect(deactivateUser("target")).rejects.toThrow(/last admin/i)
  })

  it("allows deactivation when another admin remains, and writes audit", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockUsers({
      actorId: "ga-db",
      target: {
        id: "target", keycloakId: "kc-target",
        opcoAssignments: [{ role: "admin", opco: { slug: "ghana", id: "opco-gh" } }],
      },
    })
    mockDb.userOpCoAssignment.count.mockResolvedValueOnce(1) // another admin exists
    await deactivateUser("target")
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t "last-admin"`
Expected: FAIL — no guard yet; no audit row.

- [ ] **Step 3: Add `assertNotLastAdmin` and apply it in `deactivateUser`/`reactivateUser`**

Add this helper above `deactivateUser` in `src/server/actions/users.ts`:

```ts
// Throws if ending `userId`'s admin role in `opcoId` would leave the OpCo with zero active admins.
async function assertNotLastAdmin(
  db: { userOpCoAssignment: { count: (args: unknown) => Promise<number> } },
  opcoId: string,
  excludingUserId: string
) {
  const others = await db.userOpCoAssignment.count({
    where: { opcoId, role: "admin", isActive: true, userId: { not: excludingUserId } },
  })
  if (others === 0) throw new Error("Forbidden: cannot remove the last admin of an OpCo")
}
```

In `deactivateUser`, after the existing self-lockout check and before the Keycloak/DB writes, guard every OpCo where the target holds active `admin`, then wrap the writes + audit in a transaction:

```ts
  for (const a of user.opcoAssignments) {
    if (a.isActive && a.role === "admin") {
      await assertNotLastAdmin(db, a.opco.id, userId)
    }
  }

  await deactivateKeycloakUser(user.keycloakId)

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } })
    await tx.userOpCoAssignment.updateMany({
      where: { userId },
      data: { isActive: false, endedAt: new Date() },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "user.deactivate",
      targetUserId: userId,
      summary: `Deactivated user ${userId}`,
    })
  })
```

> The `deactivateUser` `include` must load `id` and `role` on assignments. Update its query (current line 64) to `include: { opcoAssignments: { where: { isActive: true }, include: { opco: true } } }` already returns `role` and `opco.id` — no change needed; just reference `a.opco.id` and `a.role`.

In `reactivateUser`, wrap its two writes + an audit row in a transaction the same way (no last-admin guard needed — reactivation can't orphan an OpCo):

```ts
  await reactivateKeycloakUser(user.keycloakId)

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: true } })
    await tx.userOpCoAssignment.updateMany({
      where: { userId },
      data: { isActive: true, endedAt: null },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "user.reactivate",
      targetUserId: userId,
      summary: `Reactivated user ${userId}`,
    })
  })
```

Also apply the guard in `setUserAssignments`: inside the transaction's removal/demotion branch, before ending or downgrading an `admin` assignment, call the guard. Add at the start of the `desiredRole === undefined` branch and the role-change branch when the current role was `admin`:

```ts
      const wasAdmin = currentBySlug.get(slug) === "admin"
      if (wasAdmin && desiredRole !== "admin") {
        const opcoId = current.find((a: { opco: { slug: string; id: string } }) => a.opco.slug === slug)!.opco.id
        await assertNotLastAdmin(tx, opcoId, userId)
      }
```

Place this at the top of the `for (const slug of changed)` loop body inside the transaction.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts`
Expected: PASS (the whole file — last-admin, ceiling, onboarding, diff, self-lockout).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): last-admin guard and audit on deactivate/reactivate/assignments"
```

---

## Task 7: Scope the Users directory to managed OpCos

The page currently lists users from **any** OpCo the caller belongs to (including ones where they're only a requester). Per the spec, an OpCo admin should see only users in OpCos they **manage**.

**Files:**
- Modify: `src/app/(dashboard)/users/page.tsx:12-26`

- [ ] **Step 1: Switch the scope source to `manageableOpCoSlugs`**

Replace lines 4 and 12-26 of `src/app/(dashboard)/users/page.tsx`:

Import (line 4):
```ts
import { manageableOpCoSlugs } from "@/lib/permissions"
```

Query block (replace lines 12-26):
```ts
  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)

  const users = await db.user.findMany({
    where:
      scope === "all"
        ? {}
        : { opcoAssignments: { some: { opco: { slug: { in: scope } } } } },
    include: {
      opcoAssignments: { include: { opco: true } },
    },
  })
```

> `manageableOpCoSlugs` returns `"all"` for `group_admin` and the admin-scoped slug list otherwise. A non-admin who somehow reaches this page gets an empty slug list → no users (the sidebar already hides the page from non-admins via `canManageAnyOpCo`).

- [ ] **Step 2: Type-check and run the dashboard render smoke test**

Run: `pnpm tsc --noEmit`
Expected: PASS.

Run: `pnpm vitest run src/app/dashboard-client.test.tsx`
Expected: PASS (unaffected, confirms no broken import graph).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/users/page.tsx"
git commit -m "fix(users): scope directory to managed OpCos, not all memberships"
```

---

## Task 8: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all suites (existing 89 + the new permissions/audit/users cases). Note the Testcontainers integration test needs Docker; if Docker is unavailable it fails (does not skip) — run with Docker up, or run `pnpm vitest run --exclude '**/integration/**'` and note the exclusion.

- [ ] **Step 2: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no errors.

- [ ] **Step 3: Run the deslop quality pass**

Per the project phase-gate, run the `deslop` skill over the diff for this plan and address findings before considering Plan A done.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(users): deslop pass for admin-governance foundation"
```

---

## Self-Review (author's check against the spec)

- **Schema** (spec §Data Model): TeamRole/TeamMember.role, CABMembership, AdminAuditLog, OpCo.archivedAt all in Task 1. ✓ (CAB/Team/OpCo *actions* are Plans B–D, intentionally.)
- **Privilege ceiling** (spec §Authority Matrix, "Assign/revoke admin"): `canAssignRole` (Task 2) + applied in onboardUser (Task 4) and setUserAssignments (Task 5). ✓
- **Add-by-email linking** (spec §Data Model 6): Task 4. ✓
- **Last-admin guard** (spec §Hard guards): `assertNotLastAdmin` in Task 6, applied in deactivate + setUserAssignments. ✓
- **Self-lockout** (spec §Hard guards): preserved unchanged (Tasks 5-6 notes). ✓
- **Scoped visibility** (spec §Hard guards): Task 7 (page) + reused `manageableOpCoSlugs`. ✓
- **Atomic audit** (spec §Transaction & audit pattern): `recordAdminAction` (Task 3) inside `$transaction` in Tasks 4-6. ✓
- **AdminAuditLog immutability** (spec §Testing): the helper exposes append-only; no update/delete path is added anywhere. A dedicated immutability integration test belongs with the Testcontainers suite — **carry into Task 8 / the integration plan** if not already covered by the existing audit-immutability pattern.
- **Out of scope** items (engagement rules, team→change links, realm-role assignment) are not touched. ✓
