# Self-Registration Access-Request Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google-self-registered users discoverable and give them a vetted, auditable self-service path to request `requester` access in an OpCo.

**Architecture:** Relax the `email_verified` gate so every sign-in creates a `User` row (no assignments = "authenticated, no access"). Add an `AccessRequest` entity with a full approve/deny workflow, a `/request-access` landing page for no-access users, and an `/access-requests` admin queue. Notifications reuse the `Notification` table directly via a new change-free `notifyUsers` helper.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma 7 / Postgres, NextAuth v5 (Keycloak), Vitest + React Testing Library, flat-map i18n (`src/lib/i18n.ts`).

## Global Constraints

- Use `pnpm` for all commands (never npm). Lockfile is `pnpm-lock.yaml`.
- Only `requester` is self-requestable. `approver`/`auditor`/`admin`/group roles stay on the admin onboarding path.
- Authentication ≠ authorization: a sign-in must never grant standing access.
- All user-visible strings go through `t(language, key)` with both `en` and `fr` entries in `src/lib/i18n.ts`.
- No `Co-Authored-By` trailers in commit messages.
- Stage with explicit `git add <files>` (never `-A` / `.`).
- `notifyEvent` (change-bound) must remain untouched; new notifications go through the new `notifyUsers` helper.
- Path alias `@/*` → `src/*`.
- Run on the current `dev` branch's worktree; do not start on `prod`.

---

### Task 1: Relax the `email_verified` gate

Brokered Google identities don't reliably carry `email_verified`, so no DB row is created on sign-in and the user is invisible. Relax the gate to require only a present email; the Keycloak `@csquared.com` realm restriction is the trust boundary.

**Files:**
- Modify: `src/lib/auth-callbacks.ts:38`
- Test: `src/test/auth-enrichment.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: behavior change only — every sign-in with `profile.email` upserts a `User` row (with zero assignments).

- [ ] **Step 1: Invert the existing gate test and add an unverified-but-present-email case**

In `src/test/auth-enrichment.test.ts`, **replace** the existing test block:

```ts
  it('does NOT link/create when the email is not verified', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'devops@csquared.com', email_verified: false },
    })

    expect(userUpsert).not.toHaveBeenCalled()
  })
```

with:

```ts
  it('links/creates a row even when email_verified is false (brokered Google)', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'eessel@csquared.com', email_verified: false, name: 'E Essel' },
    })

    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'eessel@csquared.com' },
      update: { keycloakId: 'real-sub-123' },
      create: { keycloakId: 'real-sub-123', email: 'eessel@csquared.com', name: 'E Essel', locale: 'en' },
    })
  })

  it('does NOT link/create when no email is present', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'no-email-sub' },
    })

    expect(userUpsert).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: FAIL — the "even when email_verified is false" test fails because the current gate still requires `email_verified`.

- [ ] **Step 3: Relax the gate**

In `src/lib/auth-callbacks.ts`, change the condition (currently line 38) from:

```ts
      if (p.email && p.email_verified) {
```

to:

```ts
      // Trust boundary is Keycloak's @csquared.com realm restriction, not the OIDC
      // email_verified claim (Google brokering doesn't reliably propagate it). Require
      // only a present email so brokered sign-ins always produce a discoverable row.
      if (p.email) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: PASS (all cases, including the existing verified-email link/create tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-callbacks.ts src/test/auth-enrichment.test.ts
git commit -m "fix(auth): create user row on sign-in regardless of email_verified"
```

---

### Task 2: Add the `AccessRequest` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (new model + enum + back-relations on `User` and `OpCo`)
- Migration: `prisma/migrations/<timestamp>_access_request/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma model `AccessRequest` with fields `id, userId, opcoId, role (Role), note (String?), status (AccessRequestStatus), decidedById (String?), decidedAt (DateTime?), decisionReason (String?), createdAt`; enum `AccessRequestStatus { pending, approved, denied }`. Relations: `user` (`AccessRequestRequester`), `opco`, `decidedBy` (`AccessRequestDecider`).

- [ ] **Step 1: Add the enum and model to `prisma/schema.prisma`**

Append at the end of `prisma/schema.prisma`:

```prisma
enum AccessRequestStatus {
  pending
  approved
  denied
}

model AccessRequest {
  id             String              @id @default(cuid())
  userId         String
  opcoId         String
  role           Role
  note           String?
  status         AccessRequestStatus @default(pending)
  decidedById    String?
  decidedAt      DateTime?
  decisionReason String?
  createdAt      DateTime            @default(now())

  user      User  @relation("AccessRequestRequester", fields: [userId], references: [id])
  opco      OpCo  @relation(fields: [opcoId], references: [id])
  decidedBy User? @relation("AccessRequestDecider", fields: [decidedById], references: [id])

  @@index([opcoId, status])
  @@index([userId, status])
}
```

- [ ] **Step 2: Add back-relations on `User` and `OpCo`**

In `model User` (after the `changeAssignments` relation line ~82), add:

```prisma
  accessRequests        AccessRequest[]            @relation("AccessRequestRequester")
  accessRequestsDecided AccessRequest[]            @relation("AccessRequestDecider")
