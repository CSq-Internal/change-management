# Access Gate + Nav Badge + Admin Notification — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending spec review
**Scope:** Punch-list items #3, #4, #5 from the self-registration access-request follow-ups.

## Goal

Close three gaps in the access-request workflow:

- **#3** — Redirect no-access users away from the *entire* app, not just `/` and `/requests`.
- **#4** — Show a pending-count badge on the "Access Requests" nav item.
- **#5** — Notify admins (in-app **and** email) when an access request is placed, reaching
  group-level admins as well as the target OpCo's admins.

## Out of scope (explicitly)

- The V3 auth-flow pass: Keycloak⇄DB drift on invite, and stale-JWT meaning granted access /
  role edits don't take effect until re-login. This batch does **not** fix JWT staleness — a
  just-granted user may still be bounced by the #3 gate until they re-authenticate. Tracked
  separately.

---

## #3 — Gate the whole app via middleware

### Problem

`hasAnyAccess(...)` redirects live only in `src/app/page.tsx:27` and
`src/app/(dashboard)/requests/page.tsx`. Every other route renders for a no-access user.

A shared `(dashboard)/layout.tsx` gate is **not viable**: `/request-access` lives *inside* the
`(dashboard)` group, so gating the group would redirect a no-access user to a gated page →
redirect loop. A server layout also can't cleanly read the current pathname to exempt itself.

### Approach

Add `src/middleware.ts`. Middleware sees the pathname (so it can exempt the public/landing
routes) and reads the JWT cookie, which already carries `organizations` and `realmRoles`
(written by `enrichedJwt` at sign-in). It computes the gate decision with a **pure helper** and
redirects no-access users to `/request-access`.

- **Token read:** use `getToken` from `next-auth/jwt` (edge-compatible) with `secret`, reading
  `token.organizations` and `token.realmRoles`. This avoids touching the NextAuth composition.
- **Decision helper (pure, unit-tested):**
  `shouldRedirectToRequestAccess(pathname, token): boolean`
  - `false` for exempt prefixes: `/login`, `/request-access`, `/api/auth`.
  - `false` if no token (NextAuth's own auth flow / unauthenticated handling is unchanged — the
    gate only acts on *authenticated but access-less* sessions; unauthenticated users are already
    redirected to `/login` by the existing page-level `auth()` checks).
  - Otherwise `!hasAnyAccess(token.organizations ?? [], token.realmRoles ?? [])`.
- **Matcher:** exclude `_next/static`, `_next/image`, `favicon.ico`, and other static assets so
  the middleware only runs on app routes.
- **Cleanup:** remove the now-redundant `hasAnyAccess` redirect from `page.tsx` and
  `requests/page.tsx`. Keep `page.tsx`'s separate `tier === "member"` redirect (different concern:
  members *have* access but get no ops dashboard).

### Why not delete the page checks entirely / rely only on middleware

