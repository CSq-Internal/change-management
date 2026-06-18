# Role-Aware Views — Design

**Date:** 2026-06-15
**Type:** Design spec (redesign)
**Status:** Approved — ready for implementation plan
**Sequencing:** Next iteration after the current deploy. Not a pre-deploy change.

## Problem

The app shows the same information to everyone scoped only by OpCo *membership*. Two
symptoms:

1. **The requests page** is a creation form plus a small "My Requests" sidebar (the
   requester's own 8 latest). There is no scoped, tabular way for an admin to see the
   requests they are responsible for.
2. **The dashboard** (`/`) is an operations console — SLA breaches, risk mix, OpCo
   rollups, Triage/Report tabs. Because it scopes by OpCo membership only, a rank-and-file
   requester lands on a full OpCo-wide ops view. That is manager/admin information shown
   to everyone.

Both reduce to one question: **what should each role see?** This design defines a
role-aware information architecture and restructures the requests page and dashboard
around it.

## Persona model (the anchor)

Three tiers, derived from roles already in the system:

| Tier | Who | Primary experience |
|------|-----|--------------------|
| **Member** | A user with no `admin`/`approver` role in any OpCo and not group-level | Personal: their own requests + creating new. No org-wide stats. |
| **OpCo admin / approver** | `admin` or `approver` role in one or more OpCos | Their OpCo(s): scoped requests table + ops dashboard + approvals queue. |
| **Group** | Group-level (`isGroupLevel` — the predicate the app already uses for org-wide visibility) | Everything, all OpCos. |

## Architecture

### 1. Role-scoping helper (foundation)

A single pure function that returns the Prisma `where` predicate for "change requests this
user may browse," so the requests table and the dashboard share one source of truth and
cannot drift.

```
requestScope(session) -> Prisma.ChangeRequestWhereInput
  member            -> { requesterId: <me> }              // own requests only
  opco admin/appr.  -> { opco: { slug: { in: <scoped> } } } // OpCos where admin OR approver
  group level       -> {}                                  // all
```

- `<scoped>` = the union of OpCo slugs where the user holds `admin` or `approver`.
- Tier is decided in priority order: group level → (any admin/approver role) → member.
- This **replaces** the current "scope by any OpCo membership" predicate used in
  `app/page.tsx` and `app/(dashboard)/changes/page.tsx`, which wrongly shows a plain
  member their whole OpCo.
- Lives in a server-safe module (it needs the user's id for the member case; the id is
  resolved from `keycloakId` as elsewhere). Pure and unit-testable given a session +
  resolved user id.

### 2. Requests page → scoped table + New Request

- `/requests` becomes a **tabular requests dashboard**:
  - Reuses the dashboard **filter-bar** component (status / risk / infra / OpCo) and the
    table + **CSV export** patterns already built in `components/dashboard/`.
  - Rows are change requests selected via `requestScope(session)`.
  - Columns: Title, Status, Risk, Infrastructure, OpCo, **Approvals progress** (e.g.
    `1/2` from the change's approvals vs. required), Planned start, Requester (shown for
    admin/group tiers). Row → `/changes/[id]`.
  - A **New Request** button links to `/requests/new`.
- The creation form moves to a dedicated route **`/requests/new`** (not a modal — the form
  is long; a route gives deep-linking and a working back button). The form component and
  its server actions are unchanged; only its mount point moves.
- Editing stays at the existing `/changes/[id]/edit`.

### 3. Retire `/changes`

- The approved/implemented/verified list `/changes` provided is now just a status filter
  on the new table.
- Delete the `/changes` page and **redirect** `/changes` →
  `/requests?status=approved,implemented,verified` so existing links/bookmarks survive.
- `/changes/[id]` (detail) and `/changes/[id]/edit` are **unaffected** — only the list
  index is retired.

### 4. Dashboard + nav role-gating

- `/` ops dashboard becomes **admin-only** (OpCo admin/approver or group level).
- A **member** who hits `/` is **redirected to `/requests`**.
- The **"Dashboard" nav item is hidden for members**, using the same filtering mechanism
  in `app-shell.tsx` that already hides the User Management group from non-admins.
- Dashboard data is scoped through the helper: OpCo admin sees their *managed* OpCo(s)
  (admin/approver), not merely any OpCo they belong to; group level sees all.

### 5. `/approvals` unchanged

Remains the dedicated "act on it" queue. Already correct after the recent fix
(excludes own requests and changes the user already approved).

### 6. Approval data — column only (no new view)

"All approval data scoped" is satisfied by: the **Approvals progress column** on the
requests table + the existing **Approval Matrix** (policy/who-approves) + the
**`/approvals`** queue (act-on-it). **No dedicated approval-activity view** will be built
(YAGNI — confirmed with the user).

## Data flow

```
session ──► requestScope(session) ──► where predicate
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                            ▼
     /requests table query      /  (dashboard) query        /changes redirect
   (all statuses, filters,    (ops metrics, admin-only,   (→ /requests?status=…)
    + approvals column)         member redirected away)
```

## Affected files (indicative, not exhaustive)

- **New:** `lib/request-scope.ts` (helper) + test; `app/(dashboard)/requests/new/page.tsx`
  (form mount); requests table client component.
- **Changed:** `app/(dashboard)/requests/page.tsx` (table instead of form+sidebar);
  `app/page.tsx` (member redirect + scoped via helper); `components/app-shell.tsx`
  (hide Dashboard for members); nav definition.
- **Retired:** `app/(dashboard)/changes/page.tsx` (list) + add redirect.
- **Reused:** `components/dashboard/dashboard-filters.tsx`, `matching-changes-list.tsx`
  patterns, existing `RequestForm`, change-request server actions.

## Testing

- **`requestScope`** — unit tests for all three tiers (member → own; OpCo admin → managed
  slugs; group level → all). Highest-risk logic; test first.
- **Requests table action** — scoped-query test (correct `where` per tier) + a render
  smoke test for the table with filters.
- **Member redirect** — `/` redirects a member to `/requests`; admin renders the dashboard.
- **`/changes` redirect** — preserves the status filter.
- Existing approvals/dashboard suites must stay green.

## Out of scope

- Live notification push (SSE/WebSockets) — tracked separately.
- Dedicated approval-activity / audit-of-approvals view.
- Any change to the approval routing engine or SLA cron.