```

In `model OpCo` (after the `approverAssignments` line ~101), add:

```prisma
  accessRequests AccessRequest[]
```

- [ ] **Step 3: Validate the schema**

Run: `pnpm prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Generate the migration and client**

Run (local Postgres must be up — see `docs` runbook; pass the dev `DATABASE_URL` inline):
`DATABASE_URL=<local-dev-url> pnpm prisma migrate dev --name access_request`
Expected: a new folder `prisma/migrations/<timestamp>_access_request/` with `migration.sql` creating `AccessRequest` + the enum, and "Your database is now in sync with your schema."

If no local DB is available, run `pnpm prisma generate` to refresh the client types and create the migration SQL manually via `pnpm prisma migrate diff` — but prefer the real `migrate dev`.

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (the generated client now exposes `db.accessRequest`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add AccessRequest model + migration"
```

---

### Task 3: Add the `notifyUsers` change-free notification helper

`notifyEvent` is change-bound (requires a `change` and stamps `changeId`). Access-workflow events have no change, so add a minimal helper that writes `Notification` rows directly with `changeId: null`.

**Files:**
- Modify: `src/server/notify.ts`
- Test: `src/test/server/notify-users.test.ts` (create)

**Interfaces:**
- Produces: `export async function notifyUsers(recipients: { userId: string }[], msg: { type: string; title: string; body: string }): Promise<void>` — creates one `Notification` row per recipient (`changeId: null`); no-op on empty recipients.

- [ ] **Step 1: Write the failing test**

Create `src/test/server/notify-users.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const notificationCreate = vi.fn().mockResolvedValue({})
vi.mock("@/server/db", () => ({
  getPrisma: () => ({ notification: { create: notificationCreate } }),
}))

import { notifyUsers } from "@/server/notify"

beforeEach(() => notificationCreate.mockClear())

describe("notifyUsers", () => {
  it("creates one notification per recipient with changeId null", async () => {
    await notifyUsers([{ userId: "u1" }, { userId: "u2" }], {
      type: "access.requested",
      title: "New access request",
      body: "Alice → Ghana",
    })
    expect(notificationCreate).toHaveBeenCalledTimes(2)
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "u1", type: "access.requested", title: "New access request", body: "Alice → Ghana", changeId: null },
    })
  })

  it("is a no-op when there are no recipients", async () => {
    await notifyUsers([], { type: "access.approved", title: "x", body: "y" })
    expect(notificationCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server/notify-users.test.ts`
Expected: FAIL with "notifyUsers is not a function" (or import error).

- [ ] **Step 3: Implement `notifyUsers`**

In `src/server/notify.ts`, add after the `notifyEvent` function:

```ts
/**
 * Change-free notifications (e.g. access-request workflow). Writes Notification rows
 * directly with changeId: null so they surface in the bell feed. Unlike notifyEvent,
 * this bypasses the change-oriented preference matrix — these events are always in-app.
 */
export async function notifyUsers(
  recipients: { userId: string }[],
  msg: { type: string; title: string; body: string }
): Promise<void> {
  if (recipients.length === 0) return
  const db = getPrisma()
  await Promise.allSettled(
    recipients.map((r) =>
      db.notification.create({
        data: { userId: r.userId, type: msg.type, title: msg.title, body: msg.body, changeId: null },
      })
    )
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/server/notify-users.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/notify.ts src/test/server/notify-users.test.ts
git commit -m "feat(notify): add change-free notifyUsers helper"
```

---

### Task 4: Add the `hasAnyAccess` permission helper

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

**Interfaces:**
- Consumes: `isGroupLevel(realmRoles)` (already in `permissions.ts`).
- Produces: `export function hasAnyAccess(organizations: SessionOrganization[], realmRoles: string[]): boolean` — true if the user holds any group-level role or any OpCo assignment.

- [ ] **Step 1: Write the failing test**

Add to `src/test/lib/permissions.test.ts` (inside the top-level describe, or a new `describe("hasAnyAccess")`):

```ts
import { hasAnyAccess } from "@/lib/permissions"

describe("hasAnyAccess", () => {
  it("is false for a user with no roles and no assignments", () => {
    expect(hasAnyAccess([], [])).toBe(false)
  })
  it("is true for a group-level user with no OpCo assignments", () => {
    expect(hasAnyAccess([], ["group_auditor"])).toBe(true)
  })
  it("is true for a user with at least one OpCo assignment", () => {
    expect(hasAnyAccess([{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }], [])).toBe(true)
  })
})
```

(If `permissions.test.ts` already imports from `@/lib/permissions`, add `hasAnyAccess` to that import instead of duplicating the line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: FAIL with "hasAnyAccess is not a function".

- [ ] **Step 3: Implement the helper**

In `src/lib/permissions.ts`, add after `isGroupLevel`:

```ts
/** True if the user has any standing access — a group-level role or ≥1 OpCo assignment. */
export function hasAnyAccess(
  organizations: SessionOrganization[],
  realmRoles: string[]
): boolean {
  return isGroupLevel(realmRoles) || organizations.length > 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(permissions): add hasAnyAccess helper"
```

---

### Task 5: `requestAccess` + `listAccessRequests` server actions

**Files:**
- Create: `src/server/actions/access-requests.ts`
- Modify: `src/lib/i18n.ts` (notification title keys)
- Test: `src/test/actions/access-requests.test.ts` (create)

**Interfaces:**
- Consumes: `getAppSession()`; `canAssignRole`, `manageableOpCoSlugs` (`@/lib/permissions`); `recordAdminAction` (`@/server/audit`); `notifyUsers` (`@/server/notify`); `coerceLocale`, `t` (`@/lib/i18n`).
- Produces:
  - `requestAccess(input: { opcoSlug: string; note?: string }): Promise<{ id: string }>` — creates a pending `AccessRequest(role: requester)`, notifies OpCo admins.
  - `listAccessRequests(): Promise<Array<{ id: string; note: string | null; createdAt: string; opcoName: string; opcoSlug: string; requesterName: string; requesterEmail: string }>>` — pending requests scoped to the caller's manageable OpCos.

- [ ] **Step 1: Add the notification title i18n keys**

In `src/lib/i18n.ts`, add to the `en` map:

```ts
  "notif.access.requested.title": "New access request",
  "notif.access.approved.title": "Access request approved",
  "notif.access.denied.title": "Access request denied",
```

and to the `fr` map:

```ts
  "notif.access.requested.title": "Nouvelle demande d'accès",
  "notif.access.approved.title": "Demande d'accès approuvée",
  "notif.access.denied.title": "Demande d'accès refusée",
```

- [ ] **Step 2: Write the failing test**

Create `src/test/actions/access-requests.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ getAppSession: vi.fn() }))
vi.mock("@/server/audit", () => ({ recordAdminAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/keycloak", () => ({ assignToOrganization: vi.fn().mockResolvedValue(undefined) }))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  user: { findUnique: vi.fn() },
  opCo: { findUnique: vi.fn() },
  userOpCoAssignment: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  accessRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { requestAccess, listAccessRequests } from "@/server/actions/access-requests"
import { getAppSession } from "@/lib/session"
import { notifyUsers } from "@/server/notify"

const member = { keycloakId: "kc-bob", email: "bob@csquared.com", name: "Bob", organizations: [], realmRoles: [] }
const groupAdmin = { keycloakId: "kc-ga", email: "ga@csquared.com", name: "GA", organizations: [], realmRoles: ["group_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  vi.mocked(getAppSession).mockResolvedValue(member)
  mockDb.user.findUnique.mockResolvedValue({ id: "bob-db" })
  mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en" })
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.accessRequest.findFirst.mockResolvedValue(null)
  mockDb.accessRequest.create.mockResolvedValue({ id: "ar-1" })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
})

describe("requestAccess", () => {
  it("creates a pending requester request and notifies OpCo admins", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { isActive: true } },
    ])
    const res = await requestAccess({ opcoSlug: "ghana", note: "Need access" })
    expect(res).toEqual({ id: "ar-1" })
    expect(mockDb.accessRequest.create).toHaveBeenCalledWith({
      data: { userId: "bob-db", opcoId: "opco-ghana", role: "requester", note: "Need access" },
    })
    expect(notifyUsers).toHaveBeenCalledWith(
      [{ userId: "admin-1" }],
      expect.objectContaining({ type: "access.requested" })
    )
  })

  it("rejects when the user is already an active requester there", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(requestAccess({ opcoSlug: "ghana" })).rejects.toThrow(/already have requester access/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a duplicate pending request", async () => {
    mockDb.accessRequest.findFirst.mockResolvedValue({ id: "ar-existing" })
    await expect(requestAccess({ opcoSlug: "ghana" })).rejects.toThrow(/pending request/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("rejects an unknown OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    await expect(requestAccess({ opcoSlug: "atlantis" })).rejects.toThrow(/OpCo not found/i)
  })
})

describe("listAccessRequests", () => {
  it("returns all pending requests for a group admin", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-1", note: null, createdAt: new Date("2026-06-24T00:00:00Z"), opco: { name: "Ghana", slug: "ghana" }, user: { name: "Bob", email: "bob@csquared.com" } },
    ])
    const rows = await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } })
    )
    expect(rows[0]).toMatchObject({ id: "ar-1", opcoName: "Ghana", requesterName: "Bob" })
  })

  it("scopes an OpCo admin to their managed OpCos", async () => {
    vi.mocked(getAppSession).mockResolvedValue({
      keycloakId: "kc-gha", email: "a@x.co", name: "A",
      organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }], realmRoles: [],
    })
    mockDb.accessRequest.findMany.mockResolvedValue([])
    await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending", opco: { slug: { in: ["ghana"] } } } })
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: FAIL (module `@/server/actions/access-requests` does not exist).