Middleware is the single source of truth for the access gate. The page-level `auth()` →
`/login` redirects for *unauthenticated* users stay (middleware doesn't replace login). Only the
duplicated `hasAnyAccess` branches are removed.

---

## #4 — Pending-count badge on "Access Requests"

### Problem

`getNavCounts` (`src/server/actions/notifications.ts:46`) returns only
`{ pendingApprovals, myRequests, unreadNotifications }`. The nav item at
`app-shell.tsx:65` has no badge.

### Approach

- Extend `getNavCounts` to also return `pendingAccessRequests`: a `count` of pending
  `AccessRequest`s scoped exactly as `listAccessRequests` scopes its list — via
  `manageableOpCoSlugs(session.organizations, session.realmRoles)` (group admin → all pending;
  OpCo admin → pending in their admin OpCos; otherwise `0`). Add the key to the no-user
  early-return too.
- In `app-shell.tsx`: add `pendingAccessRequests: 0` to the `navCounts` `useState` default, and
  render a badge for `item.href === "/access-requests"` using the **same markup** as the existing
  `/approvals` badge (rounded pill, `navCounts.pendingAccessRequests`). Consistent with the
  existing badges, which always render (including `0`).

---

## #5 — Notify admins of new access requests (in-app + email)

### Problem

`requestAccess` (`src/server/actions/access-requests.ts:51`) notifies only **OpCo admins** of the
target OpCo (`UserOpCoAssignment role=admin, isActive`), and `notifyUsers` writes **in-app only**.
Two gaps:

1. **Group-level admins** hold the `group_admin` Keycloak *client role*, which is not stored in
   the DB, so they can't be enumerated. If the operator account is group-admin-only, *nobody* is
   notified.
2. No **email** is sent for this event.

### Approach

**Persist a group-admin marker (approved):**

- Schema: add `isGroupAdmin Boolean @default(false)` to `model User`.
- Migration: hand-write `prisma/migrations/<ts>_user_is_group_admin/migration.sql`
  (`ALTER TABLE "User" ADD COLUMN "isGroupAdmin" BOOLEAN NOT NULL DEFAULT false;`) following the
  existing convention (no local shadow DB). Additive and safe; auto-applies on prod deploy via the
  `prisma migrate deploy` step.
- `enrichedJwt` (`src/lib/auth-callbacks.ts`): after the existing reconcile + assignments load,
  sync the marker from the token on every sign-in:
  `db.user.updateMany({ where: { keycloakId: sub }, data: { isGroupAdmin: realmRoles.includes("group_admin") } })`.
  Writing both `true` and `false` means demotions clear. `updateMany` is a no-op (no throw) when no
  row exists (e.g. an unverified email that was neither created nor relinked). Self-heals as admins
  sign in.

**Recipients for a new request** = (active OpCo admins of the target OpCo) ∪ (active users where
`isGroupAdmin = true`), deduped by user id, excluding the requester themselves. Each recipient
carries `{ userId, email, name, locale }`.

**Both channels:**

- **In-app:** existing `notifyUsers` (writes a `Notification` with `changeId: null`, surfaces in
  the bell feed), title localized to each recipient's locale (`notif.access.requested.title`),
  body the language-neutral `"<requester> → <opco>"`.
- **Email:** new `sendAccessRequestEmail({ to, adminName, requesterName, opcoName, locale })` in
  `src/server/email.ts`, following the existing inline fr/en template convention (subject + body
  with a link to `${BASE}/access-requests`). No new `i18n.ts` keys — email copy lives inline like
  the other templates.
- Both fire for every recipient (these admin/operational events bypass the change-oriented
  preference matrix, consistent with how access events already behave). Dispatched with
  `Promise.allSettled` so one failed email never blocks the others or the request itself.

### Data flow

```
requestAccess(opcoSlug, note)
  → create AccessRequest (pending)            [unchanged]
  → recordAdminAction (access.request)        [unchanged]
  → recipients = opcoAdmins(opco) ∪ groupAdmins, deduped, minus requester
  → for each recipient:  notifyUsers(in-app)  +  sendAccessRequestEmail(email)
```

---

## Testing

- **#3:** unit-test the pure `shouldRedirectToRequestAccess` helper — exempt prefixes, no-token,
  has-access (group role / ≥1 org), no-access. (Middleware wiring itself is thin and covered by
  the helper.)
- **#4:** extend the `getNavCounts` action test to assert `pendingAccessRequests` is scoped (group
  admin sees all pending; OpCo admin sees only their OpCos; non-admin sees `0`). App-shell render
  smoke stays green with the new key.
- **#5:** extend the access-requests action test — assert that on `requestAccess`, both the target
  OpCo's admins **and** `isGroupAdmin` users are notified (deduped, requester excluded), and that
  the email sender is invoked per recipient (mock `sendAccessRequestEmail`). Extend the
  auth-enrichment test to assert `isGroupAdmin` is set `true`/`false` from `realmRoles` on sign-in.

## Files touched

- Create: `src/middleware.ts`, `prisma/migrations/<ts>_user_is_group_admin/migration.sql`
- Modify: `prisma/schema.prisma` (User), `src/lib/auth-callbacks.ts` (marker sync),
  `src/lib/permissions.ts` (add pure `shouldRedirectToRequestAccess` helper — lives here beside
  `hasAnyAccess`, edge-safe, so both middleware and the test import it),
  `src/server/actions/notifications.ts` (getNavCounts),
  `src/components/app-shell.tsx` (badge + state), `src/server/actions/access-requests.ts`
  (recipients + email), `src/server/email.ts` (new template), `src/app/page.tsx` +
  `src/app/(dashboard)/requests/page.tsx` (remove redundant redirects)
- Tests: middleware-helper test, `getNavCounts` test, access-requests action test,
  auth-enrichment test
