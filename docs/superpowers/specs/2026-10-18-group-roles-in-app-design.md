# Group roles in the app — design

Date: 2026-10-18
Status: approved in conversation, awaiting written-spec review

## Goal

Move the two group-wide roles, `group_admin` and `group_auditor`, out of Keycloak
(`csquared-cms` client roles) and into the CMS database. Keycloak becomes identity only.

Success means:

- A group admin grants or revokes a group role from the Users page.
- The change reaches the target's open session within 60 seconds, without re-login.
- Every grant and revoke leaves an admin audit row.
- No CMS code reads Keycloak roles, and the Keycloak Organizations mirror is gone.

## Decisions already made

- Storage: flags on `User` (not a separate table).
- Cutover: migrate the current holders, then a clean cut. No period where both sources count.
- Scope includes dropping the Keycloak Organizations sync (`assignToOrganization`,
  `createKeycloakOrg`, `OpCo.keycloakOrgId`).
- Keycloak account creation at onboarding (`createOrFindKeycloakUser`,
  `verifyAdoptedKeycloakUser`, `getAdminToken`) stays until first-login autolink is verified
  with a never-linked user.

## 1. Data model and session

- `User.isGroupAdmin` (exists) becomes the source of truth.
- New `User.isGroupAuditor Boolean @default(false)`. The two flags are never both true;
  `setGroupRole` (section 2) is the only writer and enforces it.
- `src/auth.config.ts` stops reading `resource_access["csquared-cms"].roles`.
- `enrichedJwt` (`src/lib/auth-callbacks.ts`) builds `token.realmRoles` from the flags:
  `["group_admin"]`, `["group_auditor"]` or `[]`.
  - On sign-in: read the flags with the user row it already loads.
  - On the existing refresh (`ORGS_TTL_MS` = 60s, or `trigger === "update"`): reload the
    flags in the same query as OpCo assignments.
  - The sign-in write `isGroupAdmin: realmRoles.includes("group_admin")` is removed;
    otherwise every sign-in would overwrite CMS grants with Keycloak's view. The name
    re-sync in that `updateMany` stays.
- The session field keeps the name `realmRoles`, so the ~160 permission checks are
  untouched. The type comment in `src/types/next-auth.d.ts` says the value now comes from
  the DB.
- The orphan path (inactive or unlinked user) is unchanged.

## 2. Granting and revoking

### Server action

`setGroupRole(userId: string, role: "group_admin" | "group_auditor" | null)` in
`src/server/actions/users.ts`. One transaction writes both flags and the audit row.

### Rules (server-side, each tested)

1. Caller must be a group admin, else `Forbidden`. OpCo admins cannot grant group roles.
2. Caller cannot change their own group role (`Forbidden: cannot change your own group role`).
3. At least one active group admin must remain. Same shape as `assertNotLastAdmin`: count
   active users with `isGroupAdmin = true` other than the target. The same check is added
   to `deactivateUser` when the target is a group admin.
4. Target must be an active user.
5. `reactivateUser` on a user with either flag requires the caller to be a group admin.
   The flags are left as they were through deactivation.

Two group admins demoting each other at the same instant could both pass rule 3, so the
transaction runs at `Serializable` isolation: one of them fails with a serialization error,
shown as an error toast, and nothing is written for it.

### Audit

`recordAdminAction` with `action: "user.group_role"`, `targetUserId`,
`summary: "Group role: <from> → <to>"` (`none` for null) and `metadata: { from, to }`.
`"user.group_role"` joins the admin-audit `ACTIONS` list (the completeness test enforces
it), with en/fr labels.

### UI

- `src/app/(dashboard)/users/edit-user-dialog.tsx`: a "Group role" select
  (None / Group admin / Group auditor), shown only when the viewer is a group admin.
- `user-list.tsx`: the badge also shows Group auditor; `hasAccess` counts
  `isGroupAuditor`.
- `users/types.ts` and `users/page.tsx` carry `isGroupAuditor`.
- New strings in `src/lib/i18n.ts`, en and fr.

### Out of scope

Bulk grants, approval workflow for group roles, group roles in the self-service role
request card.

## 3. Cutover

### Migration `20261019120000_group_roles_in_app`

1. `ALTER TABLE "User" ADD COLUMN "isGroupAuditor" BOOLEAN NOT NULL DEFAULT false`.
2. `ALTER TABLE "OpCo" ALTER COLUMN "keycloakOrgId" DROP NOT NULL`. The field leaves
   `schema.prisma` now; the column itself is dropped later (section 4) so a code revert
   still finds it.
