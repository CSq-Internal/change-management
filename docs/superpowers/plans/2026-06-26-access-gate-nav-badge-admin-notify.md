# Access Gate + Nav Badge + Admin Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the whole app behind access (#3), add a pending-count badge to the Access Requests nav item (#4), and notify OpCo + group-level admins of new access requests in-app and by email (#5).

**Architecture:** A new edge `src/middleware.ts` reads the session JWT and redirects access-less users to `/request-access` via a pure, unit-tested helper in `permissions.ts`. `getNavCounts` gains a scoped pending-access-request count surfaced as a sidebar badge. A new `isGroupAdmin` column on `User`, synced from the token at every sign-in, makes group-level admins enumerable so `requestAccess` can notify them (plus the target OpCo's admins) over both the in-app feed and a new transactional email.

**Tech Stack:** Next.js App Router, NextAuth v5 (Auth.js beta.31, split edge/node config), Prisma 7 / Postgres, Vitest + React Testing Library, Resend/SMTP email.

## Global Constraints

- Use `pnpm` for all commands. Tests: `pnpm test` (vitest run).
- NO `Co-Authored-By` trailers in commit messages.
- Stage only the explicit files named in each commit step (`git add <files>`) — never `git add -A`/`.`.
- `src/auth.config.ts` and anything imported by `src/middleware.ts` MUST remain edge-safe — NO `@/server/db` (pg) imports. `src/lib/permissions.ts` is edge-safe (imports only a type) and stays that way.
- next-auth is `5.0.0-beta.31`; the secret env var is `NEXTAUTH_SECRET` (Auth.js v5 reads it as a fallback for `AUTH_SECRET`).
- Email copy lives inline (fr/en) in `src/server/email.ts` following the existing template style — no new `i18n.ts` keys for email.
- Branch is already `feat/access-gate-nav-badge-admin-notify` (off `dev`). Do not switch branches.

---

## File Structure

- `src/lib/permissions.ts` — add pure `shouldRedirectToRequestAccess(pathname, token)` beside `hasAnyAccess`.
- `src/middleware.ts` (new) — edge NextAuth instance + gate redirect + route matcher.
- `src/app/page.tsx`, `src/app/(dashboard)/requests/page.tsx` — remove the now-redundant `hasAnyAccess` redirects.
- `src/server/actions/notifications.ts` — `getNavCounts` returns `pendingAccessRequests`.
- `src/components/app-shell.tsx` — badge on the `/access-requests` nav item + state key.
- `prisma/schema.prisma` + `prisma/migrations/20260626120000_user_is_group_admin/migration.sql` — `isGroupAdmin` column.
- `src/lib/auth-callbacks.ts` — sync `isGroupAdmin` from the token in `enrichedJwt`.
- `src/server/email.ts` — new `sendAccessRequestEmail`.
- `src/server/actions/access-requests.ts` — recipients = OpCo admins ∪ group admins; both channels.
- Tests: `src/test/lib/permissions.test.ts`, `src/test/actions/notifications.test.ts`, `src/test/auth-enrichment.test.ts`, `src/test/actions/access-requests.test.ts`.

---

## Task 1: Whole-app access gate (#3)

**Files:**
- Modify: `src/lib/permissions.ts` (add helper near `hasAnyAccess`, ~line 56)
- Test: `src/test/lib/permissions.test.ts`
- Create: `src/middleware.ts`
- Modify: `src/app/page.tsx:27` (remove redirect), `src/app/(dashboard)/requests/page.tsx` (remove redirect)

**Interfaces:**
- Produces: `shouldRedirectToRequestAccess(pathname: string, token: { organizations?: SessionOrganization[]; realmRoles?: string[] } | null): boolean`
- Consumes: existing `hasAnyAccess(organizations, realmRoles)`.

- [ ] **Step 1: Write the failing test**

Add to `src/test/lib/permissions.test.ts` (after the existing imports, append a new `describe`). Note `shouldRedirectToRequestAccess` must be added to the import on line 2/3.

```ts
import { shouldRedirectToRequestAccess } from '@/lib/permissions'

describe('shouldRedirectToRequestAccess', () => {
  const noAccess = { organizations: [], realmRoles: [] }
  const groupAccess = { organizations: [], realmRoles: ['group_admin'] }
  const opcoAccess = { organizations: [ghanaApprover], realmRoles: [] }

  it('does not redirect when there is no token (unauthenticated)', () => {
    expect(shouldRedirectToRequestAccess('/approvals', null)).toBe(false)
  })
  it('redirects an authenticated no-access user on a protected route', () => {
    expect(shouldRedirectToRequestAccess('/approvals', noAccess)).toBe(true)
    expect(shouldRedirectToRequestAccess('/calendar', noAccess)).toBe(true)
    expect(shouldRedirectToRequestAccess('/', noAccess)).toBe(true)
  })
  it('does not redirect a user with a group role', () => {
    expect(shouldRedirectToRequestAccess('/approvals', groupAccess)).toBe(false)
  })
  it('does not redirect a user with an OpCo assignment', () => {
    expect(shouldRedirectToRequestAccess('/approvals', opcoAccess)).toBe(false)
  })
  it('never redirects exempt routes even with no access', () => {
    for (const p of ['/login', '/request-access', '/api/auth', '/api/auth/callback/keycloak']) {
      expect(shouldRedirectToRequestAccess(p, noAccess)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: FAIL — `shouldRedirectToRequestAccess is not a function` / import error.

- [ ] **Step 3: Implement the helper**

In `src/lib/permissions.ts`, immediately after the `hasAnyAccess` function (ends ~line 56), add:

```ts
const ACCESS_GATE_EXEMPT = ["/login", "/request-access", "/api/auth"]

/**
 * Middleware gate decision: should this request be redirected to /request-access?
 * True only for an authenticated session that has no standing access and is on a
 * non-exempt route. Unauthenticated (null token) requests are left to the normal
 * login flow. Pure + edge-safe so it can run in middleware and be unit-tested.
 */
export function shouldRedirectToRequestAccess(
  pathname: string,
  token: { organizations?: SessionOrganization[]; realmRoles?: string[] } | null
): boolean {
  if (!token) return false
  if (ACCESS_GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/"))) return false
  return !hasAnyAccess(token.organizations ?? [], token.realmRoles ?? [])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the middleware**

Create `src/middleware.ts`:

```ts
import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import authConfig from "@/auth.config"
import { shouldRedirectToRequestAccess } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

// Edge-safe NextAuth instance: base (DB-free) config + an inline session callback
// that copies the access-relevant claims off the JWT. We deliberately do NOT import
// sessionFromToken (it pulls in the pg layer) — these three lines are edge-safe.
const { auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token }) {
      session.user.organizations = (token.organizations as SessionOrganization[] | undefined) ?? []
      session.user.realmRoles = (token.realmRoles as string[] | undefined) ?? []
      return session
    },
  },
})

export default auth((req) => {
  const token = req.auth
    ? { organizations: req.auth.user.organizations, realmRoles: req.auth.user.realmRoles }
    : null
  if (shouldRedirectToRequestAccess(req.nextUrl.pathname, token)) {
    return NextResponse.redirect(new URL("/request-access", req.nextUrl))
  }
  return NextResponse.next()
})

// Run on app routes; skip Next internals and static asset files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
```

- [ ] **Step 6: Remove the now-redundant page-level redirects**

In `src/app/page.tsx`, delete the two lines (the comment + the redirect, ~lines 26-27):

```ts
  // No standing access yet (e.g. fresh Google sign-in) → self-service request page.
  if (!hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/request-access")
```

Then remove `hasAnyAccess` from the import on line 4 (keep `viewerTier, requestScopedSlugs`). Leave the `tier === "member"` redirect untouched.

In `src/app/(dashboard)/requests/page.tsx`, delete its `hasAnyAccess(...) → redirect("/request-access")` line and drop `hasAnyAccess` from that file's import if it becomes unused. (Verify with `grep -n hasAnyAccess src/app/\(dashboard\)/requests/page.tsx` before/after.)

- [ ] **Step 7: Type-check the touched files and run the test**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: PASS.
Run: `pnpm tsc --noEmit 2>&1 | grep -E "middleware|permissions|page.tsx|requests" || echo "no new type errors in touched files"`
Expected: no new errors in the touched files. (A pre-existing `src/server/drive.ts` error is unrelated and expected — ignore it.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts src/middleware.ts src/app/page.tsx "src/app/(dashboard)/requests/page.tsx"
git commit -m "feat(access): gate whole app via middleware, redirect no-access users to request-access"
```

---

## Task 2: Access Requests nav badge (#4)

**Files:**
- Modify: `src/server/actions/notifications.ts` (`getNavCounts`, lines 46-60)
- Test: `src/test/actions/notifications.test.ts`
- Modify: `src/components/app-shell.tsx` (state default line 115; badge near line 298)

**Interfaces:**
- Consumes: `manageableOpCoSlugs(organizations, realmRoles): string[] | "all"` from `@/lib/permissions`.
- Produces: `getNavCounts()` return now `{ pendingApprovals, myRequests, unreadNotifications, pendingAccessRequests }` (all `number`).

- [ ] **Step 1: Update the failing test**

In `src/test/actions/notifications.test.ts`: add `accessRequest` to `mockDb` and update the two `getNavCounts` assertions to expect the new key.

Add to the `mockDb` object literal (alongside `changeRequest`):

```ts
  accessRequest: { count: vi.fn().mockResolvedValue(0) },
```

Update the first assertion (`returns pendingApprovals, myRequests and unreadNotifications`) to:

```ts
    mockDb.changeRequest.count.mockResolvedValue(5)
    mockDb.notification.count.mockResolvedValue(2)
    mockDb.accessRequest.count.mockResolvedValue(4)
    const counts = await getNavCounts()
    expect(counts).toEqual({ pendingApprovals: 2, myRequests: 5, unreadNotifications: 2, pendingAccessRequests: 4 })
```

In the second test (`counts only requests needing the requester action`) add `pendingAccessRequests: expect.any(Number)` to its `toEqual`, OR if it only asserts `myRequests`, leave it. (Inspect and make its `toEqual` include the new key if it uses a full-object match.)

Add a new test asserting the scope passed to the count for this session (OpCo approver, no admin role → `manageableOpCoSlugs` returns `[]`):

```ts
  it('scopes pendingAccessRequests to manageable OpCos', async () => {
    await getNavCounts()
    expect(mockDb.accessRequest.count).toHaveBeenCalledWith({
      where: { status: 'pending', opco: { slug: { in: [] } } },
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/actions/notifications.test.ts`
Expected: FAIL — returned object missing `pendingAccessRequests` / `accessRequest.count` not called.

- [ ] **Step 3: Implement `getNavCounts`**

In `src/server/actions/notifications.ts`, add the import (extend the existing `@/lib/...` imports near the top):

```ts
import { manageableOpCoSlugs } from "@/lib/permissions"
```

Replace the body of `getNavCounts` (lines 46-60) with:

```ts
export async function getNavCounts() {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) return { pendingApprovals: 0, myRequests: 0, unreadNotifications: 0, pendingAccessRequests: 0 }
  const scope = manageableOpCoSlugs(session.organizations, session.realmRoles)
  const [approvable, myRequests, unreadNotifications, pendingAccessRequests] = await Promise.all([
    listApprovableChanges({ userId: u.id, realmRoles: session.realmRoles }),
    // Only requests that need the requester's action: drafts to finish/submit and
    // rejected ones to rework.
    db.changeRequest.count({ where: { requesterId: u.id, status: { in: ["draft", "rejected"] } } }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
    // Pending access requests the caller can act on — scoped exactly like listAccessRequests.
    db.accessRequest.count({
      where: { status: "pending", ...(scope === "all" ? {} : { opco: { slug: { in: scope } } }) },
    }),
  ])
  return { pendingApprovals: approvable.length, myRequests, unreadNotifications, pendingAccessRequests }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/actions/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the badge to the sidebar**

In `src/components/app-shell.tsx` line 115, extend the state default:

```tsx
  const [navCounts, setNavCounts] = useState({ pendingApprovals: 0, myRequests: 0, unreadNotifications: 0, pendingAccessRequests: 0 })
```

After the `/approvals` badge block (the one rendering `navCounts.pendingApprovals`, ends ~line 300, before the closing `</>`), add:

```tsx
                            {item.href === "/access-requests" && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs",
                                  active ? "bg-white/20" : "bg-muted"
                                )}
                              >
                                {navCounts.pendingAccessRequests}
                              </span>
                            )}
```

- [ ] **Step 6: Verify render smoke test + type-check**

Run: `pnpm test src/app/dashboard-client.test.tsx 2>/dev/null; pnpm test src/test/actions/notifications.test.ts`
Expected: PASS.
Run: `pnpm tsc --noEmit 2>&1 | grep -E "app-shell|notifications.ts" || echo "no new type errors"`
Expected: no new errors in touched files.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/notifications.ts src/test/actions/notifications.test.ts src/components/app-shell.tsx
git commit -m "feat(access): pending access-request count badge on Access Requests nav item"
```

---

## Task 3: `isGroupAdmin` marker on User, synced at sign-in (#5a)

**Files:**
- Modify: `prisma/schema.prisma` (`model User`)
- Create: `prisma/migrations/20260626120000_user_is_group_admin/migration.sql`
- Modify: `src/lib/auth-callbacks.ts` (`enrichedJwt`)
- Test: `src/test/auth-enrichment.test.ts`

**Interfaces:**
- Produces: `User.isGroupAdmin: boolean` (default false); `enrichedJwt` calls `db.user.updateMany({ where: { keycloakId }, data: { isGroupAdmin } })` on sign-in.

- [ ] **Step 1: Add the schema column**

In `prisma/schema.prisma`, in `model User`, add after the `isActive` line:

```prisma
  isActive     Boolean  @default(true)
  isGroupAdmin Boolean  @default(false)
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260626120000_user_is_group_admin/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "isGroupAdmin" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm prisma generate`
Expected: client regenerates, `User.isGroupAdmin` becomes a known field (no DB connection needed for generate).

- [ ] **Step 4: Write the failing test**

In `src/test/auth-enrichment.test.ts`: add an `updateMany` mock to the `user` object and a reset for it, then add assertions.

Add the fn near the other mocks (top of file):

```ts
const userUpdateMany = vi.fn()
```

Add it to the mocked client:

```ts
vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    user: { findUnique: userFindUnique, create: userCreate, update: userUpdate, updateMany: userUpdateMany },
    userOpCoAssignment: { findMany },
  }),
}))
```

Add `userUpdateMany.mockReset()` to the `beforeEach`.

Add two tests:

```ts
  it('marks isGroupAdmin true when the token carries the group_admin client role', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'ga@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-1' }, data: { isGroupAdmin: true } })
  })

  it('clears isGroupAdmin (false) when the token has no group_admin role', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-2' } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-2', email: 'member@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: [] } } },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-2' }, data: { isGroupAdmin: false } })
  })
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: FAIL — `userUpdateMany` not called (and possibly "updateMany is not a function" in existing tests until the mock is wired; the mock wiring in Step 4 prevents that).