- [ ] **Step 4: Implement `requestAccess` + `listAccessRequests`**

Create `src/server/actions/access-requests.ts`:

```ts
// src/server/actions/access-requests.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canAssignRole, manageableOpCoSlugs } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { notifyUsers } from "@/server/notify"
import { assignToOrganization } from "@/server/keycloak"
import { coerceLocale, t } from "@/lib/i18n"

export async function requestAccess(input: { opcoSlug: string; note?: string }) {
  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const opco = await db.opCo.findUnique({
    where: { slug: input.opcoSlug },
    select: { id: true, name: true, locale: true },
  })
  if (!opco) throw new Error("OpCo not found")

  const alreadyRequester = await db.userOpCoAssignment.findFirst({
    where: { userId: me.id, opcoId: opco.id, role: "requester", isActive: true },
    select: { id: true },
  })
  if (alreadyRequester) throw new Error("You already have requester access to this OpCo")

  const pending = await db.accessRequest.findFirst({
    where: { userId: me.id, opcoId: opco.id, status: "pending" },
    select: { id: true },
  })
  if (pending) throw new Error("You already have a pending request for this OpCo")

  const created = await db.accessRequest.create({
    data: { userId: me.id, opcoId: opco.id, role: "requester", note: input.note ?? null },
  })

  await recordAdminAction(db, {
    actorKeycloakId: session.keycloakId,
    actorEmail: session.email,
    actorName: session.name,
    action: "access.request",
    summary: `Requested requester access to ${opco.name}`,
    opcoId: opco.id,
    metadata: { accessRequestId: created.id, opcoSlug: input.opcoSlug },
  })

  const admins = await db.userOpCoAssignment.findMany({
    where: { opcoId: opco.id, role: "admin", isActive: true },
    select: { userId: true, user: { select: { isActive: true } } },
  })
  const recipients = admins.filter((a) => a.user.isActive).map((a) => ({ userId: a.userId }))
  const locale = coerceLocale(opco.locale)
  await notifyUsers(recipients, {
    type: "access.requested",
    title: t(locale, "notif.access.requested.title"),
    body: `${session.name ?? session.email} → ${opco.name}`,
  })

  return { id: created.id }
}

export async function listAccessRequests() {
  const session = await getAppSession()
  const db = getPrisma()

  const scope = manageableOpCoSlugs(session.organizations, session.realmRoles)
  const rows = await db.accessRequest.findMany({
    where: {
      status: "pending",
      ...(scope === "all" ? {} : { opco: { slug: { in: scope } } }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      note: true,
      createdAt: true,
      opco: { select: { name: true, slug: true } },
      user: { select: { name: true, email: true } },
    },
  })

  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    opcoName: r.opco.name,
    opcoSlug: r.opco.slug,
    requesterName: r.user.name ?? r.user.email,
    requesterEmail: r.user.email,
  }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: PASS (the `requestAccess` + `listAccessRequests` describes).

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/access-requests.ts src/test/actions/access-requests.test.ts src/lib/i18n.ts
git commit -m "feat(access): requestAccess + listAccessRequests actions"
```

