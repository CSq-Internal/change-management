# Group Roles in the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `group_admin` / `group_auditor` are granted in the CMS (Users page) and stored on `User`; Keycloak becomes identity only, and the Keycloak Organizations mirror is removed.

**Architecture:** Two boolean flags on `User` are the source of truth. `enrichedJwt` builds `token.realmRoles` from them at sign-in and on the existing 60 s refresh, so the ~160 `realmRoles` checks are untouched. One server action, `setGroupRole`, is the only writer; it enforces the safety rules inside a Serializable transaction and records an admin audit row.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma 7 + adapter-pg, NextAuth v5 beta, Vitest + React Testing Library, Testcontainers (integration).

**Spec:** `docs/superpowers/specs/2026-10-18-group-roles-in-app-design.md`

## Global Constraints

- Branch: `feat/group-roles-in-app` (already exists, off `origin/dev`). PR targets `dev`, never `prod`.
- Commits: one per task, conventional style (`feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`). **No `Co-Authored-By` or any AI trailer** (user rule overrides the harness reminder).
- Keycloak: change only the `csquared-cms` client in `docker/keycloak/realms/csquared-realm.json`. The realm is shared with the DMP; leave realm-level settings (e.g. `organizationsEnabled`) and other clients alone.
- Keep `realmRoles` as the session field name.
- Never commit `AGENTS.md` changes (`next dev` rewrites it: `git checkout -- AGENTS.md`), `docs/CSquared-CMS-Group-Rollout-Plan.docx`, or `docs/CSquared-CMS-Project-Workplan.xlsx`.
- Gates at the end: `pnpm tsc --noEmit` clean; `pnpm vitest run` all green (integration suites need Docker); `pnpm lint` 0 errors and no more than the 62-warning baseline.
- i18n: every new user-visible string goes through `t(language, key)` with both `en` and `fr` entries in `src/lib/i18n.ts`.

## Review Focus

1. **Fresh database at `migrate deploy`** (CI, Testcontainers, a new local stack) has zero users: the guard must pass, not stop every fresh install. Pinned in Task 1 (`passes on an empty User table`).
2. **A seeded row relinked by verified email at first sign-in** (local `devops@csquared.com` seeded with `REPLACE_WITH_KEYCLOAK_SUB`): its flag must reach the session on that very sign-in, not one refresh later. Pinned in Task 2 (`carries the flags of a row relinked by verified email`).
3. **A group auditor with zero OpCo assignments** opening Edit user: the group-role control must save on its own, without the "at least one assignment" check of the OpCo rows blocking it. Pinned in Task 4 (`saves the group role without touching OpCo assignments`).
4. **An OpCo admin deactivating a group auditor** must be refused like a group admin target (reactivation goes through the same helper). Pinned in Task 3 (`refuses an OpCo admin deactivating a group auditor`).
5. **Setting the role a user already has** (e.g. `group_admin` → `group_admin`) must be a no-op that writes no audit row, so the log only shows real changes. Pinned in Task 3 (`writes nothing when the role is unchanged`).

---

## File map

| File | Change |
|---|---|
| `prisma/schema.prisma` | `User.isGroupAuditor`; remove `OpCo.keycloakOrgId` from the model |
| `prisma/migrations/20261019120000_group_roles_in_app/migration.sql` | new: guard, add column, make `keycloakOrgId` nullable |
| `prisma/seed.ts` | drop `keycloakOrgId`; demo devops gets `isGroupAdmin: true` |
| `src/server/actions/opcos.ts` | `createOpCo` no longer calls Keycloak |
| `src/server/keycloak.ts` | delete `createKeycloakOrg`, `assignToOrganization`; header comment |
| `src/auth.config.ts` | stop reading `resource_access` |
| `src/lib/auth-callbacks.ts` | `realmRoles` from flags at sign-in and refresh; no `isGroupAdmin` write |
| `src/types/next-auth.d.ts` | comment: roles come from the DB |
| `src/server/actions/users.ts` | `setGroupRole`; last-group-admin check in `deactivateUser`; helper covers auditors; remove org sync |
| `src/server/actions/access-requests.ts` | remove org sync |
| `src/app/(dashboard)/admin-audit/audit-client.tsx` | `"user.group_role"` in `ACTIONS` |
| `src/app/(dashboard)/users/{types.ts,page.tsx,user-list.tsx,edit-user-dialog.tsx,users-client.tsx}` | auditor flag, badge, group-role control |
| `src/lib/i18n.ts` | new `users.groupRole.*` / `users.groupAuditor` keys, en + fr |
| `docker/keycloak/realms/csquared-realm.json` | remove csquared-cms client roles, mapper, devops `clientRoles` entry |
| `docs/keycloak-realm-and-google-sso-setup.md`, `CLAUDE.md` | group roles are granted in the CMS |
| Tests | see each task |

---

### Task 1: Schema, migration guard, and OpCo without a Keycloak org

**Files:**
- Modify: `prisma/schema.prisma:76` (User) and `:107` (OpCo)
- Create: `prisma/migrations/20261019120000_group_roles_in_app/migration.sql`
- Modify: `prisma/seed.ts:14-47` and the demo devops upsert (`:63-71`)
- Modify: `src/server/actions/opcos.ts:7,48-60`
- Modify: `src/server/keycloak.ts` (delete `createKeycloakOrg`, lines 169-192)
- Create: `src/test/integration/group-roles-migration.test.ts`
- Modify: `src/test/actions/opcos.test.ts:15,33,41,55-72`
- Modify fixtures: `src/test/integration/{audit-immutability,isolation,reminders-overlap,self-service-requester-migration,admin-governance}.test.ts` (drop `keycloakOrgId: '…'` from every `opCo.create`)

