# Admin & Governance — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Scope:** One combined spec covering user/role administration, teams, CAB membership, admin-action auditing, OpCo lifecycle, and approver delegations.

## Summary

The app already has rudimentary, OpCo-scoped user management (onboarding, deactivate/reactivate, edit roles, gating helpers). This spec extends it into a coherent **Admin & Governance** surface where two tiers of admin manage everything user- and governance-related:

- **`group_admin`** (realm role) — full CRUD across **all** OpCos.
- **OpCo `admin`** (assignment role) — CRUD scoped to the OpCo(s) where they hold `admin`.

Both tiers manage users, roles, teams, and CAB membership; group_admin additionally manages OpCo lifecycle and the group-level CAB. Every administrative mutation is recorded in an immutable, dedicated audit log.

## Role Model

Unchanged from the current schema. Six roles split across two layers:

- **Realm roles** (managed in **Keycloak only**, read from the JWT, never granted in-app): `group_admin`, `group_auditor`.
- **OpCo-scoped roles** (stored on `UserOpCoAssignment.role`): `admin`, `approver`, `auditor`, `requester`.

`group_admin` = CRUD everywhere. `group_auditor` = read-only everywhere. OpCo `admin` = CRUD within their OpCo(s). `approver` is the eligibility gate for CAB membership.

## Authority Matrix

"Own OpCo" = an OpCo where the actor holds `admin`.

| Action | group_admin | OpCo admin (own OpCo) | group_auditor |
|---|---|---|---|
| Create / rename / archive **OpCo** | ✓ all | ✗ | read |
| Onboard user | ✓ any OpCo | ✓ own (add-by-email) | read |
| View user directory | **all users** | **own-OpCo users only** | read all |
| Assign `requester`/`approver`/`auditor` | ✓ | ✓ own | ✗ |
| Assign / revoke **`admin`** | ✓ | ✗ | ✗ |
| Assign `group_admin`/`group_auditor` | **Keycloak only** | ✗ | ✗ |
| Deactivate / reactivate user | ✓ | ✓ own-OpCo users | ✗ |
| Team CRUD + members + lead | ✓ | ✓ own | read |
| **Per-OpCo CAB** membership | ✓ | ✓ own | read |
| **Group CAB** membership | ✓ | ✗ | read |
| Approver **delegations** | ✓ | ✓ own | read |
| View **AdminAuditLog** | ✓ all | ✓ own-OpCo entries | read all |

### Hard guards (enforced server-side on every relevant action)

- **Privilege ceiling** — an OpCo admin can never set a role to `admin`; no in-app path grants realm roles.
- **Self-lockout** — an actor cannot deactivate themselves or revoke their own `admin` (already implemented).
- **Last-admin guard** *(new)* — cannot remove/deactivate the last active `admin` of an OpCo (no orphaned OpCo).
- **Scoped visibility** — OpCo admins only see/act on users who hold an assignment in their managed OpCo(s); CAB eligibility requires the target to hold `approver` in the relevant OpCo.

## Data Model Changes (`prisma/schema.prisma`)

### 1. `TeamMember` gains a role

```prisma
enum TeamRole {
  lead
  member
}

model TeamMember {
  // ...existing fields
  role TeamRole @default(member)
}
```

### 2. `CABMembership` — new model

Covers both per-OpCo CABs and the single group CAB.

```prisma
model CABMembership {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  opcoId    String?   // null = group CAB
  opco      OpCo?     @relation(fields: [opcoId], references: [id])
  isActive  Boolean   @default(true)   // soft-remove, matches UserOpCoAssignment pattern
  addedAt   DateTime  @default(now())
  endedAt   DateTime?

  @@index([opcoId])
  @@index([userId])
}
```