---

### Task 6: `approveAccessRequest` + `denyAccessRequest` server actions

**Files:**
- Modify: `src/server/actions/access-requests.ts`
- Test: `src/test/actions/access-requests.test.ts` (add describes)

**Interfaces:**
- Consumes: same imports as Task 5.
- Produces:
  - `approveAccessRequest(id: string): Promise<{ ok: true }>` — authz `canAssignRole(requester, opco)`; upserts the `requester` assignment, flips status to `approved`, audits, best-effort Keycloak org assignment, notifies the requester.
  - `denyAccessRequest(id: string, reason?: string): Promise<{ ok: true }>` — same authz; flips status to `denied` with reason, audits, notifies the requester.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/actions/access-requests.test.ts`:

```ts
import { approveAccessRequest, denyAccessRequest } from "@/server/actions/access-requests"
import { assignToOrganization } from "@/server/keycloak"

const pendingReq = {
  id: "ar-1",
  status: "pending",
  userId: "bob-db",
  role: "requester",
  opco: { id: "opco-ghana", slug: "ghana", name: "CSquared Ghana" },
  user: { keycloakId: "kc-bob", locale: "en" },
}

describe("approveAccessRequest", () => {
  it("grants the requester assignment, flips status, and notifies the requester", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })

    const res = await approveAccessRequest("ar-1")
    expect(res).toEqual({ ok: true })
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_opcoId: { userId: "bob-db", opcoId: "opco-ghana" } },
      update: { role: "requester", isActive: true, endedAt: null },
      create: { userId: "bob-db", opcoId: "opco-ghana", role: "requester" },
    })
    expect(mockDb.accessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ar-1" }, data: expect.objectContaining({ status: "approved", decidedById: "ga-db" }) })
    )
    expect(assignToOrganization).toHaveBeenCalledWith("kc-bob", "ghana")
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "bob-db" }], expect.objectContaining({ type: "access.approved" }))
  })

  it("rejects when the caller cannot assign requester in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValue(member) // no roles
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/Forbidden/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-pending request", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue({ ...pendingReq, status: "approved" })
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/already decided/i)
  })
})