**Interfaces:**
- Produces: `User.isGroupAuditor: boolean` on the Prisma client; `OpCo` has no `keycloakOrgId` field.

- [ ] **Step 1: Write the failing migration test**

`src/test/integration/group-roles-migration.test.ts`:

```ts
// @vitest-environment node
// The group-roles migration refuses to run on a database that has users but no active
// group admin: under the new model nobody could grant the role. migrate deploy already ran
// it on the empty test DB; the statements are re-runnable, so the test runs the file again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { startTestDb, stopTestDb, getTestDb } from '../db'

const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261019120000_group_roles_in_app/migration.sql'),
  'utf8',
)

beforeAll(startTestDb, 120_000)
afterAll(stopTestDb)

describe('group roles migration', () => {
  it('passes on an empty User table (fresh install)', async () => {
    await expect(getTestDb().$executeRawUnsafe(SQL)).resolves.toBeDefined()
  })

  it('stops when users exist but none is an active group admin', async () => {
    const db = getTestDb()
    await db.user.create({ data: { keycloakId: 'kc-ama', email: 'ama@csquared.com' } })
    await db.user.create({ data: { keycloakId: 'kc-old', email: 'old@csquared.com', isGroupAdmin: true, isActive: false } })
    await expect(db.$executeRawUnsafe(SQL)).rejects.toThrow(/No active group admin/)
  })

  it('passes once one active user is a group admin', async () => {
    const db = getTestDb()
    await db.user.update({ where: { email: 'ama@csquared.com' }, data: { isGroupAdmin: true } })
    await expect(db.$executeRawUnsafe(SQL)).resolves.toBeDefined()
  })

  it('adds isGroupAuditor defaulting to false and lets an OpCo have no Keycloak org', async () => {
    const db = getTestDb()
    expect(await db.user.findUnique({ where: { email: 'ama@csquared.com' } })).toMatchObject({ isGroupAuditor: false })
    await expect(db.opCo.create({ data: { slug: 'kenya', name: 'Kenya' } })).resolves.toMatchObject({ slug: 'kenya' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/test/integration/group-roles-migration.test.ts`
Expected: FAIL. `ENOENT` on the migration file (and, after that, a TS error on `isGroupAuditor`).

- [ ] **Step 3: Write the migration**

`prisma/migrations/20261019120000_group_roles_in_app/migration.sql`:

```sql
-- Group roles (group_admin, group_auditor) now live on "User" and are granted in the CMS.
-- Stop the deploy when users exist but none is an active group admin: nobody could grant
-- the role. A fresh database (no users yet) passes. Every statement is re-runnable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User")
     AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isGroupAdmin" AND "isActive") THEN
    RAISE EXCEPTION 'No active group admin: set "isGroupAdmin" on at least one active user before deploying (see docs/superpowers/specs/2026-10-18-group-roles-in-app-design.md, section 3)';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isGroupAuditor" BOOLEAN NOT NULL DEFAULT false;

-- The Keycloak Organizations mirror is gone. The column stays (nullable) so a code revert
-- still reads it; a later migration drops it.
ALTER TABLE "OpCo" ALTER COLUMN "keycloakOrgId" DROP NOT NULL;
```

- [ ] **Step 4: Update the Prisma schema**

In `prisma/schema.prisma`, model `User`, after `isGroupAdmin`:

```prisma
  isGroupAdmin   Boolean  @default(false)
  isGroupAuditor Boolean  @default(false)
```