- **Eligibility is app-enforced** (not a FK): per-OpCo CAB requires the target to hold `approver` in that OpCo; group CAB requires `approver` in ≥1 OpCo.
- **Uniqueness:** a partial unique index on `(userId, opcoId)` covers per-OpCo rows. Postgres treats `NULL` opcoId as distinct, so the DB unique cannot fully cover group-CAB rows — duplicate group membership is prevented by an **app-level guard** in `addCabMember`.
- **Soft-remove:** removing a member sets `isActive = false`, `endedAt = now()`; re-adding `upsert`s the row back to active (mirrors `setUserAssignments`).

### 3. `AdminAuditLog` — new model

Immutable, separate from the change-request `AuditLog` (which is bolted to `changeId` and only logs change events).

```prisma
model AdminAuditLog {
  id           String   @id @default(cuid())
  actorId      String
  actor        User     @relation(fields: [actorId], references: [id])
  action       String   // e.g. "role.grant", "role.revoke", "user.onboard", "user.deactivate",
                         //      "user.reactivate", "team.create", "team.member.add", "cab.add",
                         //      "cab.remove", "opco.create", "opco.archive", "delegation.create"
  opcoId       String?  // OpCo context (null for group-level / opco-lifecycle actions)
  targetUserId String?  // user acted upon, if any
  summary      String   // human-readable description
  metadata     Json?    // structured before/after, e.g. {"from":"approver","to":"auditor"}
  at           DateTime @default(now())

  @@index([opcoId])
  @@index([actorId])
  @@index([targetUserId])
  @@index([at])
}
```

- **Immutability** mirrors the existing change-audit guarantee: the app exposes **append + read only**, with no update/delete path, covered by an immutability test analogous to the current one.

### 4. `OpCo` lifecycle

```prisma
model OpCo {
  // ...existing fields
  archivedAt DateTime?   // soft-archive; never hard-delete (OpCos own changes/history)
}
```

- `group_admin` can **create** (slug + name + locale + Keycloak org), **rename**, and **archive/unarchive**.
- Archiving hides the OpCo from active lists and blocks new changes; all history is preserved.

### 5. `ApproverDelegation` — no schema change

The model already exists (`opcoId`, `fromUserId`, `toUserId`, `validFrom`, `validUntil`, `isActive`). This spec adds server actions and authz only.

### 6. Add-by-email linking — no schema change

The existing unique constraints on `User.email` / `User.keycloakId` already support it: onboarding checks whether the email exists → **link** (create a new assignment for an existing identity) vs **create** (new Keycloak identity + user).

### Migration

One Prisma migration is authored as part of this work. Dev has no `DATABASE_URL`, but `docker/` provides Postgres — the migration runs against that. Unit tests stay on mocks; the Testcontainers integration test covers the real constraints.

## Server Actions & Authz Helpers

### New permission helpers (`src/lib/permissions.ts`)

```ts
canAssignRole(orgs, realmRoles, opcoSlug, role)  // group_admin → any OpCo role;
                                                  // OpCo admin → requester/approver/auditor only (NOT admin)
canManageTeams(orgs, realmRoles, opcoSlug)        // admin-of-OpCo or group_admin
canManageCab(orgs, realmRoles, opcoSlug)          // per-OpCo CAB: admin-of-OpCo or group_admin
canManageGroupCab(realmRoles)                     // = isGroupAdmin
canManageOpCoLifecycle(realmRoles)                // = isGroupAdmin
visibleOpCoSlugs(orgs, realmRoles)                // "all" for group_admin, else managed slugs
```

### Transaction & audit pattern

Each mutation runs inside a `db.$transaction` that also appends exactly one `AdminAuditLog` row via a shared `recordAdminAction(tx, { actorId, action, opcoId?, targetUserId?, summary, metadata? })` helper, so the audit entry commits atomically with the action and can never drift.

### Actions by area

**Users/roles** — `src/server/actions/users.ts` (extend existing):
- `onboardUser(input)` — replaces raw `createUser`: if the email exists → **link** (add assignment); else → `createKeycloakUser` + create user. Enforces `canAssignRole` per assignment (blocks `admin` for OpCo admins).
- `setUserAssignments` — adds the **per-role privilege ceiling** (`canAssignRole` on each changed slug+role) on top of the existing changed-slug authorization.
- `deactivateUser` / `reactivateUser` — add the **last-admin guard**; scope the target to `visibleOpCoSlugs`.
- `listUsers` — scoped by `visibleOpCoSlugs` (group_admin = all).

