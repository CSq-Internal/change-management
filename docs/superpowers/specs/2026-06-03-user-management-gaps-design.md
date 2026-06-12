# User Management — Gaps 1–5 Design

**Date:** 2026-06-03
**Branch:** authored on feat/triage-action-and-dark-mode; implementation branch to be confirmed
**Status:** Approved design — ready for implementation plan

## Context

User Management is backed by **Keycloak (identity) → NextAuth (session) → Prisma/Postgres
(authoritative OpCo roles)**. Login is Keycloak OIDC; on sign-in the JWT is enriched from
`UserOpCoAssignment` rows (`src/lib/auth-callbacks.ts`), so the **DB is authoritative** for
per-OpCo roles. The session carries `organizations` (per-OpCo roles) and `realmRoles`
(group-level: `group_admin`, `group_auditor`).

Multi-tenancy: an **OpCo** is a country/operating company. A user holds **one role per OpCo**
via `UserOpCoAssignment` (`@@unique([userId, opcoId])`). Per-OpCo roles: `requester`,
`approver`, `auditor`, `admin`. Group-level realm roles (`group_admin`, `group_auditor`) are
cross-OpCo and are **managed in Keycloak, not in this app**.

A review of the feature surfaced five gaps:

1. `deactivateUser` server action exists but is unwired; no edit/role-change UI.
2. Wizard step 3 is labeled "Teams" but renders a review paragraph (the team-assignment
   feature was stubbed — `users.wizard.teams`/`noTeams` i18n keys exist but are unused).
3. The onboarding wizard collects a single `{OpCo, role}` while `createUser` already accepts
   an array of assignments.
4. Admin gating checks only `organizations[0]` in `app-shell.tsx`, `users-client.tsx`, and
   `teams-client.tsx` — an OpCo admin whose admin role is not the first listed org is wrongly
   denied the UI (server enforcement is already correct; this is a client UX-correctness bug).
5. The flow needs Postgres + Keycloak to run. Infra already exists
   (`docker/keycloak/docker-compose.yml`, `prisma/seed.ts`, configured `.env.local`), so this
   is a verification concern, not new infra.

## Goals

1. Wire **deactivate** + add **reactivate** (per-row actions; surface inactive users).
2. **Edit** a user's role and add/remove **OpCo assignments** after creation.
3. **Multi-assignment onboarding** — the wizard adds several `{OpCo, role}` pairs in one pass.
4. **Rename** wizard step 3 to "Review" (honest confirm screen).
5. **Fix gap-4 gating** consistently across `app-shell`, `users`, and `teams`.
6. Cover changes with **mocked unit tests**; verify against existing infra (no new infra).

## Non-goals