In model `OpCo`, delete the line `keycloakOrgId String   @unique`. (The column stays in the database as nullable; Prisma ignores columns it doesn't model.)

Run: `pnpm prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 5: Remove `keycloakOrgId` from callers and fixtures**

`src/server/actions/opcos.ts`: delete the `createKeycloakOrg` import (line 7) and replace lines 48-60 with:

```ts
  return db.$transaction(async (tx) => {
    const opco = await tx.opCo.create({
      data: { slug: input.slug, name: input.name, locale: input.locale ?? "en" },
    })
```

`src/server/keycloak.ts`: delete `createKeycloakOrg` (the whole function). Leave the header comment; Task 5 rewrites it.

`prisma/seed.ts`: delete every `keycloakOrgId: '…'` property in the `opcos` array (6 entries). In the demo devops upsert:

```ts
  await prisma.user.upsert({
    where: { email: 'devops@csquared.com' },
    update: { isGroupAdmin: true },
    create: {
      keycloakId: 'REPLACE_WITH_KEYCLOAK_SUB',
      email: 'devops@csquared.com',
      name: 'Dev Admin',
      isGroupAdmin: true,
    },
  });
```

Integration fixtures: in each of the five files listed above, change `{ slug: 'x', name: 'X', keycloakOrgId: 'org-x' }` to `{ slug: 'x', name: 'X' }` (keep any other property such as `archivedAt`).

`src/test/actions/opcos.test.ts`: remove `createKeycloakOrg` from the `@/server/keycloak` mock (line 15), the import (line 33) and the `mockResolvedValue` in `beforeEach` (line 41). If the `vi.mock("@/server/keycloak", …)` block is then empty, delete it. Replace the two createOpCo tests (lines 55-72) with:

```ts
  it("creates an OpCo and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await createOpCo({ slug: "kenya", name: "Kenya", locale: "sw" })
    expect(mockDb.opCo.create).toHaveBeenCalledWith({
      data: { slug: "kenya", name: "Kenya", locale: "sw" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/integration/group-roles-migration.test.ts src/test/actions/opcos.test.ts && pnpm tsc --noEmit`
Expected: PASS (4 + opcos suite); tsc clean. If tsc reports another `keycloakOrgId` use, remove it the same way.

- [ ] **Step 7: Commit**

```bash
git add prisma src/server/actions/opcos.ts src/server/keycloak.ts src/test
git commit -m "feat(db): group auditor flag; OpCos no longer mirror a Keycloak org"
```

---

### Task 2: Session group roles come from the DB

**Files:**
- Modify: `src/lib/auth-callbacks.ts` (sign-in block and refresh block)
- Modify: `src/auth.config.ts:56-62`
- Modify: `src/types/next-auth.d.ts:19`
- Test: `src/test/auth-enrichment.test.ts`

**Interfaces:**
- Consumes: `User.isGroupAdmin`, `User.isGroupAuditor` (Task 1).
- Produces: `token.realmRoles` / `session.user.realmRoles` is `["group_admin"]`, `["group_auditor"]` or `[]`, from the DB.

- [ ] **Step 1: Write the failing tests**

In `src/test/auth-enrichment.test.ts`:

1. First test (line 41): change `mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })` to `mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })` (it still expects `['group_admin']`).
2. Delete the three tests "reads group roles from the csquared-cms client roles…", "marks isGroupAdmin true…", "clears isGroupAdmin (false)…" (lines 201-240) and put these in their place:

```ts
  it('takes group roles from the DB flags, not the token', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAuditor: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(token.realmRoles).toEqual(['group_auditor'])
  })

  it('gives no group role to a row without a flag, whatever Keycloak sends', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'x@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(token.realmRoles).toEqual([])
  })

  it('carries the flags of a row relinked by verified email', async () => {
    mockUsers({ bySub: null, byEmail: { id: 'u1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-new', email: 'devops@csquared.com', email_verified: true },
    })
    expect(userUpdate).toHaveBeenCalledWith({ where: { email: 'devops@csquared.com' }, data: { keycloakId: 'kc-new' } })
    expect(token.realmRoles).toEqual(['group_admin'])
  })

  it('no longer writes isGroupAdmin at sign-in, only the IdP name', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'ga@csquared.com', email_verified: true, name: 'Ama Mensah' },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-1' }, data: { name: 'Ama Mensah' } })
  })

  it('picks up a group-role grant on the refresh', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: [], orgsRefreshedAt: 0 },
      user: {}, account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])
    expect(token.realmRoles).toEqual(['group_admin'])
  })

  it('drops a revoked group role on the refresh', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: ['group_admin'], orgsRefreshedAt: 0 },
      user: {}, account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])
    expect(token.realmRoles).toEqual([])
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts`
Expected: FAIL. "takes group roles from the DB flags" gets `['group_admin']` (from the token); the refresh tests keep the token's old value; "no longer writes isGroupAdmin" sees `data: { isGroupAdmin: true, name: … }`.

- [ ] **Step 3: Implement**

`src/lib/auth-callbacks.ts`, after `orphan()`:

```ts
type GroupFlags = { isGroupAdmin: boolean; isGroupAuditor: boolean }

/** Group roles live on the User row and are granted in the CMS (setGroupRole), not Keycloak. */
function groupRoles(row: Partial<GroupFlags> | null | undefined): string[] {
  if (row?.isGroupAdmin) return ["group_admin"]
  if (row?.isGroupAuditor) return ["group_auditor"]
  return []
}
```

In the sign-in block:
- After `let isActive = existing?.isActive ?? true` add `let flags: Partial<GroupFlags> | null = existing`.
- Change the by-email lookup's select to `{ id: true, isActive: true, isGroupAdmin: true, isGroupAuditor: true }`.
- In the `else if (p.email_verified)` branch, after `isActive = byEmail.isActive` add `flags = byEmail`.
- Replace the block from the comment "Mirror the group_admin client role…" to the end of the `updateMany` call with:

```ts
    token.realmRoles = groupRoles(flags)

    // Names are IdP-sourced; re-sync the row when the token carries one. updateMany is a
    // no-op when no row matches (e.g. an unverified email that wasn't created/relinked).
    if (profileName) {
      await db.user.updateMany({ where: { keycloakId: sub }, data: { name: profileName } })
    }
```

In the refresh block:
- Change `select: { isActive: true }` on `stillLinked` to `select: { isActive: true, isGroupAdmin: true, isGroupAuditor: true }`.
- After `token.organizations = await loadOrganizations(db, sub)` add `token.realmRoles = groupRoles(stillLinked)`.
- Replace the comment sentence "Group roles (realmRoles) are Keycloak-sourced and intentionally not refreshed here." with "Group roles are reloaded with them."

`src/auth.config.ts`: delete the comment "Group-level roles are CMS *client* roles…" and the four statements after it (`clientId`, `resourceAccess`, `token.realmRoles = …`). Nothing else in that file changes.

`src/types/next-auth.d.ts:19`: change the comment to `// group roles from User.isGroupAdmin / isGroupAuditor: "group_admin" | "group_auditor"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts src/test/auth*.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc clean. If another existing test in the file asserted `userUpdateMany` with `isGroupAdmin`, update its expectation to the name-only form above; if it set no `name`, assert `expect(userUpdateMany).not.toHaveBeenCalled()`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-callbacks.ts src/auth.config.ts src/types/next-auth.d.ts src/test/auth-enrichment.test.ts
git commit -m "feat(auth): group roles come from the CMS database, not Keycloak"
```

---

### Task 3: `setGroupRole` and the safety rules

**Files:**
- Modify: `src/server/actions/users.ts` (imports, `assertCanActOnEveryRole`, `deactivateUser`, new `setGroupRole`)
- Modify: `src/app/(dashboard)/admin-audit/audit-client.tsx:15`
- Create: `src/test/actions/group-role.test.ts`

**Interfaces:**
- Consumes: `User.isGroupAuditor` (Task 1).
- Produces: `export type GroupRole = "group_admin" | "group_auditor"` and `export async function setGroupRole(userId: string, role: GroupRole | null): Promise<void>`, both exported from `src/server/actions/users.ts`. Error messages start with `Forbidden:` for permission failures.

- [ ] **Step 1: Write the failing tests**

`src/test/actions/group-role.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getAppSession: vi.fn() }))
vi.mock('@/server/keycloak', () => ({}))
vi.mock('@/server/email', () => ({ sendUserInvitationEmail: vi.fn() }))
vi.mock('@/server/approver-reassign', () => ({
  approverPendingFootprint: vi.fn(async () => []),
  notifyRemainingAndDetectOrphans: vi.fn(async () => ({ orphaned: [] })),
}))

