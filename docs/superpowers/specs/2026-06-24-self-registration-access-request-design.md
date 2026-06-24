# Self-Registration Access-Request Workflow — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorm) — ready for implementation plan
**Author:** Christian Koranteng (with Claude)

## Problem

The CMS authenticates users via Keycloak with brokered Google SSO, restricted to
`@csquared.com` identities. A user can complete Google sign-in **before** an admin has
provisioned them. Two defects follow:

1. **Invisible users.** `enrichedJwt` (`src/lib/auth-callbacks.ts:38`) only creates a DB
   `User` row when `p.email && p.email_verified`. Brokered Google identities through Keycloak
   do not reliably carry `email_verified`, so **no row is created** on sign-in. The user can
   authenticate but never appears in the User Management list — an admin cannot see or act on
   them. (Confirmed in production: a self-signed-in user was invisible until manually onboarded.)

2. **No self-service path.** Even once visible, the only way a user gets access is for an admin
   to *discover* them and *guess* which OpCo and role they need. There is no way for the user to
   declare "I need requester access in OpCo X."

Authentication ≠ authorization here: passing Google SSO must **not** grant any standing access.
The fix must keep that boundary while making self-registered users discoverable and giving them
a vetted, auditable path to access.

## Goals

- Every successful sign-in produces a `User` row (discoverable), with **zero assignments** by
  default ("authenticated, no access").
- A no-access user can submit a **request for `requester` access in a chosen OpCo**.
- Requests route to admins who can already grant that role; approval grants the assignment.
- The whole flow is audited and notified, in both English and French.

## Non-Goals

- Self-service requests for `approver`, `auditor`, `admin`, or any group-level role. Those
  remain on the deliberate admin-onboarding path (the existing onboard wizard). **Only
  `requester` is self-requestable.**
- Multi-OpCo requests in a single submission (one request targets one OpCo).
- Auto-granting any access on sign-in.
- Touching the change-centric `notifyEvent` dispatch.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Root-cause fix | Relax the `email_verified` gate in `enrichedJwt` (still require `p.email`) |
| Default on sign-in | DB row with **no** assignments ("authenticated, no access") |
| Flow weight | **Full approval workflow** — first-class `AccessRequest` entity with statuses |
| Requestable role | **`requester` only** |
| Request scope | One request = one OpCo |
| Approver | Anyone who can `canAssignRole(requester, opco)` — OpCo admin of the target OpCo, or group admin |
| Notification routing | Notify OpCo admins of the target OpCo directly; group admins pick up from the queue (pull) |
| Dedup | No second *pending* request for an OpCo where one is already pending or the user is already an active requester |

## Architecture

### 1. Auth gate (root-cause fix)

In `src/lib/auth-callbacks.ts`, the link-or-create block (currently line 38) changes from:

```ts
if (p.email && p.email_verified) { ... upsert ... }
```

to require only a present email:

```ts
if (p.email) { ... upsert ... }
```

Rationale: the trust boundary is Keycloak's realm restriction to `@csquared.com` brokered
identities, not the OIDC `email_verified` claim (which Google brokering doesn't reliably
propagate). The upsert still keys on `email` and backfills `keycloakId`, so pre-seeded users
continue to link correctly. The created row has **no `UserOpCoAssignment`** rows — it is
discoverable in User Management but carries no authority.

### 2. Data model — new `AccessRequest`

```prisma
enum AccessRequestStatus {
  pending
  approved
  denied
}

model AccessRequest {
  id             String              @id @default(cuid())
  userId         String              // the requesting user
  opcoId         String              // target OpCo
  role           Role                // always `requester` (enforced in the action)
  note           String?             // user's optional justification
  status         AccessRequestStatus @default(pending)
  decidedById    String?             // admin who approved/denied
  decidedAt      DateTime?
  decisionReason String?             // optional reason, primarily for denials
  createdAt      DateTime            @default(now())

  user      User  @relation("AccessRequestRequester", fields: [userId], references: [id])
  opco      OpCo  @relation(fields: [opcoId], references: [id])
  decidedBy User? @relation("AccessRequestDecider", fields: [decidedById], references: [id])

  @@index([opcoId, status])
  @@index([userId, status])
}
```

Back-relations added to `User` (`accessRequests` + `accessRequestsDecided`) and `OpCo`
(`accessRequests`). `role` is stored (not hardcoded) so the approve action reads what to grant
and the audit trail is explicit; the `requestAccess` action enforces `role === requester`.

Dedup is **enforced in the action** (check for an existing pending request / active requester
assignment before create), not via a DB constraint — Prisma cannot express a partial unique
index (`UNIQUE (userId, opcoId) WHERE status = 'pending'`) declaratively, and the app-level
guard is sufficient and clearer.

### 3. Server actions — `src/server/actions/access-requests.ts`

All actions resolve the caller via `getAppSession()` and the DB user by `keycloakId`.

- **`requestAccess({ opcoSlug, note? })`**
  - Caller must have a DB row (they will, post-fix). Resolve target `OpCo` by slug.
  - Reject if the caller is already an active `requester` in that OpCo.
  - Reject if the caller already has a `pending` `AccessRequest` for that OpCo.
  - Create `AccessRequest { role: requester, status: pending, note }`.
  - Notify OpCo admins of the target OpCo (`access.requested`).
  - Record an audit action (`access.request`).