- [ ] **Step 6: Implement the sync in `enrichedJwt`**

In `src/lib/auth-callbacks.ts`, inside `if (account)`, after the `token.organizations = assignments.map(...)` block and before `return token` (i.e. just before the closing of the `if (account)` block, ~line 65), add:

```ts
    // Mirror the group_admin client role onto the DB row so group-level admins
    // (whose role lives only in Keycloak) are enumerable for notifications.
    // Writes both true and false so a demotion clears the marker. updateMany is a
    // no-op when no row matches (e.g. an unverified email that wasn't created/relinked).
    const realmRoles = (token.realmRoles as string[] | undefined) ?? []
    await db.user.updateMany({
      where: { keycloakId: sub },
      data: { isGroupAdmin: realmRoles.includes("group_admin") },
    })
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: PASS (new + existing tests green).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260626120000_user_is_group_admin src/lib/auth-callbacks.ts src/test/auth-enrichment.test.ts
git commit -m "feat(access): persist isGroupAdmin marker synced from token at sign-in"
```

---

## Task 4: Notify OpCo + group admins of new access requests, in-app + email (#5b)

**Files:**
- Modify: `src/server/email.ts` (add `sendAccessRequestEmail`)
- Modify: `src/server/actions/access-requests.ts` (`requestAccess` recipients + dual channel)
- Test: `src/test/actions/access-requests.test.ts`

