# Self-service requester access and role elevation

**Status:** design agreed 2026-10-16, awaiting spec review
**Branch:** `feat/self-service-requester` (from `dev`)

## Goal

Nobody waits for an admin before they can use the CMS. A first sign-in picks an OpCo
and becomes a requester there at once. Any role above requester (approver, auditor,
admin) is asked for through an elevation request that an admin approves.

## Decisions (the user's)

- On first sign-in the user **picks their OpCo**. They become a requester there with no
  approval. An admin can move them later.
- Elevation is **request + approve**. The user asks for approver, auditor or admin with a
  reason. The existing role-assignment rules decide who approves.
- The OpCo screen carries a notice: they start as a requester and must request elevated
  privileges if they need more.

## Today

- A first sign-in creates a `User` row with no `UserOpCoAssignment`.
  `shouldRedirectToRequestAccess` (`src/lib/permissions.ts`) sends any session with no
  standing access to `/request-access`.
- `/request-access` lets the user pick an OpCo and add a note. `requestAccess` creates a
  pending `AccessRequest` with role `requester`, and the OpCo's admins are notified.
- `/access-requests` lists pending requests the caller can decide. `approveAccessRequest`
  upserts the assignment; `denyAccessRequest` records a reason. Both are gated by
  `canAssignRole` and write admin-audit rows.
- Sessions reload OpCo roles from the DB every 60 seconds (`ORGS_TTL_MS` in
  `src/lib/auth-callbacks.ts`).
- Each user has one role per OpCo (`@@unique([userId, opcoId])`).
- `createChange` only checks OpCo membership, so approvers, auditors and admins can
  still raise changes. Elevating a requester doesn't take that away.

## Design

### 1. First sign-in: choose your OpCo

- The gate is unchanged. A session with no OpCo role and no group role is still sent to
  `/request-access`; the route keeps its path so the proxy, its exempt list and existing
  links keep working.
- The page becomes a one-step **Choose your OpCo** screen: one OpCo dropdown (active,
  non-archived OpCos, sorted by name) and a **Continue** button. There's no note field
  and no request history.
- **Notice** (above the button, EN and FR):
  - EN: "You'll start as a requester: you can raise and track changes for this OpCo. If
    you need to approve, audit or administer changes, request a role from Settings →
    Profile once you're in."
  - FR: "Vous commencerez en tant que demandeur : vous pourrez créer et suivre des
    changements pour cette OpCo. Pour approuver, auditer ou administrer des changements,
    demandez un rôle depuis Paramètres → Profil une fois connecté."
- New server action `joinOpCo(opcoSlug)` in `src/server/actions/access-requests.ts`:
  - It refuses if the caller already has any active `UserOpCoAssignment` ("You already
    belong to an OpCo"), so it can't be used to collect OpCos. A second OpCo is added by
    an admin on the Users page, or by requesting a higher role there.
  - It refuses an unknown or archived OpCo.
  - In one transaction it upserts a `requester` assignment for the caller in that OpCo
    (this reactivates an ended one) and writes an admin-audit row `access.self_joined`.
  - It sends an in-app notice to that OpCo's active admins only, not email (type
    `access.joined`, title "New requester joined", body "<name> → <OpCo>").
- **Session refresh:** after `joinOpCo` succeeds, the client calls `update()` from
  `useSession` and then navigates to `/`. `enrichedJwt` reloads OpCo roles whenever
  NextAuth calls it with `trigger === "update"`, whatever the TTL. Without this the gate
  would hold the user for up to 60 seconds.

### 2. Elevation: request a role

- **Settings → Profile** gets a **Request a role** card. It's shown to any user with
  at least one OpCo role. It has:
  - OpCo: any active OpCo, defaulting to the active one.
  - Role: approver, auditor or admin.
  - Reason: required, up to 500 characters.
- Under the card, the user's own requests are listed newest first: OpCo, role, status,
  and the decision reason when denied.
- New server action `requestRole({ opcoSlug, role, reason })` replaces `requestAccess`:
  - It refuses the `requester` role and the group roles.
  - It refuses a role the caller already holds in that OpCo.
  - It refuses a second pending request for the same OpCo ("You already have a pending
    request for this OpCo").
  - It creates a pending `AccessRequest` with `role` and `note` = reason, and writes an
    admin-audit row `access.requested`.
  - **Who is notified** depends on the role, so it matches the `canAssignRole` rule:
    approver or auditor go to the OpCo's active admins plus active group admins; admin
    goes to active group admins only. Notices go in-app and by email (the existing
    `access-request` email template), and the requester is never notified of their own
    request.
- **Deciding:** `/access-requests` stays where it is, relabelled **Role requests** (nav and page
  title, EN and FR), and gains a Role column. `listAccessRequests`, `approveAccessRequest`
  and `denyAccessRequest` are unchanged apart from copy. Approving replaces the user's
  role in that OpCo, or adds the OpCo if they weren't in it, and their session picks it
  up within 60 seconds. The requester is told the outcome as today.
- Admins can still change roles directly on the Users page.

### 3. Removed

- `requestAccess` and the gate page's note field, request list and status display.
- i18n keys only those pieces used.
- Copy: "access request" becomes "role request" in the notification titles and email
  subject.

### 4. Data at deploy

Prisma migration `20261016120000_self_service_requester`, data only, no schema change:

- For every pending `AccessRequest` with role `requester`, it upserts the matching active
  `UserOpCoAssignment` (requester) and marks the request `approved`, with `decidedAt =
  now()`, `decidedById = NULL` and `decisionReason = 'Auto-approved: requester access is
  self-service'`.
- Pending requests for any other role are left in the queue.

## Out of scope

- Deriving a user's OpCo from Google Workspace data.
- Self-service requester membership of a second OpCo (an admin adds it on the Users page).
- Changing who can assign which role (`canAssignRole` stays as is).
- Group roles (`group_admin`, `group_auditor`), which stay in Keycloak.

## Testing

- `joinOpCo`:
  - creates a requester assignment and an `access.self_joined` audit row;
  - refuses a caller who already has an assignment;
  - refuses an unknown or archived OpCo;
  - reactivates an ended assignment;
  - notifies the OpCo's admins in-app only.
- `requestRole`:
  - refuses `requester` and group roles;
  - refuses a role already held;
  - refuses a duplicate pending request for the OpCo;
  - notifies OpCo admins and group admins for approver and auditor, and only group admins for admin;
  - never notifies the requester.
- `enrichedJwt`: reloads organizations on `trigger: "update"` inside the TTL.
- Gate page render: shows the dropdown and the notice in EN and FR.
- Migration: one SQL test against the Testcontainers Postgres. A pending requester request
  becomes an assignment plus an approved request; a pending approver request is untouched.
- Smoke (Playwright, dev): first sign-in, choose OpCo, land on the dashboard as requester,
  request approver, an admin approves, then the Approvals nav appears within 60 seconds.