- **`approveAccessRequest(id)`**
  - Load request; reject if not `pending`.
  - Authz: `canAssignRole(session.organizations, session.realmRoles, opco.slug, "requester")`.
  - In a transaction: `upsert UserOpCoAssignment(requester, isActive)`, set request
    `status = approved`, `decidedById`, `decidedAt`; `recordAdminAction("access.approve")`.
  - Best-effort `assignToOrganization(keycloakId, opcoSlug)` (mirror `onboardUser`, warn on failure).
  - Notify the requesting user (`access.approved`).

- **`denyAccessRequest(id, reason?)`**
  - Load request; reject if not `pending`. Same authz as approve.
  - Set `status = denied`, `decidedById`, `decidedAt`, `decisionReason`;
    `recordAdminAction("access.deny")`.
  - Notify the requesting user (`access.denied`).

- **`listAccessRequests()`**
  - Returns `pending` requests scoped to OpCos the caller can manage. Group-level callers
    (`isGroupLevel`) see all; OpCo admins see requests whose `opco.slug` is in their
    `manageableOpCoSlugs`. Auditors get nothing actionable here.

### 4. Notifications

`notifyEvent` is change-bound (requires `change: {id, title, opcoId}` and stamps `changeId`) and
stays untouched. Add a small change-free helper to `src/server/notify.ts`:

```ts
export async function notifyUsers(
  recipients: NotifyRecipient[],
  msg: { type: string; title: string; body: string }
): Promise<void>
```

It creates `Notification` rows directly with `changeId: null` (the column is nullable), one per
recipient, so they surface in the existing bell feed. New notification `type` strings:
`access.requested`, `access.approved`, `access.denied`. (These bypass the change-oriented
`NotificationPreference` matrix — access-workflow notifications are always delivered in-app.)

Recipient enumeration:
- `access.requested` → OpCo admins of the target OpCo: `userOpCoAssignment` where
  `role = admin`, `isActive`, `opcoId = target`. (Reuses the pattern in `src/server/sla.ts`.)
- `access.approved` / `access.denied` → the single requesting user.

### 5. UI

**No-access detection.** A signed-in user has "no access" when they hold no group-level role and
no active OpCo assignment. Add a helper to `src/lib/permissions.ts`:

```ts
export function hasAnyAccess(organizations: SessionOrganization[], realmRoles: string[]): boolean {
  return isGroupLevel(realmRoles) || organizations.length > 0
}
```

**Request-access landing — `/request-access`.** When a no-access user lands on any
`(dashboard)` route, redirect them here (instead of an empty dashboard). The
`/request-access` route itself is **exempt** from this redirect (so it cannot loop), and so is
any admin route that a no-access user could never reach anyway. The page:
- Lists OpCos they can request (all OpCos, minus ones where they're already requester/pending).
- Lets them pick one OpCo + an optional note → submit (`requestAccess`).
- Shows their own requests with current status (pending / approved / denied + reason).

A user who already has access never sees this page (it redirects them to the dashboard).

**Admin queue — `/access-requests`.** New nav item, gated like User Management (visible to group
admins and OpCo admins). Lists actionable `pending` requests (`listAccessRequests`) with
requester, OpCo, note, and **Approve** / **Deny** (with optional reason) actions. The bell feed
already surfaces the underlying notifications.

### 6. Audit

New `recordAdminAction` action strings: `access.request`, `access.approve`, `access.deny`, each
with the request id, target user, and OpCo in the summary/metadata — consistent with existing
admin-action auditing.

## Testing

- **Action suite** (`src/test/actions/access-requests.test.ts`):
  - `requestAccess` creates a pending request and notifies OpCo admins.
  - `requestAccess` rejects a duplicate pending request and rejects when already a requester.
  - `requestAccess` rejects a non-`requester` role (defends the cap).
  - `approveAccessRequest` requires `canAssignRole`, creates the assignment, flips status,
    notifies the requester, and is rejected for non-pending requests.
  - `denyAccessRequest` requires authz, records the reason, notifies the requester.
  - `listAccessRequests` scoping: group admin sees all; OpCo admin sees only their OpCos.
- **Permissions** (`src/test/lib/permissions.test.ts`): `hasAnyAccess` truth table.
- **Render smoke**: `/request-access` (no-access user) and `/access-requests` (admin) render.

## i18n

New flat keys in `src/lib/i18n.ts` for both `en` and `fr`: page titles, OpCo/role labels,
note field, submit/approve/deny buttons, status labels, empty/confirmation states, and the
three notification title/body templates.

## Files Touched (summary)

- Modify: `src/lib/auth-callbacks.ts` (relax gate)
- Modify: `prisma/schema.prisma` (+ `AccessRequest`, `AccessRequestStatus`, back-relations) + migration
- Create: `src/server/actions/access-requests.ts`
- Modify: `src/server/notify.ts` (+ `notifyUsers`)
- Modify: `src/lib/permissions.ts` (+ `hasAnyAccess`)
- Create: `src/app/(dashboard)/request-access/page.tsx` (+ client)
- Create: `src/app/(dashboard)/access-requests/page.tsx` (+ client)
- Modify: route gating / `AppShell` nav (add `/access-requests`, redirect no-access users)
- Modify: `src/lib/i18n.ts` (+ keys)
- Create: tests as listed above
