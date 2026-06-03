# User Management Gaps 1–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire deactivate + reactivate, add edit role/OpCo-assignments, support multi-assignment onboarding, rename the wizard's third step to "Review", and fix the admin-gating bug — all verified with mocked unit tests.

**Architecture:** Decompose the Users feature into small client components + a shared gating helper. Server actions stay the source of truth: `createUser` (already multi-assignment), new `reactivateUser`, and a declarative `setUserAssignments` that diffs the desired set server-side. No DB schema change (`isActive`/`endedAt` already exist); no new UI dependencies.

**Tech Stack:** Next.js App Router (server components + server actions), NextAuth (Keycloak), Prisma v7 + Postgres, Zustand (UI store), Vitest + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-03-user-management-gaps-design.md`

---

## File Structure

**Modify**
- `src/lib/permissions.ts` — add `canManageAnyOpCo`, `manageableOpCoSlugs`.
- `src/components/app-shell.tsx` — gate the User Management nav with `canManageAnyOpCo`.
- `src/app/(dashboard)/teams/teams-client.tsx` — gate admin UI with `canManageAnyOpCo`.
- `src/server/keycloak.ts` — add `reactivateKeycloakUser`.
- `src/server/actions/users.ts` — add `reactivateUser`, `setUserAssignments`; self-lockout guard in `deactivateUser`.
- `src/app/(dashboard)/users/page.tsx` — surface inactive users; serialize per-assignment `isActive`.
- `src/app/(dashboard)/users/users-client.tsx` — reduce to a container that wires the new components.
- `src/lib/i18n.ts` — new keys (en + fr).
- `src/test/lib/permissions.test.ts` — cases for the new helpers.
- `src/test/actions/users-authz.test.ts` — cases for `reactivateUser`, `setUserAssignments`, deactivate self-lockout.

**Add**
- `src/app/(dashboard)/users/types.ts` — shared `DbUser` type.
- `src/app/(dashboard)/users/confirm-dialog.tsx` — reusable confirm overlay.
- `src/app/(dashboard)/users/user-list.tsx` — user rows + filter + per-row actions.
- `src/app/(dashboard)/users/onboard-wizard.tsx` — multi-assignment onboarding wizard.
- `src/app/(dashboard)/users/edit-user-dialog.tsx` — edit roles/assignments.
- `src/test/app/users/user-list.test.tsx` — render smoke test.

**Conventions:** path alias `@/*` → `src/*`. Commit messages use Conventional Commits and **no `Co-Authored-By` trailer**. Targeted test run: `pnpm test <path>`. Full suite: `pnpm test`.

---

## Task 1: Gating helpers (gap 4)

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/test/lib/permissions.test.ts`. Extend the existing import on line 2 to include the new helpers, then append the describes:

```ts
import { canApprove, canAudit, canManageUsers, isGroupAdmin, canManageAnyOpCo, manageableOpCoSlugs } from '@/lib/permissions'
```

```ts
describe('canManageAnyOpCo', () => {
  it('true when admin in any opco (even a non-first one)', () => {
    const orgs: SessionOrganization[] = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] },
    ]
    expect(canManageAnyOpCo(orgs, [])).toBe(true)
  })
  it('false when no admin role anywhere', () => {
    const orgs: SessionOrganization[] = [{ id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }]
    expect(canManageAnyOpCo(orgs, [])).toBe(false)
  })
  it('true for group_admin with no orgs', () => {
    expect(canManageAnyOpCo([], ['group_admin'])).toBe(true)
  })
})

describe('manageableOpCoSlugs', () => {
  it('returns "all" for group_admin', () => {
    expect(manageableOpCoSlugs([], ['group_admin'])).toBe('all')
  })
  it('returns only admin opco slugs for an opco admin', () => {
    const orgs: SessionOrganization[] = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['admin'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['requester'] },
    ]
    expect(manageableOpCoSlugs(orgs, [])).toEqual(['ghana'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: FAIL — `canManageAnyOpCo is not a function` / `manageableOpCoSlugs is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/permissions.ts`:

```ts
export function canManageAnyOpCo(
  organizations: SessionOrganization[],
  realmRoles: string[]
): boolean {
  return isGroupAdmin(realmRoles) || organizations.some((o) => o.roles.includes("admin"))
}

export function manageableOpCoSlugs(
  organizations: SessionOrganization[],
  realmRoles: string[]
): string[] | "all" {
  if (isGroupAdmin(realmRoles)) return "all"
  return organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(users): add canManageAnyOpCo + manageableOpCoSlugs gating helpers"
```

---

## Task 2: Wire the gating fix into the nav + teams (gap 4)

This is a mechanical swap of the buggy `organizations[0]`-based check. `users-client.tsx` is intentionally **not** touched here — it is rewritten in Task 11.

**Files:**
- Modify: `src/components/app-shell.tsx:9` and `:118-124`
- Modify: `src/app/(dashboard)/teams/teams-client.tsx:6` and `:30-36`

- [ ] **Step 1: Update the app-shell import**

In `src/components/app-shell.tsx`, change line 9 from:

```ts
import { canManageUsers } from "@/lib/permissions"
```

to:

```ts
import { canManageAnyOpCo } from "@/lib/permissions"
```

- [ ] **Step 2: Update the app-shell gating call**

Replace the `showAdminNav` block (currently lines 118-124):

```ts
  const showAdminNav = session
    ? canManageUsers(
        session.user.organizations,
        session.user.realmRoles,
        session.user.organizations[0]?.alias ?? ""
      )
    : false
```

with:

```ts
  const showAdminNav = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
```

- [ ] **Step 3: Update teams-client import**

In `src/app/(dashboard)/teams/teams-client.tsx`, change line 6 from:

```ts
import { canManageUsers } from "@/lib/permissions"
```

to:

```ts
import { canManageAnyOpCo } from "@/lib/permissions"
```

- [ ] **Step 4: Update the teams-client gating call**

Replace the `isAdmin` block (currently lines 30-36):

```ts
  const isAdmin = session
    ? canManageUsers(
        session.user.organizations,
        session.user.realmRoles,
        session.user.organizations[0]?.alias ?? ""
      )
    : false
```

with:

```ts
  const isAdmin = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
```

- [ ] **Step 5: Verify types, lint, and full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell.tsx src/app/\(dashboard\)/teams/teams-client.tsx
git commit -m "fix(users): gate admin UI on admin-in-any-opco, not organizations[0]"
```

---

## Task 3: `deactivateUser` self-lockout guard

**Files:**
- Modify: `src/server/actions/users.ts` (the `deactivateUser` function)
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/test/actions/users-authz.test.ts`, inside (or after) the existing `describe('deactivateUser — authorization', ...)`:

```ts
describe('deactivateUser — self-lockout', () => {
  it('rejects deactivating yourself', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-self', email: 's@csquared.com', name: 'S',
      organizations: [{ id: 'o', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
      realmRoles: [],
    })
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'self', keycloakId: 'kc-self',
      opcoAssignments: [{ opco: { slug: 'ghana' }, isActive: true }],
    })
    await expect(deactivateUser('self')).rejects.toThrow(/yourself/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/actions/users-authz.test.ts`
Expected: FAIL — the call resolves instead of throwing `/yourself/`.

- [ ] **Step 3: Add the guard**

In `src/server/actions/users.ts`, in `deactivateUser`, immediately after the `if (!user) throw new Error("User not found")` line, insert:

```ts
  if (user.keycloakId === session.keycloakId) {
    throw new Error("Forbidden: cannot deactivate yourself")
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/actions/users-authz.test.ts`
Expected: PASS (new case + all pre-existing deactivate cases still pass — their callers differ from the target).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): block self-deactivation in deactivateUser"
```

---

## Task 4: `reactivateUser` action + Keycloak helper

**Files:**
- Modify: `src/server/keycloak.ts` (add `reactivateKeycloakUser`)
- Modify: `src/server/actions/users.ts` (add `reactivateUser`, import the helper)
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Add the Keycloak helper**

Append to `src/server/keycloak.ts`:

```ts
export async function reactivateKeycloakUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const res = await fetch(
    `${KC_BASE}/admin/realms/csquared/users/${keycloakUserId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: true }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to reactivate Keycloak user: ${res.status} ${await res.text()}`)
  }
}
```

- [ ] **Step 2: Extend the test mocks, then write the failing tests**

In `src/test/actions/users-authz.test.ts`:

(a) Add `reactivateKeycloakUser` to the keycloak mock factory:

```ts
vi.mock('@/server/keycloak', () => ({
  createKeycloakUser: vi.fn().mockResolvedValue('kc-new'),
  assignToOrganization: vi.fn().mockResolvedValue(undefined),
  deactivateKeycloakUser: vi.fn().mockResolvedValue(undefined),
  reactivateKeycloakUser: vi.fn().mockResolvedValue(undefined),
}))
```

(b) Add `reactivateUser` (and, ahead of Task 5, `setUserAssignments`) to the action import:

```ts
import { createUser, deactivateUser, reactivateUser, setUserAssignments } from '@/server/actions/users'
```

(c) Append the describe:

```ts
describe('reactivateUser — authorization', () => {
  const inactiveTarget = {
    id: 'target', keycloakId: 'kc-target', isActive: false,
    opcoAssignments: [{ opco: { slug: 'ghana' } }],
  }
  it('rejects a non-admin caller', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).rejects.toThrow(/Forbidden/)
  })
  it('allows a group_admin to reactivate', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).resolves.toBeUndefined()
  })
  it('allows a ghana admin to reactivate a ghana user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).resolves.toBeUndefined()
  })
})
```

> Note: `setUserAssignments` is imported now (Task 5 adds its tests). It must exist as an export by the end of Task 5; importing it before then will fail typecheck, so run Task 4's tests with the targeted command below, which only needs `reactivateUser`. If your runner errors on the unresolved import, hold the import addition until Task 5 Step 1.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/test/actions/users-authz.test.ts -t reactivateUser`
Expected: FAIL — `reactivateUser is not a function`.

- [ ] **Step 4: Implement `reactivateUser`**

In `src/server/actions/users.ts`, update the keycloak import to include the new helper:

```ts
import { createKeycloakUser, assignToOrganization, deactivateKeycloakUser, reactivateKeycloakUser } from "@/server/keycloak"
```

Append the action:

```ts
export async function reactivateUser(userId: string) {
  const session = await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { opcoAssignments: { include: { opco: true } } },
  })
  if (!user) throw new Error("User not found")

  const authorized =
    isGroupAdmin(session.realmRoles) ||
    user.opcoAssignments.some((a) =>
      canManageUsers(session.organizations, session.realmRoles, a.opco.slug)
    )
  if (!authorized) {
    throw new Error("Forbidden: cannot manage this user")
  }

  await reactivateKeycloakUser(user.keycloakId)

  await db.user.update({ where: { id: userId }, data: { isActive: true } })
  await db.userOpCoAssignment.updateMany({
    where: { userId },
    data: { isActive: true, endedAt: null },
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/test/actions/users-authz.test.ts -t reactivateUser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/keycloak.ts src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): add reactivateUser action + reactivateKeycloakUser helper"
```

---

## Task 5: `setUserAssignments` declarative action

**Files:**
- Modify: `src/server/actions/users.ts` (add `setUserAssignments`)
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Extend the test mocks, then write the failing tests**

In `src/test/actions/users-authz.test.ts`, extend `mockDb.userOpCoAssignment` with the methods the action calls:

```ts
  userOpCoAssignment: {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
```

Append the describe (the scoped `beforeEach(vi.clearAllMocks)` isolates the call-count assertions without touching other describes):

```ts
describe('setUserAssignments — authorization & diff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.user.findUnique.mockResolvedValue({ id: 'target', keycloakId: 'kc-target' })
  })

  it('rejects a ghana admin changing a uganda assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    await expect(
      setUserAssignments('target', [{ opcoSlug: 'uganda', role: 'requester' }])
    ).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_admin to add an assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: 'opco-gh', slug: 'ghana' })
    await setUserAssignments('target', [{ opcoSlug: 'ghana', role: 'approver' }])
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })

  it('does not require rights for unchanged out-of-scope assignments', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: 'ghana', id: 'opco-gh' }, role: 'requester' },
      { opco: { slug: 'uganda', id: 'opco-ug' }, role: 'approver' },
    ])
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: 'opco-gh', slug: 'ghana' })
    await setUserAssignments('target', [
      { opcoSlug: 'ghana', role: 'admin' },
      { opcoSlug: 'uganda', role: 'approver' },
    ])
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })

  it('rejects removing your own admin assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin) // keycloakId kc-gha
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'self', keycloakId: 'kc-gha' })
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: 'ghana', id: 'opco-gh' }, role: 'admin' },
    ])
    await expect(
      setUserAssignments('self', [{ opcoSlug: 'ghana', role: 'requester' }])
    ).rejects.toThrow(/own admin/)
  })

  it('rejects duplicate opco slugs', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(
      setUserAssignments('target', [
        { opcoSlug: 'ghana', role: 'admin' },
        { opcoSlug: 'ghana', role: 'requester' },
      ])
    ).rejects.toThrow(/Duplicate/)
  })
})
```

Ensure `beforeEach` is imported on line 1:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/actions/users-authz.test.ts -t setUserAssignments`
Expected: FAIL — `setUserAssignments is not a function`.

- [ ] **Step 3: Implement `setUserAssignments`**

Append to `src/server/actions/users.ts`:

```ts
export async function setUserAssignments(
  userId: string,
  desired: Array<{ opcoSlug: string; role: Role }>
) {
  const session = await getAppSession()
  const db = getPrisma()

  const slugs = desired.map((d) => d.opcoSlug)
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Duplicate OpCo in assignments")
  }
  if (desired.length === 0) {
    throw new Error("At least one assignment is required")
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, keycloakId: true },
  })
  if (!user) throw new Error("User not found")

  const current = await db.userOpCoAssignment.findMany({
    where: { userId, isActive: true },
    include: { opco: true },
  })
  const currentBySlug = new Map(current.map((a) => [a.opco.slug, a.role]))
  const desiredBySlug = new Map(desired.map((d) => [d.opcoSlug, d.role]))

  const changed = new Set<string>()
  for (const [slug, role] of desiredBySlug) {
    if (currentBySlug.get(slug) !== role) changed.add(slug) // added or role-changed
  }
  for (const slug of currentBySlug.keys()) {
    if (!desiredBySlug.has(slug)) changed.add(slug) // removed
  }

  for (const slug of changed) {
    if (
      !isGroupAdmin(session.realmRoles) &&
      !canManageUsers(session.organizations, session.realmRoles, slug)
    ) {
      throw new Error(`Forbidden: cannot manage users in ${slug}`)
    }
  }

  if (user.keycloakId === session.keycloakId) {
    for (const [slug, role] of currentBySlug) {
      if (role === "admin" && desiredBySlug.get(slug) !== "admin") {
        throw new Error("Forbidden: cannot remove your own admin access")
      }
    }
  }

  for (const slug of changed) {
    const desiredRole = desiredBySlug.get(slug)
    if (desiredRole === undefined) {
      const opcoId = current.find((a) => a.opco.slug === slug)!.opco.id
      await db.userOpCoAssignment.update({
        where: { userId_opcoId: { userId, opcoId } },
        data: { isActive: false, endedAt: new Date() },
      })
    } else {
      const opco = await db.opCo.findUnique({ where: { slug } })
      if (!opco) {
        console.warn(`[setUserAssignments] OpCo not found for slug: ${slug}`)
        continue
      }
      await db.userOpCoAssignment.upsert({
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/actions/users-authz.test.ts`
Expected: PASS (whole file — `setUserAssignments`, `reactivateUser`, deactivate self-lockout, and the original cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): add declarative setUserAssignments with per-change authz"
```

---

## Task 6: i18n keys (en + fr)

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the English keys**

In the `en` block, immediately after the line `"users.toast.created": "User onboarded",` (line ~257), insert:

```ts
    "users.wizard.stepReview": "Review",
    "users.wizard.reviewDesc": "Review and confirm the new user.",
    "users.wizard.assignmentsLabel": "OpCo assignments",
    "users.wizard.addAssignment": "Add OpCo assignment",
    "users.wizard.removeAssignment": "Remove",
    "users.list.active": "Active",
    "users.list.inactive": "Inactive",
    "users.list.filterActive": "Active",
    "users.list.filterInactive": "Inactive",
    "users.list.filterAll": "All",
    "users.list.edit": "Edit",
    "users.list.deactivate": "Deactivate",
    "users.list.reactivate": "Reactivate",
    "users.confirm.deactivateTitle": "Deactivate user?",
    "users.confirm.deactivateBody": "This disables the account and ends all OpCo assignments. You can reactivate later.",
    "users.confirm.confirm": "Confirm",
    "users.confirm.cancel": "Cancel",
    "users.edit.title": "Edit user",
    "users.edit.desc": "Change roles or OpCo assignments.",
    "users.edit.addAssignment": "Add assignment",
    "users.edit.readOnly": "Managed by another OpCo admin",
    "users.edit.save": "Save changes",
    "users.edit.saving": "Saving…",
    "users.toast.updated": "User updated",
    "users.toast.reactivated": "User reactivated",
    "users.toast.deactivated": "User deactivated",
    "users.toast.duplicateOpco": "Duplicate OpCo",
    "users.toast.duplicateOpcoDesc": "Each OpCo can be assigned once.",
    "users.toast.noAssignment": "At least one assignment required",
    "users.toast.noAssignmentDesc": "Add at least one OpCo and role.",
```

- [ ] **Step 2: Add the French keys**

In the `fr` block, immediately after the line `"users.toast.created": "Utilisateur ajoute",` (line ~622), insert:

```ts
    "users.wizard.stepReview": "Revue",
    "users.wizard.reviewDesc": "Verifiez et confirmez le nouvel utilisateur.",
    "users.wizard.assignmentsLabel": "Affectations OpCo",
    "users.wizard.addAssignment": "Ajouter une affectation OpCo",
    "users.wizard.removeAssignment": "Retirer",
    "users.list.active": "Actif",
    "users.list.inactive": "Inactif",
    "users.list.filterActive": "Actifs",
    "users.list.filterInactive": "Inactifs",
    "users.list.filterAll": "Tous",
    "users.list.edit": "Modifier",
    "users.list.deactivate": "Desactiver",
    "users.list.reactivate": "Reactiver",
    "users.confirm.deactivateTitle": "Desactiver l utilisateur ?",
    "users.confirm.deactivateBody": "Ceci desactive le compte et termine toutes les affectations OpCo. Vous pourrez reactiver plus tard.",
    "users.confirm.confirm": "Confirmer",
    "users.confirm.cancel": "Annuler",
    "users.edit.title": "Modifier l utilisateur",
    "users.edit.desc": "Modifier les roles ou les affectations OpCo.",
    "users.edit.addAssignment": "Ajouter une affectation",
    "users.edit.readOnly": "Gere par un autre admin OpCo",
    "users.edit.save": "Enregistrer",
    "users.edit.saving": "Enregistrement…",
    "users.toast.updated": "Utilisateur mis a jour",
    "users.toast.reactivated": "Utilisateur reactive",
    "users.toast.deactivated": "Utilisateur desactive",
    "users.toast.duplicateOpco": "OpCo en double",
    "users.toast.duplicateOpcoDesc": "Chaque OpCo ne peut etre affectee qu une fois.",
    "users.toast.noAssignment": "Au moins une affectation requise",
    "users.toast.noAssignmentDesc": "Ajoutez au moins une OpCo et un role.",
```

- [ ] **Step 3: Verify types and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(users): add i18n keys for review step, list actions, edit, confirm"
```

---

## Task 7: Shared `DbUser` type + confirm dialog

**Files:**
- Create: `src/app/(dashboard)/users/types.ts`
- Create: `src/app/(dashboard)/users/confirm-dialog.tsx`

- [ ] **Step 1: Create the shared type**

Create `src/app/(dashboard)/users/types.ts`:

```ts
export type DbUser = {
  id: string
  name: string | null
  email: string
  isActive: boolean
  opcoAssignments: {
    role: string
    isActive: boolean
    opco: { name: string; slug: string }
  }[]
}
```

- [ ] **Step 2: Create the confirm dialog**

Create `src/app/(dashboard)/users/confirm-dialog.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verify types and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/users/types.ts src/app/\(dashboard\)/users/confirm-dialog.tsx
git commit -m "feat(users): add shared DbUser type and reusable confirm dialog"
```

---

## Task 8: User list component + render smoke test

**Files:**
- Create: `src/app/(dashboard)/users/user-list.tsx`
- Test: `src/test/app/users/user-list.test.tsx`

- [ ] **Step 1: Write the failing render test**

Create `src/test/app/users/user-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserList from '@/app/(dashboard)/users/user-list'
import type { DbUser } from '@/app/(dashboard)/users/types'

const users: DbUser[] = [
  {
    id: 'u1', name: 'Ada', email: 'ada@csquared.com', isActive: true,
    opcoAssignments: [{ role: 'admin', isActive: true, opco: { name: 'Ghana', slug: 'ghana' } }],
  },
  {
    id: 'u2', name: 'Bo', email: 'bo@csquared.com', isActive: false,
    opcoAssignments: [{ role: 'requester', isActive: false, opco: { name: 'Uganda', slug: 'uganda' } }],
  },
]

describe('UserList', () => {
  it('shows active users and hides inactive ones by default', () => {
    render(
      <UserList
        users={users}
        isAdmin
        language="en"
        onEdit={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    )
    expect(screen.getByText('ada@csquared.com')).toBeInTheDocument()
    expect(screen.queryByText('bo@csquared.com')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/app/users/user-list.test.tsx`
Expected: FAIL — cannot resolve `@/app/(dashboard)/users/user-list`.

- [ ] **Step 3: Implement the component**

Create `src/app/(dashboard)/users/user-list.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { t } from "@/lib/i18n"
import type { Language } from "@/lib/types"
import type { DbUser } from "./types"

type Filter = "active" | "inactive" | "all"
const filters: Filter[] = ["active", "inactive", "all"]
const filterKey: Record<Filter, string> = {
  active: "users.list.filterActive",
  inactive: "users.list.filterInactive",
  all: "users.list.filterAll",
}

interface UserListProps {
  users: DbUser[]
  isAdmin: boolean
  language: Language
  onEdit: (user: DbUser) => void
  onDeactivate: (user: DbUser) => void
  onReactivate: (user: DbUser) => void
}

export default function UserList({
  users,
  isAdmin,
  language,
  onEdit,
  onDeactivate,
  onReactivate,
}: UserListProps) {
  const [filter, setFilter] = useState<Filter>("active")
  const filtered = users.filter((u) =>
    filter === "all" ? true : filter === "active" ? u.isActive : !u.isActive
  )

  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-base">{t(language, "users.active")}</CardTitle>
        <CardDescription>
          {users.length} {t(language, "users.total")}
        </CardDescription>
        <div className="mt-2 flex gap-2">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-muted-foreground"
              }`}
            >
              {t(language, filterKey[f])}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">{t(language, "users.none")}</p>
        )}
        {filtered.map((user) => (
          <div key={user.id} className="rounded-xl border border-border/70 bg-muted px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{user.name ?? user.email}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  user.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {user.isActive ? t(language, "users.list.active") : t(language, "users.list.inactive")}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {user.opcoAssignments.map((a) => (
                  <span key={a.opco.slug} className={a.isActive ? "" : "line-through opacity-50"}>
                    {a.opco.slug} ({a.role})
                  </span>
                ))}
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onEdit(user)}>
                    {t(language, "users.list.edit")}
                  </Button>
                  {user.isActive ? (
                    <Button variant="outline" onClick={() => onDeactivate(user)}>
                      {t(language, "users.list.deactivate")}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => onReactivate(user)}>
                      {t(language, "users.list.reactivate")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/app/users/user-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/users/user-list.tsx src/test/app/users/user-list.test.tsx
git commit -m "feat(users): add user-list with active/inactive filter and row actions"
```

---

## Task 9: Onboarding wizard (multi-assignment + Review step)

**Files:**
- Create: `src/app/(dashboard)/users/onboard-wizard.tsx`

- [ ] **Step 1: Implement the wizard**

Create `src/app/(dashboard)/users/onboard-wizard.tsx`:

```tsx
"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import type { Language, Role } from "@/lib/types"
import { OPCO_SLUGS, OPCO_NAMES, type OpCoSlug } from "@/lib/opco"
import { createUser } from "@/server/actions/users"

const roles: Role[] = ["requester", "approver", "auditor", "admin"]
type Assignment = { opcoSlug: string; role: Role }

interface OnboardWizardProps {
  language: Language
  manageable: string[] | "all"
  onClose: () => void
  onCreated: () => void
}

export default function OnboardWizard({ language, manageable, onClose, onCreated }: OnboardWizardProps) {
  const { toast } = useToast()
  const availableSlugs = (manageable === "all" ? [...OPCO_SLUGS] : manageable) as string[]
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>(() => [
    { opcoSlug: availableSlugs[0] ?? "ghana", role: "requester" },
  ])
  const [isPending, startTransition] = useTransition()

  const steps = useMemo(
    () => [
      { titleKey: "users.wizard.stepProfile", descKey: "users.wizard.profileDesc" },
      { titleKey: "users.wizard.stepAccess", descKey: "users.wizard.accessDesc" },
      { titleKey: "users.wizard.stepReview", descKey: "users.wizard.reviewDesc" },
    ],
    []
  )

  const usedSlugs = new Set(assignments.map((a) => a.opcoSlug))
  const addableSlugs = availableSlugs.filter((s) => !usedSlugs.has(s))

  const addAssignment = () => {
    if (addableSlugs.length === 0) return
    setAssignments((prev) => [...prev, { opcoSlug: addableSlugs[0], role: "requester" }])
  }
  const removeAssignment = (slug: string) =>
    setAssignments((prev) => prev.filter((a) => a.opcoSlug !== slug))
  const setSlug = (oldSlug: string, newSlug: string) =>
    setAssignments((prev) => prev.map((a) => (a.opcoSlug === oldSlug ? { ...a, opcoSlug: newSlug } : a)))
  const setRole = (slug: string, role: Role) =>
    setAssignments((prev) => prev.map((a) => (a.opcoSlug === slug ? { ...a, role } : a)))

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1))
  const prev = () => setStep((s) => Math.max(s - 1, 0))

  const submit = () => {
    if (!name || !email) {
      toast({
        title: t(language, "users.toast.missing"),
        description: t(language, "users.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    const slugs = assignments.map((a) => a.opcoSlug)
    if (new Set(slugs).size !== slugs.length) {
      toast({
        title: t(language, "users.toast.duplicateOpco"),
        description: t(language, "users.toast.duplicateOpcoDesc"),
        variant: "error",
      })
      return
    }
    if (assignments.length === 0) {
      toast({
        title: t(language, "users.toast.noAssignment"),
        description: t(language, "users.toast.noAssignmentDesc"),
        variant: "error",
      })
      return
    }
    startTransition(async () => {
      try {
        await createUser({ name, email, tempPassword: password || "ChangeMe123!", assignments })
        toast({
          title: t(language, "users.toast.created"),
          description: `${name} — ${assignments.length} OpCo(s)`,
          variant: "success",
        })
        onCreated()
      } catch (err) {
        toast({
          title: "Failed to create user",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4 py-10">
      <Card className="w-full max-w-2xl border-border/80 bg-card/95">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t(language, "users.wizard.title")}</CardTitle>
          <CardDescription>{t(language, steps[step].descKey)}</CardDescription>
          <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
            {steps.map((item, index) => (
              <span
                key={item.titleKey}
                className={`rounded-full px-3 py-1 ${
                  index === step ? "bg-slate-900 text-white" : "bg-slate-100 text-muted-foreground"
                }`}
              >
                {index + 1}. {t(language, item.titleKey)}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid gap-4">
              <Input
                placeholder={t(language, "users.wizard.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                placeholder={t(language, "users.wizard.email")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <label className="text-sm font-medium">{t(language, "users.wizard.assignmentsLabel")}</label>
              {assignments.map((a) => (
                <div key={a.opcoSlug} className="flex items-center gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border border-border bg-white px-3 text-sm"
                    value={a.opcoSlug}
                    onChange={(e) => setSlug(a.opcoSlug, e.target.value)}
                  >
                    {availableSlugs.map((slug) => (
                      <option key={slug} value={slug} disabled={slug !== a.opcoSlug && usedSlugs.has(slug)}>
                        {OPCO_NAMES[slug as OpCoSlug] ?? slug}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 w-40 rounded-md border border-border bg-white px-3 text-sm"
                    value={a.role}
                    onChange={(e) => setRole(a.opcoSlug, e.target.value as Role)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {assignments.length > 1 && (
                    <Button variant="outline" onClick={() => removeAssignment(a.opcoSlug)}>
                      {t(language, "users.wizard.removeAssignment")}
                    </Button>
                  )}
                </div>
              ))}
              {addableSlugs.length > 0 && (
                <Button variant="outline" onClick={addAssignment}>
                  {t(language, "users.wizard.addAssignment")}
                </Button>
              )}
              <div>
                <label className="text-sm font-medium">{t(language, "users.wizard.password")}</label>
                <Input
                  type="password"
                  placeholder={t(language, "users.wizard.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t(language, "users.wizard.passwordHint")}</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>
                <strong>{name}</strong> ({email})
              </p>
              <ul className="list-disc pl-5">
                {assignments.map((a) => (
                  <li key={a.opcoSlug}>
                    {OPCO_NAMES[a.opcoSlug as OpCoSlug] ?? a.opcoSlug} — {a.role}
                  </li>
                ))}
              </ul>
              <p>{t(language, "users.wizard.passwordHint")}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" onClick={onClose}>
              {t(language, "users.wizard.cancel")}
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={prev}>
                  {t(language, "users.wizard.back")}
                </Button>
              )}
              {step < steps.length - 1 ? (
                <Button onClick={next}>{t(language, "users.wizard.next")}</Button>
              ) : (
                <Button onClick={submit} disabled={isPending}>
                  {isPending ? "Creating…" : t(language, "users.wizard.finish")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify types and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/users/onboard-wizard.tsx
git commit -m "feat(users): multi-assignment onboarding wizard with Review step"
```

---

## Task 10: Edit user dialog

**Files:**
- Create: `src/app/(dashboard)/users/edit-user-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

Create `src/app/(dashboard)/users/edit-user-dialog.tsx`:

```tsx
"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import type { Language, Role } from "@/lib/types"
import { OPCO_SLUGS, OPCO_NAMES, type OpCoSlug } from "@/lib/opco"
import { setUserAssignments } from "@/server/actions/users"
import type { DbUser } from "./types"

const roles: Role[] = ["requester", "approver", "auditor", "admin"]
type Row = { opcoSlug: string; role: Role }

interface EditUserDialogProps {
  user: DbUser
  language: Language
  manageable: string[] | "all"
  onClose: () => void
  onSaved: () => void
}

export default function EditUserDialog({ user, language, manageable, onClose, onSaved }: EditUserDialogProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const availableSlugs = (manageable === "all" ? [...OPCO_SLUGS] : manageable) as string[]
  const canManageSlug = (slug: string) => availableSlugs.includes(slug)

  const activeAssignments = useMemo(() => user.opcoAssignments.filter((a) => a.isActive), [user])
  const readOnly = useMemo(
    () => activeAssignments.filter((a) => !canManageSlug(a.opco.slug)),
    [activeAssignments] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [rows, setRows] = useState<Row[]>(() =>
    activeAssignments
      .filter((a) => canManageSlug(a.opco.slug))
      .map((a) => ({ opcoSlug: a.opco.slug, role: a.role as Role }))
  )

  const usedSlugs = new Set([...rows.map((r) => r.opcoSlug), ...readOnly.map((a) => a.opco.slug)])
  const addableSlugs = availableSlugs.filter((s) => !usedSlugs.has(s))

  const addRow = () => {
    if (addableSlugs.length === 0) return
    setRows((prev) => [...prev, { opcoSlug: addableSlugs[0], role: "requester" }])
  }
  const removeRow = (slug: string) => setRows((prev) => prev.filter((r) => r.opcoSlug !== slug))
  const setRole = (slug: string, role: Role) =>
    setRows((prev) => prev.map((r) => (r.opcoSlug === slug ? { ...r, role } : r)))

  const save = () => {
    const desired: Row[] = [
      ...rows,
      ...readOnly.map((a) => ({ opcoSlug: a.opco.slug, role: a.role as Role })),
    ]
    if (desired.length === 0) {
      toast({
        title: t(language, "users.toast.noAssignment"),
        description: t(language, "users.toast.noAssignmentDesc"),
        variant: "error",
      })
      return
    }
    startTransition(async () => {
      try {
        await setUserAssignments(user.id, desired)
        toast({ title: t(language, "users.toast.updated"), description: user.email, variant: "success" })
        onSaved()
      } catch (err) {
        toast({
          title: "Failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-10">
      <Card className="w-full max-w-2xl border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-xl">{t(language, "users.edit.title")}</CardTitle>
          <CardDescription>
            {user.name ?? user.email} — {t(language, "users.edit.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {readOnly.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {readOnly.map((a) => (
                <span
                  key={a.opco.slug}
                  className="rounded-full bg-slate-100 px-2 py-0.5"
                  title={t(language, "users.edit.readOnly")}
                >
                  {a.opco.slug} ({a.role})
                </span>
              ))}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.opcoSlug} className="flex items-center gap-2">
              <span className="w-40 text-sm">{OPCO_NAMES[row.opcoSlug as OpCoSlug] ?? row.opcoSlug}</span>
              <select
                className="h-9 flex-1 rounded-md border border-border bg-white px-3 text-sm"
                value={row.role}
                onChange={(e) => setRole(row.opcoSlug, e.target.value as Role)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={() => removeRow(row.opcoSlug)}>
                {t(language, "users.wizard.removeAssignment")}
              </Button>
            </div>
          ))}
          {addableSlugs.length > 0 && (
            <Button variant="outline" onClick={addRow}>
              {t(language, "users.edit.addAssignment")}
            </Button>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              {t(language, "users.confirm.cancel")}
            </Button>
            <Button onClick={save} disabled={isPending}>
              {isPending ? t(language, "users.edit.saving") : t(language, "users.edit.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify types and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/users/edit-user-dialog.tsx
git commit -m "feat(users): add edit-user dialog for roles and OpCo assignments"
```

---

## Task 11: Wire the page + container, then verify end-to-end

**Files:**
- Modify: `src/app/(dashboard)/users/page.tsx`
- Modify (rewrite): `src/app/(dashboard)/users/users-client.tsx`

- [ ] **Step 1: Surface inactive users in the page query**

In `src/app/(dashboard)/users/page.tsx`, replace the `db.user.findMany({ ... })` call and the `serializable` mapping so the `where` no longer filters out inactive assignments and each assignment serializes `isActive`. The full updated body of `UsersPage` between `const opcoSlugs = ...` and `return`:

```ts
  const users = await db.user.findMany({
    where: {
      opcoAssignments: {
        some: {
          ...(groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }),
        },
      },
    },
    include: {
      opcoAssignments: { include: { opco: true } },
    },
  })

  const serializable = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    opcoAssignments: u.opcoAssignments.map((a) => ({
      role: a.role,
      isActive: a.isActive,
      opco: { name: a.opco.name, slug: a.opco.slug },
    })),
  }))
```

- [ ] **Step 2: Rewrite the client as a container**

Replace the entire contents of `src/app/(dashboard)/users/users-client.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { deactivateUser, reactivateUser } from "@/server/actions/users"
import type { DbUser } from "./types"
import UserList from "./user-list"
import OnboardWizard from "./onboard-wizard"
import EditUserDialog from "./edit-user-dialog"
import ConfirmDialog from "./confirm-dialog"

interface UsersClientProps {
  users: DbUser[]
}

export default function UsersClient({ users }: UsersClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
  const manageable = session
    ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
    : []

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editUser, setEditUser] = useState<DbUser | null>(null)
  const [confirmUser, setConfirmUser] = useState<DbUser | null>(null)
  const [pending, setPending] = useState(false)

  const handleDeactivate = async () => {
    if (!confirmUser) return
    setPending(true)
    try {
      await deactivateUser(confirmUser.id)
      toast({
        title: t(language, "users.toast.deactivated"),
        description: confirmUser.email,
        variant: "success",
      })
      setConfirmUser(null)
      router.refresh()
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  const handleReactivate = async (user: DbUser) => {
    try {
      await reactivateUser(user.id)
      toast({
        title: t(language, "users.toast.reactivated"),
        description: user.email,
        variant: "success",
      })
      router.refresh()
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "users.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "users.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "users.desc")}</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} disabled={!isAdmin}>
          {t(language, "users.onboard")}
        </Button>
      </div>

      <UserList
        users={users}
        isAdmin={isAdmin}
        language={language}
        onEdit={(u) => setEditUser(u)}
        onDeactivate={(u) => setConfirmUser(u)}
        onReactivate={handleReactivate}
      />

      {wizardOpen && (
        <OnboardWizard
          language={language}
          manageable={manageable}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false)
            router.refresh()
          }}
        />
      )}

      {editUser && (
        <EditUserDialog
          user={editUser}
          language={language}
          manageable={manageable}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null)
            router.refresh()
          }}
        />
      )}

      {confirmUser && (
        <ConfirmDialog
          title={t(language, "users.confirm.deactivateTitle")}
          body={t(language, "users.confirm.deactivateBody")}
          confirmLabel={t(language, "users.confirm.confirm")}
          cancelLabel={t(language, "users.confirm.cancel")}
          pending={pending}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmUser(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check, lint, and run the full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 4: Build to catch server/client boundary issues**

Run: `pnpm build`
Expected: build succeeds (Prisma generate + Next build). If it fails only on the missing dev `DATABASE_URL`/Keycloak env (route handlers), that is the pre-existing infra gap, not a regression — note it and continue.

- [ ] **Step 5: Run the deslop quality pass**

Invoke the `deslop` skill on the changed files (per the project phase-gate rule). Address any findings, re-run `pnpm test`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/users/page.tsx src/app/\(dashboard\)/users/users-client.tsx
git commit -m "feat(users): wire list, onboarding, edit, and deactivate/reactivate into Users page"
```

---

## Self-Review

**Spec coverage check (each spec item → task):**

- Gap 4 gating helpers → Task 1; wired into app-shell/teams → Task 2; wired into users-client → Task 11 Step 2. ✓
- `reactivateUser` + `reactivateKeycloakUser` → Task 4. ✓
- `setUserAssignments` (declarative, changed-only authz, self-lockout, upsert revive) → Task 5. ✓
- `deactivateUser` self-lockout → Task 3. ✓
- `createUser` unchanged, driven multi-assignment by the wizard → Task 9. ✓
- Page surfaces inactive users + serializes `isActive` → Task 11 Step 1. ✓
- `user-list` (filter, badges, muted ended chips, row actions) → Task 8. ✓
- `onboard-wizard` (multi-assignment Access step, Review step) → Task 9. ✓
- `edit-user-dialog` (role/assignment edit, read-only non-manageable) → Task 10. ✓
- `confirm-dialog` → Task 7. ✓
- Shared `DbUser` type (decouples test from server-action module) → Task 7. ✓
- i18n keys (en + fr) → Task 6. ✓
- Tests: permissions helpers → Task 1; reactivate/setAssignments/self-lockout authz → Tasks 3–5; user-list render smoke → Task 8. ✓
- No schema migration; built on existing `isActive`/`endedAt` → confirmed (no migration task). ✓
- Manual-login caveat (`REPLACE_WITH_KEYCLOAK_SUB`) → out of scope, noted in spec; Task 11 Step 4 flags the env-gated build. ✓

**Placeholder scan:** No "TBD"/"implement later"/"handle edge cases" — every code step shows complete code. ✓

**Type/name consistency:**
- `canManageAnyOpCo(orgs, realmRoles)` / `manageableOpCoSlugs(orgs, realmRoles): string[] | "all"` — used identically in Tasks 1, 2, 9, 10, 11. ✓
- `DbUser` shape (user `isActive` + per-assignment `isActive` + `opco {name, slug}`) — defined in Task 7, produced in Task 11 Step 1, consumed in Tasks 8/10/11. ✓
- `setUserAssignments(userId, desired: {opcoSlug, role}[])` — signature matches caller in Task 10. ✓
- `reactivateUser(userId)` / `deactivateUser(userId)` — match callers in Task 11. ✓
- `Role` imported from `@/lib/types` (4 OpCo-level roles) in client; assignable to the Prisma `Role` param on the actions (subset) — consistent with the existing `createUser` call pattern. ✓
- `Language` imported from `@/lib/types`. ✓

**Ordering note:** Task 4 Step 2 imports `setUserAssignments` (defined in Task 5). The targeted `-t reactivateUser` run in Task 4 still executes, but if the runner rejects the unresolved import, add the `setUserAssignments` import in Task 5 Step 1 instead. Flagged inline in Task 4.