**Teams** — `src/server/actions/teams.ts` (new): `createTeam`, `updateTeam`, `deleteTeam` (**hard delete** — teams have no FK references yet), `addTeamMember(teamId, userId, role)`, `removeTeamMember`, `setTeamMemberRole`. A member must hold an assignment in the team's OpCo; authz via `canManageTeams`.

**CAB** — `src/server/actions/cab.ts` (new): `addCabMember(userId, opcoSlug | null)` (null = group CAB → `canManageGroupCab`; eligibility = holds `approver`; `upsert` to revive a soft-removed row), `removeCabMember` (soft), `listCabMembers(opcoSlug | null)`.

**OpCo lifecycle** — `src/server/actions/opcos.ts` (new, group_admin-only): `createOpCo` (+ best-effort `createKeycloakOrg`), `renameOpCo`, `archiveOpCo` / `unarchiveOpCo`.

**Delegations** — `src/server/actions/delegations.ts` (new): `createDelegation({ opcoSlug, fromUserId, toUserId, validUntil })` (both users must hold `approver` in the OpCo), `revokeDelegation`, `listDelegations`. Authz = admin-of-OpCo or group_admin.

**Keycloak** — `src/server/keycloak.ts`: add best-effort `createKeycloakOrg(slug, name)`; reuse existing `createKeycloakUser` / `assignToOrganization` helpers.

## UI Surface

Extends the existing capability-gated **User Management** sidebar group (already filtered by `canManageAnyOpCo`). Each page/tab is further gated so OpCo admins never see group-only surfaces. Layout details follow existing page patterns and are decided at implementation time; these are conceptual placements.

| Page | Audience | Notes |
|---|---|---|
| **Users** (existing) | group_admin (all) / OpCo admin (own) | onboarding switches to add-by-email; edit dialog **hides the `admin` option** for OpCo admins |
| **Teams** (existing stub → wired) | admins, own OpCo | CRUD + members + lead toggle |
| **CAB** (repurpose `/approval-matrix` stub) | admins | per-OpCo tab(s) + a **Group CAB** tab visible only to group_admin |
| **Delegations** (new) | admins, own OpCo | create / revoke for approvers |
| **OpCos** (new) | **group_admin only** | create / rename / archive |
| **Admin Audit** (new) | group_admin (all), OpCo admin (own entries), group_auditor (read) | filterable read-only stream |

## Testing Strategy

Per the project phase-gate (deslop pass + all tests green before advancing):

- **Unit (Vitest + mocks):** `canAssignRole` matrix; CAB eligibility; last-admin and self-lockout guards; scoped visibility; each action's authorization; "audit row written" assertions; **`AdminAuditLog` immutability** test (mirrors the existing change-audit immutability test).
- **Integration (Testcontainers, real Postgres):** CAB uniqueness including the `NULL`-opcoId group case; soft-remove + `upsert` revive; last-admin guard against real constraints; migration applies cleanly.

## Out of Scope / Assumptions

- Realm-role (`group_admin` / `group_auditor`) assignment is done in the **Keycloak console only** — the app reads these from the token and never writes them.
- CAB **engagement rules** (when the group CAB supersedes an OpCo CAB on a given change) are approval-workflow logic and belong to a **separate spec**; this spec only models CAB *membership* and who manages it.
- **Team → change assignment** is not modeled yet (`ChangeAssignee` is per-user). Teams are standalone groupings here; linking changes to teams is future work.
- No CAB chair/position concept (YAGNI).
- Live login remains blocked by the pre-existing `REPLACE_WITH_KEYCLOAK_SUB` seed placeholder — unrelated to this spec.
- `group_auditor` read-only views are part of the role model but receive minimal dedicated UI.
