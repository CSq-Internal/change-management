# Admin Console UI — Design Spec (Plan F)

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plans
**Scope:** The front-end for the Admin & Governance backend (Plans A–E). Six capability-gated admin surfaces wired to the existing server actions, built on one shared page template.

## Summary

Plans A–E built the entire Admin & Governance backend (users/roles, teams, CAB, OpCo lifecycle, delegations) with server actions and atomic auditing. This spec designs the **Admin Console UI** that exposes those actions. It is one cohesive design implemented as **three sequenced plans** (F1–F3). No new backend domains; only a couple of small read helpers for picker dialogs, plus i18n keys.

## Information Architecture

Rename the existing **"User Management"** sidebar group (`nav.userManagement` in `app-shell.tsx`) to **"Administration"**. It contains six pages, each its own route and individually capability-gated:

| Page | Route | Visible to | Status |
|---|---|---|---|
| Users | `/users` | group_admin (all) / OpCo admin (own) | exists — align to template/nav |
| Teams | `/teams` | admins, own OpCo | exists as stub — wire to `teams.ts` |
| CAB | `/cab` | admins; group_admin for Group tab | new |
| Delegations | `/delegations` | admins, own OpCo | new |
| OpCos | `/opcos` | **group_admin only** | new |
| Audit log | `/admin-audit` | group_admin (all), OpCo admin (own entries), group_auditor (read all) | new |

**Group visibility:** the Administration group renders if `canManageAnyOpCo(orgs, realmRoles)` **or** `isGroupLevel(realmRoles)` (the latter so a `group_auditor`, who is not an OpCo admin, still reaches the read-only Audit page). Each nav item is then gated individually:
- Users / Teams / CAB / Delegations → `canManageAnyOpCo`
- OpCos → `isGroupAdmin`
- Audit log → `canManageAnyOpCo || isGroupLevel`

The current `/approval-matrix` stub (in the Insights group) is left untouched — CAB gets its own `/cab` route rather than repurposing it, to keep the admin surfaces together in the Administration group.

## Shared Surface Template

Every admin page follows one structure (matching the existing Users page and `dashboard-client.test.tsx` conventions):

1. **Server component (`page.tsx`)** — calls `auth()`, redirects if unauthenticated, reads the **active-OpCo cookie** (`csq-active-opco`) plus the caller's manageable scope, fetches data (via the list server actions where they exist, else a scoped Prisma query), serializes to plain props, and renders the client component.
2. **Client component (`*-client.tsx`)** — header (title + primary action button) → table with row actions → **modal dialogs** for create/edit, reusing `confirm-dialog.tsx` (destructive actions) and the `edit-user-dialog.tsx` modal style. Capability checks from the session drive which buttons render (server actions still enforce authz).

Only CAB needs tabs: **Per-OpCo | Group CAB**.

## OpCo Scoping

Pages follow the existing header `OpCoSwitcher`, which stores the active OpCo in the `csq-active-opco` cookie (group_admin: "All OpCos" + each; OpCo members: their OpCos):

- **Specific OpCo selected** → page shows only that OpCo's rows; "+ New" targets that OpCo.
- **"All OpCos"** (group_admin) → **aggregate table with an OpCo column**; "+ New" prompts for which OpCo.

`manageableOpCoSlugs(orgs, realmRoles)` already provides the scope set (`"all"` or the admin-slug list) the server queries filter by; group-level read pages additionally honor `isGroupLevel`.

## Per-Surface Detail

### Users (`/users`) — F1
Already implemented (onboarding add-by-email, edit roles with the `admin` ceiling, deactivate/reactivate, scoped to managed OpCos). F1 only aligns it to the renamed nav group and confirms it matches the template. No behavior change.