const mockDb = {
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn(async () => ({})), count: vi.fn(async () => 1), upsert: vi.fn() },
  userOpCoAssignment: { updateMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []), count: vi.fn(async () => 1) },
  cABMembership: { updateMany: vi.fn(async () => ({})) },
  approverAssignment: { updateMany: vi.fn(async () => ({})) },
  adminAuditLog: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { setGroupRole, deactivateUser } from '@/server/actions/users'
import { getAppSession } from '@/lib/session'

const groupAdmin = { keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA', organizations: [], realmRoles: ['group_admin'] }
const ghanaAdmin = {
  keycloakId: 'kc-gha', email: 'gha@csquared.com', name: 'GhA',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [],
}
const target = (extra = {}) => ({
  id: 'target', keycloakId: 'kc-target', isActive: true, isGroupAdmin: false, isGroupAuditor: false, opcoAssignments: [], ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; keycloakId?: string } }) =>
    where.keycloakId ? { id: 'actor' } : target())
  mockDb.user.count.mockResolvedValue(1)
  vi.mocked(getAppSession).mockResolvedValue(groupAdmin as never)
})

describe('setGroupRole', () => {
  it('grants group_auditor, clears group_admin, and audits from → to', async () => {
    await setGroupRole('target', 'group_auditor')
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'target' }, data: { isGroupAdmin: false, isGroupAuditor: true },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'user.group_role', targetUserId: 'target',
        summary: 'Group role: none → group_auditor', metadata: { from: null, to: 'group_auditor' },
      }),
    }))
  })

  it('runs in a Serializable transaction', async () => {
    await setGroupRole('target', 'group_admin')
    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' })
  })

  it('writes nothing when the role is unchanged', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isGroupAdmin: true }) : { id: 'actor' })
    await setGroupRole('target', 'group_admin')
    expect(mockDb.user.update).not.toHaveBeenCalled()
    expect(mockDb.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not a group admin', async () => {
    vi.mocked(getAppSession).mockResolvedValue(ghanaAdmin as never)
    await expect(setGroupRole('target', 'group_auditor')).rejects.toThrow(/^Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses changing your own group role', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ keycloakId: 'kc-ga', isGroupAdmin: true }) : { id: 'actor' })
    await expect(setGroupRole('target', null)).rejects.toThrow(/Forbidden: cannot change your own group role/)
  })

  it('refuses removing the last active group admin', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isGroupAdmin: true }) : { id: 'actor' })
    mockDb.user.count.mockResolvedValue(0)
    await expect(setGroupRole('target', 'group_auditor')).rejects.toThrow(/last active group admin/)
    expect(mockDb.user.count).toHaveBeenCalledWith({
      where: { isGroupAdmin: true, isActive: true, id: { not: 'target' } },
    })
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an inactive target', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isActive: false }) : { id: 'actor' })
    await expect(setGroupRole('target', 'group_admin')).rejects.toThrow(/deactivated/)
  })

  it('refuses an unknown role value', async () => {
    await expect(setGroupRole('target', 'superuser' as never)).rejects.toThrow(/Invalid group role/)
  })
})