**Interfaces:**
- Consumes: `User.isGroupAdmin` (Task 3); `db.user.findMany`; existing `notifyUsers`, `coerceLocale`, `t`.
- Produces: `sendAccessRequestEmail(opts: { to: string; adminName: string; requesterName: string; opcoName: string; locale?: Language }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

In `src/test/actions/access-requests.test.ts`:

Add the email mock near the other `vi.mock` calls:

```ts
vi.mock("@/server/email", () => ({ sendAccessRequestEmail: vi.fn().mockResolvedValue(undefined) }))
```

Add `findMany` to the `user` mock and import the email mock:

```ts
  user: { findUnique: vi.fn(), findMany: vi.fn() },
```

```ts
import { sendAccessRequestEmail } from "@/server/email"
```

In `beforeEach`, default the new group-admin query to empty:

```ts
  mockDb.user.findMany.mockResolvedValue([])
```

Update the existing `creates a pending requester request and notifies OpCo admins` test: change the OpCo-admin mock to the new selected shape and assert the email is sent:

```ts
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
    ])
    const res = await requestAccess({ opcoSlug: "ghana", note: "Need access" })
    expect(res).toEqual({ id: "ar-1" })
    expect(notifyUsers).toHaveBeenCalledWith(
      [{ userId: "admin-1" }],
      expect.objectContaining({ type: "access.requested" })
    )
    expect(sendAccessRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin1@csquared.com", opcoName: "CSquared Ghana", requesterName: "Bob" })
    )
