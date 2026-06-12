# Admin & Governance — Plan B: Teams Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side team management — create/update/delete teams and add/remove/role members — scoped to OpCo admins (and group_admin), with OpCo-assignment eligibility for members and atomic admin-action auditing.

**Architecture:** New `src/server/actions/teams.ts` holds all team actions. Authorization uses a new pure `canManageTeams` helper (admin-of-OpCo or group_admin). Every mutation runs in a `db.$transaction` that also appends one `AdminAuditLog` row via the existing `recordAdminAction`. The schema (`Team`, `TeamMember.role: TeamRole`) already exists from Plan A's foundation migration — **no migration in this plan.**

**Tech Stack:** Next.js server actions, Prisma v7, Vitest + mocked Prisma client, `recordAdminAction` (`@/server/audit`).

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-and-governance-design.md` (Teams section).

**Depends on:** Plan A (schema foundation, `recordAdminAction`, the mock-DB `$transaction` test idiom). The **Teams UI is Plan F**, not this plan — `teams-client.tsx` currently uses the Zustand store and is untouched here.

---

## File Structure

- `src/lib/permissions.ts` — add `canManageTeams(orgs, realmRoles, opcoSlug)`.
- `src/server/actions/teams.ts` — **new**: `createTeam`, `updateTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `setTeamMemberRole`, plus private `loadTeamOpco` / `assertCanManageTeams` helpers.
- Tests: `src/test/lib/permissions.test.ts` (extend), `src/test/actions/teams.test.ts` (**new**).

> **Note on `canManageTeams` vs `canManageUsers`:** they share the same rule today (group_admin or OpCo admin), but represent distinct authorization concepts (team management vs user management) that may diverge. Per DRY, incidental similarity is not duplication — keep them as separate, directly-implemented helpers (do **not** make one delegate to the other).

> **Deliberate non-goals (YAGNI):** no single-lead enforcement (a team may technically have multiple `lead` members; the UI/process governs this — revisit if a real invariant emerges). `deleteTeam` is a hard delete (teams have no inbound FKs except `TeamMember`, which is removed first).

---

## Task 1: `canManageTeams` helper

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/test/lib/permissions.test.ts`:

```ts
describe("canManageTeams", () => {
  const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]
  const ghanaRequesterOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }]

  it("allows a group_admin to manage teams in any OpCo", () => {
    expect(canManageTeams([], ["group_admin"], "ghana")).toBe(true)
  })

  it("allows an OpCo admin to manage teams in their OpCo", () => {
    expect(canManageTeams(ghanaAdminOrgs, [], "ghana")).toBe(true)
  })

  it("forbids an OpCo admin in an OpCo they don't administer", () => {
    expect(canManageTeams(ghanaAdminOrgs, [], "uganda")).toBe(false)
  })

  it("forbids a non-admin OpCo member", () => {
    expect(canManageTeams(ghanaRequesterOrgs, [], "ghana")).toBe(false)
  })
})
```

Add `canManageTeams` to the existing `@/lib/permissions` import in that test file (or its own import line).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canManageTeams`
Expected: FAIL — `canManageTeams is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/permissions.ts`:

```ts
export function canManageTeams(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string
): boolean {
  return isGroupAdmin(realmRoles) || hasRoleInOpCo(organizations, opcoSlug, "admin")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/lib/permissions.test.ts -t canManageTeams`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(permissions): add canManageTeams helper"
```

---

## Task 2: Team lifecycle actions (create / update / delete)

**Files:**
- Create: `src/server/actions/teams.ts`
- Test: `src/test/actions/teams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/teams.test.ts`:

```ts
// src/test/actions/teams.test.ts
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
  team: {
    create: vi.fn().mockResolvedValue({ id: "team-1", name: "Core Network" }),
    update: vi.fn().mockResolvedValue({ id: "team-1", name: "Renamed" }),
    delete: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ id: "team-1", opcoId: "opco-gh", opco: { slug: "ghana" } }),
  },
  teamMember: {
    upsert: vi.fn().mockResolvedValue({ id: "tm-1", role: "member" }),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    update: vi.fn().mockResolvedValue({ id: "tm-1", role: "lead" }),
  },
  userOpCoAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import {
  createTeam,
  updateTeam,
  deleteTeam,
} from "@/server/actions/teams"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", organizations: [], realmRoles: ["group_admin"] }
const ghanaAdmin = {
  keycloakId: "kc-gha",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
  realmRoles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
})