describe("denyAccessRequest", () => {
  it("flips status to denied with the reason and notifies the requester", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })

    const res = await denyAccessRequest("ar-1", "Not needed")
    expect(res).toEqual({ ok: true })
    expect(mockDb.accessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied", decisionReason: "Not needed", decidedById: "ga-db" }) })
    )
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "bob-db" }], expect.objectContaining({ type: "access.denied" }))
  })

  it("rejects when the caller cannot assign requester in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValue(member)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    await expect(denyAccessRequest("ar-1")).rejects.toThrow(/Forbidden/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: FAIL (`approveAccessRequest`/`denyAccessRequest` not exported).

- [ ] **Step 3: Implement the two actions + a shared loader**

Append to `src/server/actions/access-requests.ts`:

```ts
// Loads a pending request and asserts the caller can assign its role in its OpCo.
// Returns the request and the actor's DB user id (nullable — used for decidedById).
async function loadDecidableRequest(id: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const req = await db.accessRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      role: true,
      opco: { select: { id: true, slug: true, name: true } },
      user: { select: { keycloakId: true, locale: true } },
    },
  })
  if (!req) throw new Error("Access request not found")
  if (req.status !== "pending") throw new Error("Access request already decided")
  if (!canAssignRole(session.organizations, session.realmRoles, req.opco.slug, req.role)) {
    throw new Error(`Forbidden: cannot grant ${req.role} in ${req.opco.slug}`)
  }

  const actor = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  return { session, db, req, actorId: actor?.id ?? null }
}

export async function approveAccessRequest(id: string) {
  const { session, db, req, actorId } = await loadDecidableRequest(id)

  await db.$transaction(async (tx) => {
    await tx.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: req.userId, opcoId: req.opco.id } },
      update: { role: req.role, isActive: true, endedAt: null },
      create: { userId: req.userId, opcoId: req.opco.id, role: req.role },
    })
    await tx.accessRequest.update({
      where: { id: req.id },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.approve",
      summary: `Approved ${req.role} access to ${req.opco.name}`,
      opcoId: req.opco.id,
      targetUserId: req.userId,
      metadata: { accessRequestId: req.id },
    })
  })

  try {
    await assignToOrganization(req.user.keycloakId, req.opco.slug)
  } catch (err) {
    console.warn(`[keycloak] org assignment skipped for ${req.opco.slug}:`, err)
  }

  const locale = coerceLocale(req.user.locale)
  await notifyUsers([{ userId: req.userId }], {
    type: "access.approved",
    title: t(locale, "notif.access.approved.title"),
    body: req.opco.name,
  })

  return { ok: true as const }
}

export async function denyAccessRequest(id: string, reason?: string) {
  const { session, db, req, actorId } = await loadDecidableRequest(id)

  await db.$transaction(async (tx) => {
    await tx.accessRequest.update({
      where: { id: req.id },
      data: { status: "denied", decidedById: actorId, decidedAt: new Date(), decisionReason: reason ?? null },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.deny",
      summary: `Denied ${req.role} access to ${req.opco.name}`,
      opcoId: req.opco.id,
      targetUserId: req.userId,
      metadata: { accessRequestId: req.id, reason: reason ?? null },
    })
  })

  const locale = coerceLocale(req.user.locale)
  await notifyUsers([{ userId: req.userId }], {
    type: "access.denied",
    title: t(locale, "notif.access.denied.title"),
    body: req.opco.name,
  })

  return { ok: true as const }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/actions/access-requests.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/access-requests.ts src/test/actions/access-requests.test.ts
git commit -m "feat(access): approve + deny access-request actions"
```

---

### Task 7: `/request-access` landing page + no-access redirects

**Files:**
- Create: `src/app/(dashboard)/request-access/page.tsx` (server)
- Create: `src/app/(dashboard)/request-access/request-access-client.tsx` (client)
- Modify: `src/app/page.tsx` (redirect no-access users)
- Modify: `src/app/(dashboard)/requests/page.tsx` (redirect no-access users)
- Modify: `src/lib/i18n.ts` (page keys)
- Test: `src/test/app/request-access-client.test.tsx` (create)

**Interfaces:**
- Consumes: `requestAccess` (Task 5); `hasAnyAccess` (Task 4).
- Produces: a no-access user is redirected to `/request-access`; the page renders a single-OpCo request form + the user's request history.

**Scope note:** No-access users reach the app only via `/` (which already routes `member` → `/requests`). Guarding `/` and `/requests` covers the real journey; all other nav links are gated and never shown to a no-access user. We deliberately do not add a guard to every dashboard page (YAGNI).

- [ ] **Step 1: Add page i18n keys**

In `src/lib/i18n.ts`, add to `en`:

```ts
  "access.request.title": "Request access",
  "access.request.intro": "You're signed in but don't have access to any OpCo yet. Request requester access below.",
  "access.request.opco": "OpCo",
  "access.request.note": "Note (optional)",
  "access.request.submit": "Submit request",
  "access.request.submitting": "Submitting…",
  "access.request.empty": "No OpCos are available to request right now.",
  "access.request.myRequests": "Your requests",
  "access.request.none": "You haven't made any requests yet.",
  "access.request.status.pending": "Pending",
  "access.request.status.approved": "Approved",
  "access.request.status.denied": "Denied",
  "access.request.success": "Request submitted.",
```

and to `fr`:

```ts
  "access.request.title": "Demander l'accès",
  "access.request.intro": "Vous êtes connecté mais n'avez accès à aucune OpCo. Demandez l'accès demandeur ci-dessous.",
  "access.request.opco": "OpCo",
  "access.request.note": "Note (facultatif)",
  "access.request.submit": "Envoyer la demande",
  "access.request.submitting": "Envoi…",
  "access.request.empty": "Aucune OpCo disponible pour le moment.",
  "access.request.myRequests": "Vos demandes",
  "access.request.none": "Vous n'avez pas encore fait de demande.",
  "access.request.status.pending": "En attente",
  "access.request.status.approved": "Approuvée",
  "access.request.status.denied": "Refusée",
  "access.request.success": "Demande envoyée.",
```

- [ ] **Step 2: Write the failing render-smoke test**

Create `src/test/app/request-access-client.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/access-requests", () => ({ requestAccess: vi.fn() }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import RequestAccessClient from "@/app/(dashboard)/request-access/request-access-client"

describe("RequestAccessClient", () => {
  it("renders the form when OpCos are available", () => {
    render(
      <RequestAccessClient
        opcos={[{ name: "CSquared Ghana", slug: "ghana" }]}
        requests={[]}
      />
    )
    expect(screen.getByText("Request access")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Submit request" })).toBeInTheDocument()
  })

  it("shows the empty state when no OpCos are available", () => {
    render(<RequestAccessClient opcos={[]} requests={[]} />)
    expect(screen.getByText("No OpCos are available to request right now.")).toBeInTheDocument()
  })

  it("lists existing requests with their status", () => {
    render(
      <RequestAccessClient
        opcos={[]}
        requests={[{ id: "ar-1", opcoName: "Ghana", status: "pending", decisionReason: null, createdAt: "2026-06-24T00:00:00.000Z" }]}
      />
    )
    expect(screen.getByText("Ghana")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/test/app/request-access-client.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the client component**

Create `src/app/(dashboard)/request-access/request-access-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { requestAccess } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"

export type OpCoOption = { name: string; slug: string }
export type MyRequest = {
  id: string
  opcoName: string
  status: "pending" | "approved" | "denied"
  decisionReason: string | null
  createdAt: string
}

export default function RequestAccessClient({
  opcos,
  requests,
}: {
  opcos: OpCoOption[]
  requests: MyRequest[]
}) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const [opcoSlug, setOpcoSlug] = useState(opcos[0]?.slug ?? "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await requestAccess({ opcoSlug, note: note || undefined })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = (s: MyRequest["status"]) => tr(`access.request.status.${s}`)

  return (
    <div className="mx-auto max-w-xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">{tr("access.request.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("access.request.intro")}</p>
      </div>

      {opcos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.request.empty")}</p>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            {tr("access.request.opco")}
            <select
              className="mt-1 block w-full rounded-md border bg-background p-2"
              value={opcoSlug}
              onChange={(e) => setOpcoSlug(e.target.value)}
            >
              {opcos.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {tr("access.request.note")}
            <textarea
              className="mt-1 block w-full rounded-md border bg-background p-2"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">{tr("access.request.success")}</p>}
          <Button onClick={submit} disabled={busy || !opcoSlug}>
            {busy ? tr("access.request.submitting") : tr("access.request.submit")}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{tr("access.request.myRequests")}</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("access.request.none")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3 text-sm">
                <span>{r.opcoName}</span>
                <span className="text-muted-foreground">
                  {statusLabel(r.status)}
                  {r.decisionReason ? ` — ${r.decisionReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/test/app/request-access-client.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 6: Implement the server page**

Create `src/app/(dashboard)/request-access/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { hasAnyAccess } from "@/lib/permissions"
import RequestAccessClient, { type MyRequest } from "./request-access-client"

export default async function RequestAccessPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Users who already have access don't belong here.
  if (hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/")

  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.user.keycloakId },
    select: { id: true },
  })

  const opcos = await db.opCo.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true, slug: true },
  })

  const rows = me
    ? await db.accessRequest.findMany({
        where: { userId: me.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, decisionReason: true, createdAt: true, opco: { select: { name: true } } },
      })
    : []

  const requests: MyRequest[] = rows.map((r) => ({
    id: r.id,
    opcoName: r.opco.name,
    status: r.status,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  }))

  return <RequestAccessClient opcos={opcos} requests={requests} />
}
```

- [ ] **Step 7: Add the no-access redirects**

In `src/app/page.tsx`, update the import on line 4 and add a guard immediately after the `if (!session) redirect("/login")` line:

```ts
import { viewerTier, requestScopedSlugs, hasAnyAccess } from "@/lib/permissions"
```

```ts
  if (!session) redirect("/login")

  // No standing access yet (e.g. fresh Google sign-in) → self-service request page.
  if (!hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/request-access")
```

In `src/app/(dashboard)/requests/page.tsx`, update the permissions import to include `hasAnyAccess` and add the same guard after `if (!session) redirect("/login")`:

```ts
import { viewerTier, hasAnyAccess } from "@/lib/permissions"
```

```ts
  if (!session) redirect("/login")
  if (!hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/request-access")
```

- [ ] **Step 8: Type-check and run the targeted tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/app/request-access-client.test.tsx`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(dashboard)/request-access/page.tsx" "src/app/(dashboard)/request-access/request-access-client.tsx" src/app/page.tsx "src/app/(dashboard)/requests/page.tsx" src/lib/i18n.ts src/test/app/request-access-client.test.tsx
git commit -m "feat(access): request-access landing page + no-access redirects"
```

---

### Task 8: `/access-requests` admin queue + nav item

**Files:**
- Create: `src/app/(dashboard)/access-requests/page.tsx` (server)
- Create: `src/app/(dashboard)/access-requests/access-requests-client.tsx` (client)
- Modify: `src/components/app-shell.tsx` (nav item)
- Modify: `src/lib/i18n.ts` (page + nav keys)
- Test: `src/test/app/access-requests-client.test.tsx` (create)

**Interfaces:**
- Consumes: `listAccessRequests`, `approveAccessRequest`, `denyAccessRequest` (Tasks 5/6); `canManageAnyOpCo` for page gating.
- Produces: an admin queue listing pending requests with Approve / Deny actions.

- [ ] **Step 1: Add page + nav i18n keys**

In `src/lib/i18n.ts`, add to `en`:

```ts
  "nav.accessRequests": "Access Requests",
  "access.queue.title": "Access Requests",
  "access.queue.empty": "No pending access requests.",
  "access.queue.requester": "Requester",
  "access.queue.opco": "OpCo",
  "access.queue.note": "Note",
  "access.queue.approve": "Approve",
  "access.queue.deny": "Deny",
  "access.queue.denyReason": "Reason (optional)",
```

and to `fr`:

```ts
  "nav.accessRequests": "Demandes d'accès",
  "access.queue.title": "Demandes d'accès",
  "access.queue.empty": "Aucune demande d'accès en attente.",
  "access.queue.requester": "Demandeur",
  "access.queue.opco": "OpCo",
  "access.queue.note": "Note",
  "access.queue.approve": "Approuver",
  "access.queue.deny": "Refuser",
  "access.queue.denyReason": "Motif (facultatif)",
```

- [ ] **Step 2: Write the failing render-smoke test**

Create `src/test/app/access-requests-client.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/access-requests", () => ({
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import AccessRequestsClient from "@/app/(dashboard)/access-requests/access-requests-client"

const row = {
  id: "ar-1",
  note: "Need access",
  createdAt: "2026-06-24T00:00:00.000Z",
  opcoName: "CSquared Ghana",
  opcoSlug: "ghana",
  requesterName: "Bob",
  requesterEmail: "bob@csquared.com",
}

describe("AccessRequestsClient", () => {
  it("renders a pending request with approve/deny actions", () => {
    render(<AccessRequestsClient requests={[row]} />)
    expect(screen.getByText("Bob")).toBeInTheDocument()
    expect(screen.getByText("CSquared Ghana")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument()
  })

  it("shows the empty state when there are no requests", () => {
    render(<AccessRequestsClient requests={[]} />)
    expect(screen.getByText("No pending access requests.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/test/app/access-requests-client.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the client component**

Create `src/app/(dashboard)/access-requests/access-requests-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { approveAccessRequest, denyAccessRequest } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"

export type QueueRow = {
  id: string
  note: string | null
  createdAt: string
  opcoName: string
  opcoSlug: string
  requesterName: string
  requesterEmail: string
}

export default function AccessRequestsClient({ requests }: { requests: QueueRow[] }) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [reasons, setReasons] = useState<Record<string, string>>({})

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function approve(id: string) {
    await approveAccessRequest(id)
    refresh()
  }
  async function deny(id: string) {
    await denyAccessRequest(id, reasons[id] || undefined)
    refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">{tr("access.queue.title")}</h1>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.queue.empty")}</p>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="space-y-3 rounded-md border p-4">
              <div className="text-sm">
                <div><span className="font-medium">{tr("access.queue.requester")}:</span> {r.requesterName} ({r.requesterEmail})</div>
                <div><span className="font-medium">{tr("access.queue.opco")}:</span> {r.opcoName}</div>
                {r.note && <div><span className="font-medium">{tr("access.queue.note")}:</span> {r.note}</div>}
              </div>
              <input
                className="block w-full rounded-md border bg-background p-2 text-sm"
                placeholder={tr("access.queue.denyReason")}
                value={reasons[r.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button onClick={() => approve(r.id)} disabled={pending}>{tr("access.queue.approve")}</Button>
                <Button variant="outline" onClick={() => deny(r.id)} disabled={pending}>{tr("access.queue.deny")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/test/app/access-requests-client.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Implement the server page (gated)**

Create `src/app/(dashboard)/access-requests/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageAnyOpCo } from "@/lib/permissions"
import { listAccessRequests } from "@/server/actions/access-requests"
import AccessRequestsClient, { type QueueRow } from "./access-requests-client"

export default async function AccessRequestsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canManageAnyOpCo(session.user.organizations, session.user.realmRoles)) redirect("/")

  const requests = (await listAccessRequests()) as QueueRow[]
  return <AccessRequestsClient requests={requests} />
}
```

- [ ] **Step 7: Add the nav item**

In `src/components/app-shell.tsx`, inside the `nav.userManagement` group's `items` array (after the `/users` entry on line ~63), add:

```ts
      { href: "/access-requests", labelKey: "nav.accessRequests", icon: UserPlus, gate: "admin" },
```

Add `UserPlus` to the `lucide-react` import at the top of the file (find the existing `import { ... } from "lucide-react"` line and add `UserPlus` to it).

- [ ] **Step 8: Type-check and run the targeted tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/app/access-requests-client.test.tsx`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(dashboard)/access-requests/page.tsx" "src/app/(dashboard)/access-requests/access-requests-client.tsx" src/components/app-shell.tsx src/lib/i18n.ts src/test/app/access-requests-client.test.tsx
git commit -m "feat(access): admin access-request queue + nav item"
```

---

### Task 9: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all suites pass (Testcontainers isolation test may require Docker — if Docker is down it fails rather than skips; note that separately).

- [ ] **Step 2: Lint and type-check**

Run: `pnpm lint && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: `prisma generate` + `next build` succeed.

- [ ] **Step 4: Manual smoke (local stack)** — optional but recommended

With the local docker stack up and seeded, sign in as a brand-new `@csquared.com` Google identity, confirm redirect to `/request-access`, submit a request, then sign in as a group admin, confirm the request appears in `/access-requests` and the bell, approve it, and confirm the requester now lands on the dashboard with requester scope.

---

## Plan Self-Review

**Spec coverage:**
- Auth gate relaxation → Task 1 ✅
- `AccessRequest` model + statuses → Task 2 ✅
- `requestAccess` / `approve` / `deny` / `listAccessRequests` → Tasks 5, 6 ✅
- `notifyUsers` change-free helper + new types → Task 3, used in 5/6 ✅
- `hasAnyAccess` + no-access detection → Task 4 ✅
- `/request-access` landing + redirects → Task 7 ✅
- `/access-requests` admin queue + nav → Task 8 ✅
- Audit action strings (`access.request/approve/deny`) → Tasks 5, 6 ✅
- i18n en/fr for all strings → Tasks 5, 7, 8 ✅
- Tests (actions, permissions, render smokes) → Tasks 1, 3, 4, 5, 6, 7, 8 ✅
- Dedup enforced in action → Task 5 ✅

**Type consistency:** `requestAccess({ opcoSlug, note? })`, `approveAccessRequest(id)`, `denyAccessRequest(id, reason?)`, `listAccessRequests()` return shape, `notifyUsers(recipients, { type, title, body })`, and `hasAnyAccess(organizations, realmRoles)` are used identically across tasks and tests. `AccessRequestStatus` values `pending|approved|denied` match the schema, the client `MyRequest["status"]` union, and the i18n status keys.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.