```

Add a new test for group admins + dedup + requester exclusion:

```ts
  it("notifies group admins and the target OpCo's admins, deduped and excluding the requester", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
    ])
    mockDb.user.findMany.mockResolvedValue([
      { id: "admin-1", email: "admin1@csquared.com", name: "Admin One", locale: "en" }, // also a group admin → dedup
      { id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" },
      { id: "bob-db", email: "bob@csquared.com", name: "Bob", locale: "en" }, // the requester → excluded
    ])
    await requestAccess({ opcoSlug: "ghana" })
    const notified = vi.mocked(notifyUsers).mock.calls[0][0]
    expect(notified).toEqual(expect.arrayContaining([{ userId: "admin-1" }, { userId: "ga-2" }]))
    expect(notified).toHaveLength(2) // deduped admin-1, excluded bob-db
    expect(sendAccessRequestEmail).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: FAIL — `sendAccessRequestEmail` not exported / not called; group-admin query not made.

- [ ] **Step 3: Add the email template**

In `src/server/email.ts`, after `sendUserInvitationEmail` (or alongside the other senders), add:

```ts
export async function sendAccessRequestEmail(opts: {
  to: string; adminName: string; requesterName: string; opcoName: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  await dispatchEmail(
    opts.to,
    fr ? `Nouvelle demande d'accès : ${opts.opcoName}` : `New access request: ${opts.opcoName}`,
    fr
      ? `<p>Bonjour ${opts.adminName},</p>
<p><strong>${opts.requesterName}</strong> a demandé l'accès à <strong>${opts.opcoName}</strong>.</p>
<p><a href="${BASE}/access-requests">Examiner la demande</a></p>`
      : `<p>Hi ${opts.adminName},</p>
<p><strong>${opts.requesterName}</strong> requested access to <strong>${opts.opcoName}</strong>.</p>
<p><a href="${BASE}/access-requests">Review the request</a></p>`
  )
}
```

- [ ] **Step 4: Rewrite the recipient block in `requestAccess`**

In `src/server/actions/access-requests.ts`, add the import:

```ts
import { sendAccessRequestEmail } from "@/server/email"
```

Replace the existing recipient block (lines 51-61, from `const admins = ...` through the `await notifyUsers(...)` call) with:

```ts
  // Recipients: active admins of the target OpCo PLUS all active group-level admins
  // (group_admin lives only in Keycloak, mirrored to User.isGroupAdmin at sign-in).
  // Dedup by user id; never notify the requester themselves.
  const [opAdmins, groupAdmins] = await Promise.all([
    db.userOpCoAssignment.findMany({
      where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
      select: { userId: true, user: { select: { email: true, name: true, locale: true } } },
    }),
    db.user.findMany({
      where: { isGroupAdmin: true, isActive: true },
      select: { id: true, email: true, name: true, locale: true },
    }),
  ])

  const byId = new Map<string, { userId: string; email: string; name: string | null; locale: string | null }>()
  for (const a of opAdmins) byId.set(a.userId, { userId: a.userId, email: a.user.email, name: a.user.name, locale: a.user.locale })
  for (const g of groupAdmins) byId.set(g.id, { userId: g.id, email: g.email, name: g.name, locale: g.locale })
  byId.delete(me.id)
  const recipients = [...byId.values()]

  const requesterName = session.name ?? session.email
  const opcoLocale = coerceLocale(opco.locale)
  await Promise.allSettled([
    notifyUsers(
      recipients.map((r) => ({ userId: r.userId })),
      { type: "access.requested", title: t(opcoLocale, "notif.access.requested.title"), body: `${requesterName} → ${opco.name}` }
    ),
    ...recipients.map((r) =>
      sendAccessRequestEmail({
        to: r.email,
        adminName: r.name ?? r.email,
        requesterName,
        opcoName: opco.name,
        locale: coerceLocale(r.locale),
      })
    ),
  ])
```

Note: the old `const locale = coerceLocale(opco.locale)` line is replaced by `opcoLocale` above — ensure no duplicate `locale` declaration remains in `requestAccess`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: PASS.

- [ ] **Step 6: Full test sweep + type-check**

Run: `pnpm test`
Expected: all suites green.
Run: `pnpm tsc --noEmit 2>&1 | grep -vE "server/drive.ts" | grep -E "error TS" || echo "no new type errors"`
Expected: only the pre-existing `src/server/drive.ts` errors (ignored); nothing in the files this plan touched.

- [ ] **Step 7: Commit**

```bash
git add src/server/email.ts src/server/actions/access-requests.ts src/test/actions/access-requests.test.ts
git commit -m "feat(access): notify OpCo + group admins of new access requests via in-app and email"
```

---

## Final Verification

- [ ] Run the full suite once more: `pnpm test` — all green.
- [ ] Confirm the four commits are present: `git log --oneline dev..HEAD` shows the access-gate, badge, marker, and notification commits.
- [ ] Playwright smoke (during finishing): sign in as a no-access user → bounced to `/request-access` from any deep link (e.g. `/calendar`); sign in as admin → Access Requests nav shows a non-zero badge after a request is placed, and an in-app notification + email (mock/log) fires.