describe("createTeam", () => {
  it("rejects a non-admin OpCo member", async () => {
    await expect(createTeam({ opcoSlug: "ghana", name: "Core" })).rejects.toThrow(/Forbidden/)
  })

  it("rejects an OpCo admin creating in an OpCo they don't administer", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(createTeam({ opcoSlug: "uganda", name: "Core" })).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_admin create a team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const team = await createTeam({ opcoSlug: "ghana", name: "Core Network", description: "Backbone" })
    expect(team).toHaveProperty("id", "team-1")
    expect(mockDb.team.create).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("lets an OpCo admin create a team in their OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await createTeam({ opcoSlug: "ghana", name: "Field Ops" })
    expect(mockDb.team.create).toHaveBeenCalledTimes(1)
  })
})

describe("updateTeam", () => {
  it("rejects a non-admin", async () => {
    await expect(updateTeam("team-1", { name: "Renamed" })).rejects.toThrow(/Forbidden/)
  })

  it("lets an admin rename a team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await updateTeam("team-1", { name: "Renamed" })
    expect(mockDb.team.update).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("deleteTeam", () => {
  it("rejects a non-admin", async () => {
    await expect(deleteTeam("team-1")).rejects.toThrow(/Forbidden/)
  })

  it("deletes members then the team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await deleteTeam("team-1")
    expect(mockDb.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(mockDb.team.delete).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/teams.test.ts`
Expected: FAIL — cannot find module `@/server/actions/teams`.

- [ ] **Step 3: Implement the lifecycle actions**

Create `src/server/actions/teams.ts`:

```ts
// src/server/actions/teams.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageTeams } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import type { TeamRole } from "@prisma/client"
import type { SessionOrganization } from "@/types/next-auth"

type Session = { keycloakId: string; organizations: SessionOrganization[]; realmRoles: string[] }

function assertCanManageTeams(session: Session, opcoSlug: string) {
  if (!canManageTeams(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage teams in ${opcoSlug}`)
  }
}

// Resolves a team's OpCo (id + slug); throws if the team is missing.
async function loadTeamOpco(
  db: ReturnType<typeof getPrisma>,
  teamId: string
): Promise<{ opcoId: string; opcoSlug: string }> {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { opco: true } })
  if (!team) throw new Error("Team not found")
  return { opcoId: team.opcoId, opcoSlug: team.opco.slug }
}

export async function createTeam(input: { opcoSlug: string; name: string; description?: string }) {
  const session = await getAppSession()
  assertCanManageTeams(session, input.opcoSlug)

  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${input.opcoSlug}`)

  return db.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { opcoId: opco.id, name: input.name, description: input.description ?? null },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.create",
      opcoId: opco.id,
      summary: `Created team "${input.name}" in ${input.opcoSlug}`,
    })
    return team
  })
}

export async function updateTeam(teamId: string, data: { name?: string; description?: string }) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  return db.$transaction(async (tx) => {
    const team = await tx.team.update({ where: { id: teamId }, data })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.update",
      opcoId,
      summary: `Updated team ${teamId}`,
      metadata: data,
    })
    return team
  })
}

export async function deleteTeam(teamId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  await db.$transaction(async (tx) => {
    await tx.teamMember.deleteMany({ where: { teamId } })
    await tx.team.delete({ where: { id: teamId } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.delete",
      opcoId,
      summary: `Deleted team ${teamId}`,
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/actions/teams.test.ts`
Expected: PASS. Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/teams.ts src/test/actions/teams.test.ts
git commit -m "feat(teams): create/update/delete team actions with authz and audit"
```

---

## Task 3: Team membership actions (add / remove / set role)

**Files:**
- Modify: `src/server/actions/teams.ts`
- Test: `src/test/actions/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/test/actions/teams.test.ts` — first extend the import to include the membership actions:

```ts
import {
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamMemberRole,
} from "@/server/actions/teams"
```

Then add these describe blocks:

```ts
describe("addTeamMember", () => {
  it("rejects a non-admin", async () => {
    await expect(addTeamMember("team-1", "user-2", "member")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a user who is not assigned to the team's OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addTeamMember("team-1", "outsider", "member")).rejects.toThrow(/not assigned/i)
  })

  it("adds an eligible member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await addTeamMember("team-1", "user-2", "lead")
    expect(mockDb.teamMember.upsert).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("removeTeamMember", () => {
  it("rejects a non-admin", async () => {
    await expect(removeTeamMember("team-1", "user-2")).rejects.toThrow(/Forbidden/)
  })

  it("removes a member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await removeTeamMember("team-1", "user-2")
    expect(mockDb.teamMember.delete).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team-1", userId: "user-2" } },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("setTeamMemberRole", () => {
  it("rejects a non-admin", async () => {
    await expect(setTeamMemberRole("team-1", "user-2", "lead")).rejects.toThrow(/Forbidden/)
  })

  it("updates a member's role and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await setTeamMemberRole("team-1", "user-2", "lead")
    expect(mockDb.teamMember.update).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team-1", userId: "user-2" } },
      data: { role: "lead" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/teams.test.ts -t TeamMember`
Expected: FAIL — `addTeamMember is not a function` (and siblings).

- [ ] **Step 3: Implement the membership actions**

Append to `src/server/actions/teams.ts`:

```ts
export async function addTeamMember(teamId: string, userId: string, role: TeamRole = "member") {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  // Eligibility: a team member must hold an active assignment in the team's OpCo.
  const assignment = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, isActive: true },
  })
  if (!assignment) throw new Error("Forbidden: user is not assigned to this team's OpCo")

  return db.$transaction(async (tx) => {
    const member = await tx.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      update: { role },
      create: { teamId, userId, role },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.add",
      opcoId,
      targetUserId: userId,
      summary: `Added user ${userId} to team ${teamId} as ${role}`,
    })
    return member
  })
}

export async function removeTeamMember(teamId: string, userId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  await db.$transaction(async (tx) => {
    await tx.teamMember.delete({ where: { teamId_userId: { teamId, userId } } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.remove",
      opcoId,
      targetUserId: userId,
      summary: `Removed user ${userId} from team ${teamId}`,
    })
  })
}

export async function setTeamMemberRole(teamId: string, userId: string, role: TeamRole) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  return db.$transaction(async (tx) => {
    const member = await tx.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { role },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.role",
      opcoId,
      targetUserId: userId,
      summary: `Set user ${userId} role to ${role} in team ${teamId}`,
    })
    return member
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/actions/teams.test.ts`
Expected: PASS (all lifecycle + membership cases). Then `pnpm tsc --noEmit` → PASS. Do NOT add type casts on `recordAdminAction(tx, ...)` — `tx` is already the correct Prisma transaction client type.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/teams.ts src/test/actions/teams.test.ts
git commit -m "feat(teams): add/remove/role team-member actions with eligibility and audit"
```

---

## Task 4: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` (Docker is available, so the Testcontainers integration tests run too).
Expected: PASS — all suites including the new `teams.test.ts` cases.

- [ ] **Step 2: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors (pre-existing `security/detect-object-injection` warnings are unchanged).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over the diff for this plan; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(teams): deslop pass for team backend"
```

---

## Self-Review (author's check against the spec)

- **Teams CRUD** (spec §Teams, §Actions): `createTeam`/`updateTeam`/`deleteTeam` (Task 2). ✓
- **Members + lead role** (spec): `addTeamMember(role)`/`removeTeamMember`/`setTeamMemberRole`; `TeamRole` from the foundation schema. ✓
- **Member eligibility** (spec: "member must hold an assignment in the team's OpCo"): `addTeamMember` checks `userOpCoAssignment.findFirst` (Task 3). ✓
- **Authz** (spec §Authority Matrix: admins, own OpCo): `canManageTeams` (Task 1) applied in every action. ✓
- **Atomic audit** (spec §Transaction & audit pattern): every mutation wraps writes + `recordAdminAction` in `$transaction`. ✓
- **Hard delete** (plan decision): `deleteTeam` removes `TeamMember` rows first (FK), then the team. ✓
- **Out of scope**: Teams UI (Plan F); team→change assignment (not modeled); single-lead enforcement (deliberate YAGNI). ✓