### Teams (`/teams`) — F1
Replace the Zustand store stub (`teams-client.tsx`) with real data from the `teams.ts` actions:
- Aggregate/specific table of teams (name, OpCo, member count).
- Create/edit/delete team dialogs (`createTeam`/`updateTeam`/`deleteTeam`).
- Member management: add (`addTeamMember`, role lead/member), remove, set-lead (`setTeamMemberRole`). The add-member picker lists users assigned to the team's OpCo — needs a small read helper **`listOpCoMembers(opcoSlug)`** (active assignments in the OpCo).

### CAB (`/cab`) — F2
- **Per-OpCo tab:** member table for the active OpCo (`listCabMembers(slug)`); add dialog lists approver-eligible users; remove (soft) with confirm.
- **Group CAB tab** (group_admin only): `listCabMembers(null)`; add/remove against the group CAB.
- Add dialogs need an **approver-eligible picker** — small read helper **`listOpCoApprovers(opcoSlug | null)`** (users holding active `approver` in the OpCo, or any OpCo for the group CAB).

### Delegations (`/delegations`) — F2
- Table of active delegations for the active OpCo (`listDelegations(slug)`): from → to, valid-until.
- Create dialog: pick delegator + delegatee from the approver-eligible picker, set `validUntil` (`createDelegation`).
- Revoke (soft) with confirm (`revokeDelegation`).

### OpCos (`/opcos`) — F3 (group_admin only)
- Table of all OpCos (name, slug, status active/archived).
- Create dialog (`createOpCo` — slug + name + locale).
- Rename dialog (`renameOpCo`).
- Archive / unarchive toggle with confirm (`archiveOpCo`/`unarchiveOpCo`).
- Needs a small read for the OpCo list (scoped Prisma query in the server component).

### Audit log (`/admin-audit`) — F3
- Read-only, filterable table of `AdminAuditLog` (actor · action · target user · OpCo · summary · timestamp), newest first.
- Filters: OpCo, action type, date range.
- Scope: group_admin → all; OpCo admin → entries for OpCos they manage; group_auditor → read all. Needs a small read helper **`listAdminAudit(filters)`** (scoped query) since there is no list action yet.

## Small Backend Additions

These read helpers are added with the plan that first needs them (server actions in the relevant `actions/*.ts`):
- `listOpCoMembers(opcoSlug)` — F1 (Teams add-member picker).
- `listOpCoApprovers(opcoSlug | null)` — F2 (CAB & Delegations pickers).
- `listAdminAudit({ opcoSlug?, action?, from?, to? })` — F3 (Audit page), scoped by the caller's manageable OpCos / group-level read.

Each enforces read authz consistent with its page (admins / auditors / group-level) and is unit-tested like the existing actions.

## Testing

- **Unit:** a render smoke test per client component (mocked props), mirroring `src/app/dashboard-client.test.tsx` — asserts the table renders rows and the primary action is present/gated.
- **Backend read helpers:** mocked-Prisma authz tests like the existing action tests.
- **Local end-to-end (manual):** bring up `docker/keycloak/docker-compose.yml` (Keycloak + `postgres:16` on 5432), `pnpm prisma migrate deploy`, seed, `pnpm dev`. The pages and actions run; live *login* still depends on the separate Keycloak token-claims fix.

## Internationalization

All new user-visible strings go through `t(language, key)` with English + French entries added to `src/lib/i18n.ts`, per existing convention. New `nav.*` keys for the renamed group and new pages.

## Phasing

One spec, three sequenced plans (each its own branch, merged as it lands):
- **F1** — Users (align) + Teams (wire) + `listOpCoMembers`.
- **F2** — CAB + Delegations + `listOpCoApprovers`.
- **F3** — OpCos + Audit log + `listAdminAudit`.

## Out of Scope

- CAB **engagement** workflow (when the group CAB supersedes an OpCo CAB on a change) — approval-workflow, separate spec.
- **Team → change assignment** UI — teams aren't linked to changes in the schema yet.
- The live-login **Keycloak token-claims** fix (pre-existing blocker, unrelated).
- Repurposing/removing the legacy `/approval-matrix` stub.