describe('deactivate / reactivate with group roles', () => {
  it('refuses deactivating the last active group admin', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(target({ isGroupAdmin: true }))
    mockDb.user.count.mockResolvedValue(0)
    await expect(deactivateUser('target')).rejects.toThrow(/last active group admin/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an OpCo admin deactivating a group auditor', async () => {
    // Ghana admin holds the right for the Ghana role, so only the auditor flag can refuse it.
    vi.mocked(getAppSession).mockResolvedValue(ghanaAdmin as never)
    mockDb.user.findUnique.mockResolvedValueOnce(target({
      isGroupAuditor: true,
      opcoAssignments: [{ id: 'a-gh', role: 'approver', isActive: true, opco: { slug: 'ghana', id: 'opco-ghana' } }],
    }))
    await expect(deactivateUser('target')).rejects.toThrow(/^Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/actions/group-role.test.ts`
Expected: FAIL. `setGroupRole` is not exported; the deactivate/reactivate tests fail because no last-group-admin check or auditor gate exists.

- [ ] **Step 3: Implement**

`src/server/actions/users.ts`:

Extend the helper so group auditors count as group-level targets:

```ts
function assertCanActOnEveryRole(
  session: { realmRoles: string[] },
  target: { isGroupAdmin: boolean; isGroupAuditor: boolean },
  rights: boolean[]
) {
  if (isGroupAdmin(session.realmRoles)) return
  if (target.isGroupAdmin || target.isGroupAuditor || rights.length === 0 || rights.includes(false)) {
    throw new Error("Forbidden: this user has roles you cannot manage. Ask a group admin.")
  }
}
```

Below `assertNotLastAdmin`, add:

```ts
// Throws if `excludingUserId` losing group admin would leave no active group admin.
async function assertNotLastGroupAdmin(client: Pick<Prisma.TransactionClient, "user">, excludingUserId: string) {
  const others = await client.user.count({
    where: { isGroupAdmin: true, isActive: true, id: { not: excludingUserId } },
  })
  if (others === 0) throw new Error("Forbidden: cannot remove the last active group admin")
}
```

In `deactivateUser`, after the `for` loop that calls `assertNotLastAdmin`, add:

```ts
  if (user.isGroupAdmin) await assertNotLastGroupAdmin(db, userId)
```

At the end of the file, add:

```ts
export type GroupRole = "group_admin" | "group_auditor"

/** Grant, change or remove a user's group role. Only a group admin may call it. */
export async function setGroupRole(userId: string, role: GroupRole | null) {
  const session = await getAppSession()
  if (role !== null && role !== "group_admin" && role !== "group_auditor") throw new Error("Invalid group role")
  if (!isGroupAdmin(session.realmRoles)) throw new Error("Forbidden: only a group admin can change group roles")

  const db = getPrisma()
  // Serializable: two admins demoting each other at once can't both pass the last-admin check.
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) throw new Error("User not found")
    if (user.keycloakId === session.keycloakId) throw new Error("Forbidden: cannot change your own group role")
    if (!user.isActive) throw new Error("This user is deactivated. Reactivate them first.")

    const from: GroupRole | null = user.isGroupAdmin ? "group_admin" : user.isGroupAuditor ? "group_auditor" : null
    if (from === role) return
    if (from === "group_admin") await assertNotLastGroupAdmin(tx, userId)

    await tx.user.update({
      where: { id: userId },
      data: { isGroupAdmin: role === "group_admin", isGroupAuditor: role === "group_auditor" },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "user.group_role",
      targetUserId: userId,
      summary: `Group role: ${from ?? "none"} → ${role ?? "none"}`,
      metadata: { from, to: role },
    })
  }, { isolationLevel: "Serializable" })
}
```

`src/app/(dashboard)/admin-audit/audit-client.tsx` line 15: add `"user.group_role"` after `"role.update"`:

```ts
  "user.onboard", "user.link", "user.deactivate", "user.reactivate", "role.update", "user.group_role",
```

(The filter shows raw action strings, so no label keys are needed; see Ruling R2.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/actions/group-role.test.ts src/test/actions/users-authz.test.ts src/test/app/admin-audit && pnpm tsc --noEmit`
Expected: PASS. If `users-authz.test.ts` deactivate tests fail on `mockDb.user.count is not a function`, add `count: vi.fn().mockResolvedValue(1)` to its `mockDb.user` (the existing group-admin-target test there now also reaches the new check).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts "src/app/(dashboard)/admin-audit/audit-client.tsx" src/test/actions
git commit -m "feat(users): group admins grant and revoke group roles, with an audit row"
```

---

### Task 4: Users page control

**Files:**
- Modify: `src/app/(dashboard)/users/types.ts`, `page.tsx:31-37`, `user-list.tsx:73-77,117-120`, `edit-user-dialog.tsx`, `users-client.tsx:128-137`
- Modify: `src/lib/i18n.ts` (en block near line 599, fr block near line 1495)
- Create: `src/test/app/users/edit-user-dialog.test.tsx`
- Modify: `src/test/app/users/user-list.test.tsx`

**Interfaces:**
- Consumes: `setGroupRole(userId, role)` and `GroupRole` (Task 3).
- Produces: `DbUser.isGroupAuditor: boolean`; `EditUserDialog` prop `canSetGroupRole: boolean`.

- [ ] **Step 1: Write the failing tests**

`src/test/app/users/edit-user-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const setGroupRole = vi.fn(async () => undefined)
const setUserAssignments = vi.fn(async () => undefined)
vi.mock('@/server/actions/users', () => ({ setGroupRole, setUserAssignments }))
vi.mock('@/components/ui/toaster', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import EditUserDialog from '@/app/(dashboard)/users/edit-user-dialog'
import type { DbUser } from '@/app/(dashboard)/users/types'

const auditor: DbUser = {
  id: 'u1', name: 'Ada', email: 'ada@csquared.com', isActive: true, isGroupAdmin: false, isGroupAuditor: true,
  accessStatus: null, opcoAssignments: [],
}

function renderDialog(canSetGroupRole: boolean) {
  return render(
    <EditUserDialog user={auditor} language="en" opcos={[]} canSetGroupRole={canSetGroupRole} onClose={vi.fn()} onSaved={vi.fn()} />
  )
}

describe('EditUserDialog group role', () => {
  it('hides the group role control from a viewer who is not a group admin', () => {
    renderDialog(false)
    expect(screen.queryByLabelText('Group role')).not.toBeInTheDocument()
  })

  it('shows the current group role to a group admin', () => {
    renderDialog(true)
    expect(screen.getByLabelText('Group role')).toHaveValue('group_auditor')
  })

  it('saves the group role without touching OpCo assignments', async () => {
    renderDialog(true)
    fireEvent.change(screen.getByLabelText('Group role'), { target: { value: 'group_admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save group role' }))
    await waitFor(() => expect(setGroupRole).toHaveBeenCalledWith('u1', 'group_admin'))
    expect(setUserAssignments).not.toHaveBeenCalled()
  })

  it('sends null for None', async () => {
    renderDialog(true)
    fireEvent.change(screen.getByLabelText('Group role'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save group role' }))
    await waitFor(() => expect(setGroupRole).toHaveBeenCalledWith('u1', null))
  })
})
```

In `src/test/app/users/user-list.test.tsx`: add `isGroupAuditor: false,` after every `isGroupAdmin: …,` in the fixtures, and add this test inside the existing `describe`:

```tsx
  it('lists a group auditor with no OpCo under access, with a Group auditor badge', () => {
    const auditor: DbUser = { ...groupAdmin, id: 'a1', name: 'Abi', isGroupAdmin: false, isGroupAuditor: true }
    renderList([auditor])
    expect(screen.getByText('Group auditor')).toBeInTheDocument()
    expect(screen.queryByText('No access / Pending')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/test/app/users`
Expected: FAIL. No "Group role" label; no "Group auditor" badge; TS error on `isGroupAuditor` / `canSetGroupRole`.

- [ ] **Step 3: Implement**

`src/lib/i18n.ts`, en block next to `"users.groupAdmin"`:

```ts
    "users.groupAuditor": "Group auditor",
    "users.groupRole.label": "Group role",
    "users.groupRole.none": "None",
    "users.groupRole.save": "Save group role",
    "users.groupRole.saved": "Group role updated",
```

fr block next to `"users.groupAdmin"`:

```ts
    "users.groupAuditor": "Auditeur groupe",
    "users.groupRole.label": "Rôle groupe",
    "users.groupRole.none": "Aucun",
    "users.groupRole.save": "Enregistrer le rôle groupe",
    "users.groupRole.saved": "Rôle groupe mis à jour",
```

`types.ts`: add `isGroupAuditor: boolean` after `isGroupAdmin: boolean`.

`page.tsx`: add `isGroupAuditor: u.isGroupAuditor,` after `isGroupAdmin: u.isGroupAdmin,`.

`user-list.tsx`: after the `user.isGroupAdmin && (…)` badge, add:

```tsx
          {user.isGroupAuditor && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {t(language, "users.groupAuditor")}
            </span>
          )}
```

and replace the `hasAccess` comment + line with:

```tsx
  // Group roles give access without an OpCo assignment, so keep those users out of "No access".
  const hasAccess = (u: DbUser) => u.opcoAssignments.length > 0 || u.isGroupAdmin || u.isGroupAuditor
```

`edit-user-dialog.tsx`:
- Import: `import { setGroupRole, setUserAssignments, type GroupRole } from "@/server/actions/users"`.
- Props: add `canSetGroupRole: boolean` to `EditUserDialogProps` and the destructuring.
- State, after the `rows` state:

```tsx
  const currentGroupRole: GroupRole | "" = user.isGroupAdmin ? "group_admin" : user.isGroupAuditor ? "group_auditor" : ""
  const [groupRole, setGroupRoleValue] = useState<GroupRole | "">(currentGroupRole)

  const saveGroupRole = () => {
    startTransition(async () => {
      try {
        await setGroupRole(user.id, groupRole || null)
        toast({ title: t(language, "users.groupRole.saved"), description: user.email, variant: "success" })
        onSaved()
      } catch (err) {
        toast({
          title: t(language, "common.failed"),
          description: err instanceof Error ? err.message : t(language, "common.unknownError"),
          variant: "error",
        })
      }
    })
  }
```

- JSX, first child of `<CardContent className="space-y-4">`:

```tsx
          {canSetGroupRole && (
            <div className="flex items-center gap-2 border-b border-border pb-4">
              <label htmlFor="group-role" className="w-40 text-sm">{t(language, "users.groupRole.label")}</label>
              <select
                id="group-role"
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={groupRole}
                onChange={(e) => setGroupRoleValue(e.target.value as GroupRole | "")}
              >
                <option value="">{t(language, "users.groupRole.none")}</option>
                <option value="group_admin">{t(language, "users.groupAdmin")}</option>
                <option value="group_auditor">{t(language, "users.groupAuditor")}</option>
              </select>
              <Button variant="outline" onClick={saveGroupRole} disabled={isPending || groupRole === currentGroupRole}>
                {t(language, "users.groupRole.save")}
              </Button>
            </div>
          )}
```

`users-client.tsx`: import `isGroupAdmin` from `@/lib/permissions` (add to the existing import if there is one), and pass to `<EditUserDialog … />`:

```tsx
          canSetGroupRole={session ? isGroupAdmin(session.user.realmRoles) : false}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/app/users && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/users" src/lib/i18n.ts src/test/app/users
git commit -m "feat(users): group role control on Edit user, and a Group auditor badge"
```

---

### Task 5: Remove the Keycloak Organizations sync

**Files:**
- Modify: `src/server/keycloak.ts` (delete `assignToOrganization`; header comment)
- Modify: `src/server/actions/users.ts:8,79-84,300-301,309,346-351`
- Modify: `src/server/actions/access-requests.ts:11,180-184,301-305`
- Modify tests: `src/test/actions/users-authz.test.ts:16,371,436-455`, `src/test/actions/users-reconcile.test.ts:13`, `src/test/actions/access-requests.test.ts:6,80,107,211`

**Interfaces:**
- Consumes: nothing new.
- Produces: `@/server/keycloak` exports exactly `getAdminToken`, `createOrFindKeycloakUser`, `verifyAdoptedKeycloakUser`.

- [ ] **Step 1: Change the tests to the new expectation**

`src/test/actions/access-requests.test.ts`: replace the line-6 mock with `vi.mock("@/server/keycloak", () => ({}))`; delete the import on line 80. Replace the assertions on lines 107 and 211 with nothing (delete them). Then pin the removal with a new `src/test/actions/keycloak-surface.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import * as kc from "@/server/keycloak"

describe("Keycloak admin surface", () => {
  it("keeps account provisioning and drops the Organizations mirror", () => {
    expect(Object.keys(kc).sort()).toEqual(["createOrFindKeycloakUser", "getAdminToken", "verifyAdoptedKeycloakUser"])
  })
})
```

`src/test/actions/users-authz.test.ts`: delete `assignToOrganization` from the hoisted `kc` (line 16), the assertion on line 371, and the whole test at lines 436-455 (the "Keycloak calls wait until the transaction commits" test). Its name is in the `it(` line just above line 436.

`src/test/actions/users-reconcile.test.ts`: delete `assignToOrganization` from the mock (line 13).

- [ ] **Step 2: Run to verify the new surface test fails**

Run: `pnpm vitest run src/test/actions/keycloak-surface.test.ts`
Expected: FAIL. The export list still contains `assignToOrganization`.

- [ ] **Step 3: Implement**

`src/server/keycloak.ts`: delete `assignToOrganization`. Header comment: in place of the removed Organizations sentence, write:

```ts
// requirement). Group roles and OpCo membership live in the CMS database; Keycloak only
// holds the account. The realm name is derived from KEYCLOAK_ISSUER (or
```

(Fix up the surrounding lines so the comment reads as one paragraph.)

`src/server/actions/users.ts`:
- Line 8: `import { createOrFindKeycloakUser, verifyAdoptedKeycloakUser } from "@/server/keycloak"`.
- Delete the `for (const { opcoSlug } of input.assignments) { try { await assignToOrganization(…) } … }` loop in `onboardUser`.
- In `setUserAssignments`: delete the comment "Keycloak calls wait until the transaction commits…" (2 lines), `const kcAssign: string[] = []`, `kcAssign.push(slug)`, and the trailing `for (const slug of kcAssign) { … }` loop.

`src/server/actions/access-requests.ts`: delete the import on line 11 and both `try { await assignToOrganization(…) } catch … { console.warn(…) }` blocks (after `joinOpCo`'s transaction and after `approveAccessRequest`'s transaction).

- [ ] **Step 4: Run to verify**

Run: `pnpm vitest run src/test/actions && pnpm tsc --noEmit && grep -rn "assignToOrganization\|createKeycloakOrg" src`
Expected: PASS, tsc clean, grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/server src/test/actions
git commit -m "chore(keycloak): drop the Organizations mirror nobody reads"
```

---

### Task 6: Keycloak realm, docs, CLAUDE.md

**Files:**
- Modify: `docker/keycloak/realms/csquared-realm.json`
- Modify: `docs/keycloak-realm-and-google-sso-setup.md` (sections 3, 4, 5, 8)
- Modify: `CLAUDE.md` (Auth paragraph)
- Test: `src/test/keycloak-realm.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`src/test/keycloak-realm.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const realm = JSON.parse(readFileSync("docker/keycloak/realms/csquared-realm.json", "utf8"))
const cms = realm.clients.find((c: { clientId: string }) => c.clientId === "csquared-cms")

describe("local realm", () => {
  it("defines no CMS group roles in Keycloak", () => {
    expect(realm.roles?.client?.["csquared-cms"]).toBeUndefined()
    expect(cms.protocolMappers ?? []).not.toContainEqual(expect.objectContaining({ protocolMapper: "oidc-usermodel-client-role-mapper" }))
    for (const u of realm.users) expect(u.clientRoles?.["csquared-cms"]).toBeUndefined()
  })

  it("keeps the admin service account able to provision users", () => {
    const sa = realm.users.find((u: { username: string }) => u.username === "service-account-csquared-cms-admin")
    expect(sa.clientRoles["realm-management"]).toContain("manage-users")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/test/keycloak-realm.test.ts`
Expected: FAIL on the first test (the client roles and mapper exist).

- [ ] **Step 3: Edit the realm JSON**

Run (edits only the `csquared-cms` pieces and keeps 2-space formatting):

```bash
node -e '
const fs=require("fs"),p="docker/keycloak/realms/csquared-realm.json",d=JSON.parse(fs.readFileSync(p,"utf8"));
delete d.roles.client["csquared-cms"]; if(!Object.keys(d.roles.client).length) delete d.roles.client;
const c=d.clients.find(c=>c.clientId==="csquared-cms");
c.protocolMappers=(c.protocolMappers||[]).filter(m=>m.protocolMapper!=="oidc-usermodel-client-role-mapper");
if(!c.protocolMappers.length) delete c.protocolMappers;
for(const u of d.users){ if(u.clientRoles){ delete u.clientRoles["csquared-cms"]; if(!Object.keys(u.clientRoles).length) delete u.clientRoles } }
fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n")'
git diff --stat docker/keycloak/realms/csquared-realm.json
```

Expected: one file changed, deletions only (plus formatting identical elsewhere). If the diff shows unrelated reformatting, revert with `git checkout -- docker/keycloak/realms/csquared-realm.json` and make the three deletions by hand instead.

- [ ] **Step 4: Update the docs**

`docs/keycloak-realm-and-google-sso-setup.md`:
- Replace section **3** and section **4** (headings "CMS client roles (scoped to this app)" and "Put client roles into the ID token (required)") with one section:

```markdown
## 3. Group roles live in the CMS

`group_admin` and `group_auditor` are not Keycloak roles. A group admin grants them in the CMS
(Users → Edit user → Group role), and every change is in the admin audit log. Keycloak holds
only the account. Do not add client roles or a client-role mapper to `csquared-cms`.
```

- Renumber the following sections (4 → … ) so numbering stays continuous.
- In "Bootstrap admin user", replace the sentence "Assign the `csquared-cms` client role `group_admin`. This alone yields group tier on…" (through the end of that sentence) with: "Sign in once, then mark the account as group admin in the database: `UPDATE \"User\" SET \"isGroupAdmin\" = true WHERE email = '<email>';`. After that, grant further group roles from the Users page."
- In "Production DB", replace "(email link + `group_admin` client role → group tier)" with "(email link; group tier comes from `User.isGroupAdmin`)".

`CLAUDE.md`, Auth paragraph: replace "which attach the user's OpCo assignments and realm roles to the session." with "which attach the user's OpCo assignments and group roles (`User.isGroupAdmin` / `isGroupAuditor`, granted in the CMS on the Users page; Keycloak holds identity only) to the session as `realmRoles`."

- [ ] **Step 5: Run to verify**

Run: `pnpm vitest run src/test/keycloak-realm.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docker/keycloak/realms/csquared-realm.json docs/keycloak-realm-and-google-sso-setup.md CLAUDE.md src/test/keycloak-realm.test.ts
git commit -m "docs(keycloak): group roles are granted in the CMS, not Keycloak"
```

---

### Task 7: Full gates and Playwright smoke

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run the gates**

```bash
pnpm tsc --noEmit
mkdir -p .superpowers && pnpm vitest run > .superpowers/vitest.log 2>&1; tail -20 .superpowers/vitest.log
pnpm lint 2>&1 | tail -5
```

Expected: tsc no output; vitest all files pass (Docker running for integration); lint `0 errors`, warnings ≤ 62.

- [ ] **Step 2: Start the isolated smoke stack**

```bash
docker run -d --name cms-smoke-pg2 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=csquared_cms -p 5433:5432 postgres:16
docker run -d --name cms-smoke-kc -p 8081:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -v "$PWD/docker/keycloak/realms:/opt/keycloak/data/import" quay.io/keycloak/keycloak:26.6.2 start-dev --import-realm
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/csquared_cms
pnpm prisma migrate deploy && SEED_DEMO=1 pnpm prisma db seed
KEYCLOAK_ISSUER=http://localhost:8081/realms/csquared KEYCLOAK_CLIENT_SECRET=csquared-dev-secret \
  KEYCLOAK_ADMIN_CLIENT_SECRET=csquared-admin-dev-secret RESEND_API_KEY= GOOGLE_SERVICE_ACCOUNT_KEY= pnpm dev
```

Never touch `csquared-dmp-*` containers. Create a second Keycloak user (`auditor@csquared.com`, password `Smoke2026$`, email verified) through the Keycloak admin API.

- [ ] **Step 3: Drive the smoke with the Playwright MCP**

1. Sign in as `devops@csquared.com` / `Admin2025$`. Expected: group-level nav visible (OpCos page reachable), proving the seeded flag reached the session via the email relink.
2. In a second browser context, sign in as `auditor@csquared.com`; it lands on `/request-access`. Join Ghana as requester. Expected: no Audits nav entry.
3. As devops: Users → Edit `auditor@csquared.com` → Group role = Group auditor → Save group role. Expected: success toast; Group auditor badge on the row.
4. In the auditor context, wait ≥ 60 s and navigate. Expected: audit pages reachable without signing out.
5. As devops: open Edit on your own row, set Group role = None, save. Expected: error toast "Forbidden: cannot change your own group role".
6. Admin audit page, filter `user.group_role`. Expected: one row, "Group role: none → group_auditor".
7. Console: 0 errors.

Then tear down: `docker rm -f cms-smoke-pg2 cms-smoke-kc` and `git checkout -- AGENTS.md`.

- [ ] **Step 4: Fix anything that failed**, TDD, one commit per fix. Then finish with superpowers:finishing-a-development-branch (PR into `dev`). The PR body must list the **prod checklist** from spec section 3 and state that dev (Neon) needs one active `isGroupAdmin` user **before merge**, or the dev deploy's migrate step stops on the guard.

---

## Rulings made while planning (deviations from the spec)

- **R1. Migration guard passes on an empty `User` table.** The spec's guard ("raise when no active group admin") would stop every fresh `migrate deploy` (CI, Testcontainers, new local stack). Cost if wrong: a wiped prod DB would migrate without a group admin. Recovered by the one-line bootstrap SQL in the Keycloak doc.
- **R2. No en/fr labels for `user.group_role`.** The admin-audit filter shows raw action strings for every action today; adding labels for one would be inconsistent. Cost if wrong: one more key pair later.
- **R3. Group auditors count as group-level targets in `assertCanActOnEveryRole`.** So an OpCo admin can neither deactivate nor reactivate one. The spec only named reactivation; deactivation by an OpCo admin would let them remove a group-wide role they cannot grant. Cost if wrong: OpCo admins ask a group admin to deactivate auditors.
- **R4. Setting the current role again is a no-op with no audit row.** Cost if wrong: none observable.
- **R5. The group-role control saves on its own button**, separate from OpCo rows, so a group-role-only user (no OpCo) can be edited. Cost if wrong: one extra click.