3. Guard: a `DO` block that raises an exception when no row has
   `"isGroupAdmin" AND "isActive"`. A database with no group admin could never grant one
   under the new model, so the deploy stops instead.

The migration changes no flag values. The real holder list lives in prod Keycloak, which
the migration cannot read.

### Prod checklist (before the deploy that enables the new code)

1. User exports the members of `csquared-cms` client roles `group_admin` and
   `group_auditor` from the prod Keycloak console.
2. Claude diffs that list against active prod users with `isGroupAdmin = true`
   (read-only, via the Cloud SQL Auth Proxy). This catches stale `true` flags from people
   demoted in Keycloak who have not signed in since.
3. User confirms the final lists.
4. Claude prepares one SQL transaction that sets both flags to exactly the confirmed lists.
   User approves it before it runs.
5. Keycloak holders with no DB row are listed. After their first sign-in, an existing
   group admin grants them the role in the CMS (audited).

Role changes made in Keycloak between step 1 and the deploy are not picked up.

### Local and dev

- `prisma/seed.ts` sets `isGroupAdmin: true` on `devops@csquared.com` (today it gets the
  role from Keycloak) and drops `keycloakOrgId` from the OpCo seeds.
- Dev (Neon): Claude runs the same flag alignment on the test data and reports the changes.

### Deploy order

Migration and code ship together through the normal dev → prod pipeline. The Keycloak
client roles and mapper stay in place, unread, and `keycloakOrgId` stays as a nullable
column, until section 4's cleanup. A code revert therefore restores the old behaviour with
one caveat: an OpCo created on the new code has a null `keycloakOrgId`, which the old client
cannot read. The flags written by `setGroupRole` would be overwritten by Keycloak's view at
each sign-in on the old code.

## 4. Keycloak cleanup and tests

### Code removed

- `src/auth.config.ts`: the `resource_access` read.
- `src/server/keycloak.ts`: `assignToOrganization`, `createKeycloakOrg`.
- Callers and their try/catch blocks: `src/server/actions/users.ts` (onboarding and
  `setUserAssignments`), `src/server/actions/access-requests.ts` (`joinOpCo` and request
  approval), `src/server/actions/opcos.ts` (`createOpCo`).
- `OpCo.keycloakOrgId` in `prisma/schema.prisma`, the seed and every test fixture that
  sets it. A follow-up migration `DROP COLUMN "keycloakOrgId"` ships in the same PR as the
  prod Keycloak cleanup below, once a revert is no longer wanted.

### Keycloak configuration (`csquared-cms` client only; the realm is shared with the DMP)

- Local `docker/keycloak/realms/csquared-realm.json`: remove the client-role mapper,
  `roles.client["csquared-cms"]` and devops's `clientRoles`. Committed with the code.
- Prod, done by the user once prod has run cleanly on the new code for a few days: delete
  the client-role mapper and the two client roles on `csquared-cms`. The service account's
  `manage-users` stays; onboarding still uses it.
- `docs/keycloak-realm-and-google-sso-setup.md`: remove the group-role sections; add that
  group roles are granted in the CMS under Users.
- `CLAUDE.md` auth paragraph: group roles come from the DB.

### Tests (written first, watched failing)

- `src/test/auth-enrichment.test.ts`: `realmRoles` from the flags; a token carrying
  `resource_access` roles but no flag gets none; the 60s refresh picks up a grant and a
  revoke; sign-in no longer writes `isGroupAdmin`.
- `src/test/actions/users-authz.test.ts`: the five rules in section 2, the last-admin check
  in `deactivateUser`, the group-admin gate on reactivation.
- `setGroupRole`: audit row with `{ from, to }`; setting one role clears the other.
- Integration (Testcontainers): the migration guard fails with zero active group admins and
  passes with one.
- `users-reconcile`, `opcos`, `access-requests` tests drop the `assignToOrganization` /
  `createKeycloakOrg` mocks and assertions.
- UI: the edit dialog shows the Group role select only to a group admin.

### Gates

`pnpm tsc --noEmit` clean, `pnpm vitest run` green, `pnpm lint` with no new warnings, then a
Playwright smoke on the isolated stack: devops grants a second user `group_auditor`; that
user's open session gains audit access within 60s without re-login; devops cannot demote
themselves; the audit row appears.