- Real team assignment / team creation (deferred — teams can't be created anywhere yet).
- Fixing live login (the seed's `REPLACE_WITH_KEYCLOAK_SUB` placeholder; separate known gap).
- New shadcn/ui dependencies or any Prisma schema migration (`isActive`/`endedAt` already exist).
- Managing realm roles (`group_admin`/`group_auditor`) — those stay in Keycloak.

## Decisions (locked during brainstorming)

- Build the full management surface: deactivate + reactivate, edit role/assignments,
  multi-assignment onboarding.
- Wizard step 3 → "Review" (no real team assignment now).
- Approach 2: **decompose** the Users feature into small components + a **shared gating
  helper**; **declarative** assignment edits (`setUserAssignments` diffs server-side).
- Verify with mocked unit tests; no new infra.

## Design

### 1. Permissions & gating (gap 4)

Add two pure helpers to `src/lib/permissions.ts`:

```ts
canManageAnyOpCo(orgs, realmRoles): boolean
  → isGroupAdmin(realmRoles) || orgs.some(o => o.roles.includes("admin"))

manageableOpCoSlugs(orgs, realmRoles): string[] | "all"
  → isGroupAdmin(realmRoles) ? "all"
    : orgs.filter(o => o.roles.includes("admin")).map(o => o.alias)
```

- Replace `canManageUsers(orgs, roles, organizations[0]?.alias ?? "")` with
  `canManageAnyOpCo(orgs, roles)` in **`app-shell.tsx`** (showAdminNav),
  **`users-client.tsx`**, and **`teams-client.tsx`**.
- `manageableOpCoSlugs` drives which OpCos the onboarding wizard and edit dialog offer
  (group_admin → all 6; OpCo admin → only admin OpCos), mirroring server enforcement.
- Existing `canManageUsers(orgs, roles, slug)` is unchanged; server actions keep using it
  per-target-OpCo.

### 2. Server actions & query (data layer)

**`src/server/actions/users.ts`**

- **`createUser`** — unchanged (already loops assignments with per-OpCo authz). Wizard now
  sends multiple assignments.
- **`reactivateUser(userId)`** (new):
  - Load user with **all** assignments (deactivated users have none active), include opco.
  - Authz: `isGroupAdmin(session.realmRoles) || user.opcoAssignments.some(a =>
    canManageUsers(session.organizations, session.realmRoles, a.opco.slug))`.
  - `reactivateKeycloakUser(keycloakId)` (PUT `enabled:true`).
  - `user.isActive = true`; `userOpCoAssignment.updateMany({ where:{userId},
    data:{ isActive:true, endedAt:null } })`.
- **`setUserAssignments(userId, desired: {opcoSlug, role}[])`** (new, declarative):
  - Reject duplicate `opcoSlug` in `desired`. Require `desired.length >= 1` (to remove all
    access use Deactivate).
  - Load current **active** assignments (+ opco). Compute **changed** slugs: added (in
    `desired`, not current) ∪ removed (in current, not `desired`) ∪ role-changed (in both,
    different role).
  - Authz: for every **changed** slug, require `isGroupAdmin ||
    canManageUsers(session..., slug)`; else throw `Forbidden`. Unchanged assignments need no
    rights, so an OpCo admin can save a user who also holds assignments in OpCos they don't
    manage — the client passes those back **unchanged** (rendered read-only in the dialog).
  - **Self-lockout guard:** if `user.keycloakId === session.keycloakId`, reject removing or
    downgrading the caller's own `admin` assignment.
  - Apply the diff: add/role-change via `upsert` on `[userId, opcoId]` (revives soft-deleted
    rows; sets `isActive:true, endedAt:null`) + best-effort `assignToOrganization`; remove via
    soft-delete (`isActive:false, endedAt:now`). No Keycloak org removal (app reads roles from
    DB).
  - Role options limited to OpCo-level roles (`requester|approver|auditor|admin`).
- **`deactivateUser(userId)`** — add a **self-lockout guard** (caller can't deactivate
  themselves: `user.keycloakId === session.keycloakId` → throw); otherwise unchanged.

**`src/server/keycloak.ts`** — add `reactivateKeycloakUser(keycloakUserId)` (PUT
`enabled:true`), mirroring `deactivateKeycloakUser`.

**`src/app/(dashboard)/users/page.tsx`** — surface inactive users: drop the assignment-level
`isActive:true` filter so soft-deleted assignment rows keep in-scope inactive users visible.
Serialize `user.isActive` and per-assignment `isActive`:

```ts
where: { opcoAssignments: { some: { ...(groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }) } } }
```

Every user keeps ≥1 assignment row (creation adds one; deactivate/remove soft-delete rather
than hard-delete; edit requires ≥1), so scope matching still holds.

### 3. Client components (UI)

Under `src/app/(dashboard)/users/`, decomposed:

- **`users-client.tsx`** — thin container: session, `isAdmin = canManageAnyOpCo(...)`,
  `manageable = manageableOpCoSlugs(...)`, active/inactive/all filter state; renders list +
  onboard button + dialogs.
- **`user-list.tsx`** — rows: name/email, assignment chips (ended ones muted),
  Active/Inactive badge, and for admins a per-row action menu (Edit; Deactivate↔Reactivate
  by current state). Filter All/Active/Inactive (default Active), applied client-side.
- **`onboard-wizard.tsx`** — extracted wizard. Access step (2) becomes a repeatable
  `{OpCo, role}` editor (Add/Remove rows; OpCo options from `manageable`; dedupe OpCos).
  Step 3 renamed **Review** — lists name, email, all `{OpCo, role}` rows, temp-password note.
- **`edit-user-dialog.tsx`** — current assignments as editable rows (role select + remove) +
  Add assignment (OpCo from `manageable` not already present + role). Assignments in OpCos the
  caller can't manage render as **read-only** chips. Save → `setUserAssignments`.
- **`confirm-dialog.tsx`** — small reusable confirm (title/body/confirm/cancel) for Deactivate.
  Reactivate is immediate (low-risk).

Built with existing primitives (`button`, `card`, `input`) + raw `<select>` and the current
overlay-`Card` modal pattern. **No new shadcn deps.**

**i18n** (`src/lib/i18n.ts`, en + fr) — add keys for: Review step title/desc, Deactivate,
Reactivate, Edit, confirm copy, Active/Inactive badges, filter labels, Add/Remove assignment,
and validation messages (duplicate OpCo, ≥1 assignment, self-lockout). The now-orphaned
`users.wizard.stepTeams/teamsDesc/teams/noTeams/country/permissions` keys are left in place
(pre-existing; not deleted).

### 4. Error handling

Server actions throw on authz failure (`Forbidden`) and validation; the client catches in the
existing `useTransition` + `try/catch` and shows an error toast. Keycloak enable/disable stays
a hard-fail (KC down → action fails before DB write). Keycloak org assignment stays
best-effort (warn). Client validation: name/email + ≥1 assignment on onboard; ≥1 remaining on
edit; dedupe OpCos; self-lockout surfaced as a toast.

### 5. Data model

No schema change. Uses existing `User.isActive`, `UserOpCoAssignment.isActive` /
`UserOpCoAssignment.endedAt`. No new migration.

## Testing & verification (gap 5)

Mocked Vitest (mock `@/server/db`, `@/server/keycloak`, `@/lib/session`), following
`src/test/actions/users-authz.test.ts`:

- **`src/test/lib/permissions.test.ts`** — `canManageAnyOpCo` (admin in 2nd org slot → true;
  requester-only → false; group_admin → true) and `manageableOpCoSlugs` (group_admin → "all";
  OpCo admin → only their admin slugs).
- **`src/test/actions/users-authz.test.ts`** — `reactivateUser` authz (reject non-admin; allow
  group_admin; allow OpCo admin for their OpCo); `setUserAssignments` authz + diff (reject
  OpCo admin touching another OpCo; allow group_admin; verify add/remove/role-change calls;
  self-lockout rejects removing own admin); `deactivateUser` self-lockout rejects self.
- Optional light render smoke test for `user-list` (mirrors `dashboard-client.test.tsx`).

Gates (per phase-gate rule): `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, and the deslop
skill — all green before completion.

**Manual verification caveat:** end-to-end login is blocked by the seed's
`REPLACE_WITH_KEYCLOAK_SUB` placeholder (a separate known gap), so unit tests are the primary
verification. The stack (`docker/keycloak` + `pnpm prisma migrate dev` + seed) can be brought
up for component-level checks once login is addressed separately.

## File-by-file change list

**Modify**
- `src/lib/permissions.ts` — add `canManageAnyOpCo`, `manageableOpCoSlugs`.
- `src/components/app-shell.tsx` — gating via `canManageAnyOpCo`.
- `src/app/(dashboard)/teams/teams-client.tsx` — gating via `canManageAnyOpCo`.
- `src/app/(dashboard)/users/page.tsx` — surface inactive users; serialize `isActive` fields.
- `src/app/(dashboard)/users/users-client.tsx` — reduce to container.
- `src/server/actions/users.ts` — add `reactivateUser`, `setUserAssignments`; self-lockout
  guard in `deactivateUser`.
- `src/server/keycloak.ts` — add `reactivateKeycloakUser`.
- `src/lib/i18n.ts` — new keys (en + fr).
- `src/test/lib/permissions.test.ts`, `src/test/actions/users-authz.test.ts` — new cases.

**Add**
- `src/app/(dashboard)/users/user-list.tsx`
- `src/app/(dashboard)/users/onboard-wizard.tsx`
- `src/app/(dashboard)/users/edit-user-dialog.tsx`
- `src/app/(dashboard)/users/confirm-dialog.tsx`
- (optional) `src/test/app/users/user-list.test.tsx`

## Risks & notes

- **Self-lockout only, not "last admin."** We guard a caller against locking *themselves* out;
  we don't prevent removing the last admin of an OpCo. Acceptable — group_admins can always
  recover, and over-guarding adds complexity.
- **Keycloak org membership is one-way.** Removals aren't synced to Keycloak orgs; the app
  reads roles from the DB, so this is intentional and harmless.
- **Orphaned i18n keys** from the old teams step remain (left intentionally, not deleted).
