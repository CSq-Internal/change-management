# Self-service requester access and role elevation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first sign-in picks an OpCo and becomes a requester there at once. Higher
roles are requested from Settings → Profile and approved on the Role requests page.

**Architecture:** The `/request-access` gate keeps its route but becomes a one-step
"Choose your OpCo" screen backed by a new `joinOpCo` action. The existing
`AccessRequest` table, its approve and deny actions, and `/access-requests` become the
elevation queue. A new `requestRole` action replaces `requestAccess`. The JWT callback
reloads OpCo roles on a NextAuth session `update()`, so a new requester isn't held at
the gate for 60 seconds. A data-only migration grants pending requester requests.

**Tech Stack:** Next.js 16 App Router, NextAuth v5, Prisma 7 (Postgres), Vitest + React
Testing Library, Testcontainers for the migration test, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-16-self-service-requester-design.md`

## Global Constraints

- Branch `feat/self-service-requester`, cut from `dev`. Feature → dev → prod; never branch from prod.
- Commits carry **no** `Co-Authored-By` or other AI trailer.
- Every user-visible string goes through `t(language, key)` with both an EN and an FR entry in `src/lib/i18n.ts`.
- Gate notice EN: "You'll start as a requester: you can raise and track changes for this OpCo. If you need to approve, audit or administer changes, request a role from Settings → Profile once you're in."
- Gate notice FR: "Vous commencerez en tant que demandeur : vous pourrez créer et suivre des changements pour cette OpCo. Pour approuver, auditer ou administrer des changements, demandez un rôle depuis Paramètres → Profil une fois connecté."
- Requestable roles are exactly `approver`, `auditor` and `admin`. Never `requester`, `group_admin` or `group_auditor`.
- Who may decide stays `canAssignRole` (`src/lib/permissions.ts`), unchanged.
- The reason on a role request is required and at most 500 characters (trimmed).
- Phase gate before finishing: `pnpm test` (vitest, `--exclude '.claude/**'`), `pnpm tsc --noEmit`, `pnpm lint` with 0 errors (65 warnings is the baseline), then a deslop pass.
- Test commands: `pnpm vitest run <path> --exclude '.claude/**'`.
- **Ruling (plan vs spec):** the spec names the audit actions `access.self_joined` and `access.requested`. This plan uses `access.join` and keeps `access.request`, to match the existing `access.request` / `access.approve` / `access.deny` vocabulary. Cost if wrong: renaming two strings.

## Review Focus

1. **An OpCo admin seeing an admin-role request they can't decide.** `listAccessRequests` must hide `role: admin` requests from anyone who isn't a group admin, or Approve throws "Forbidden" in front of them. Test in Task 4.
2. **A user with only an ended assignment.** `joinOpCo` must treat ended (`isActive: false`) assignments as "no OpCo" and reactivate the row as requester, not hit the `@@unique([userId, opcoId])` constraint. Test in Task 2.
3. **Reason that is only whitespace.** `requestRole` must refuse "   " as an empty reason. Test in Task 4.
4. **Migration over an inactive, higher-role assignment.** A pending requester request for an OpCo where the user has an *ended* approver row must reactivate it as requester, not as approver. An *active* row keeps its role. Test in Task 6.
5. **Double-click on Continue.** A second `joinOpCo` call after the first succeeded must fail cleanly ("You already belong to an OpCo") with no second assignment. Test in Task 2 (the "already belongs" case covers it), and the button disables while busy (Task 3).

---

### Task 1: Reload OpCo roles on a session update

**Files:**
- Modify: `src/lib/auth-callbacks.ts` (the `else if` TTL branch, about line 98)
- Test: `src/test/auth-enrichment.test.ts`

**Interfaces:**
- Produces: calling `update()` from `next-auth/react` makes the next token carry fresh `organizations`. Task 3 relies on this.

- [ ] **Step 1: Write the failing test.** Add after the test named `'does NOT hit the DB on a fresh token refresh (within TTL)'`:

```ts
  it('re-enriches organizations on a session update even inside the TTL', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([
      { role: 'requester', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: Date.now() }, // fresh
      user: {},
      account: null,
      trigger: 'update',
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['requester'] },
    ])
  })
```

- [ ] **Step 2: Run it and watch it fail.**
Run: `pnpm vitest run src/test/auth-enrichment.test.ts --exclude '.claude/**'`
Expected: FAIL, `organizations` is `[]`.

- [ ] **Step 3: Implement.** In `enrichedJwt`, change the branch condition:

```ts
  } else if (
    token.keycloakId &&
    (params.trigger === "update" || Date.now() - (token.orgsRefreshedAt ?? 0) > ORGS_TTL_MS)
  ) {
```

Update the comment above it to say a session `update()` (sent by the client after joining an OpCo) also forces the reload.

- [ ] **Step 4: Run the file.** Expected: all tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth-callbacks.ts src/test/auth-enrichment.test.ts
git commit -m "feat(auth): reload OpCo roles when the session is updated"
```

---

### Task 2: `joinOpCo` server action

**Files:**
- Modify: `src/server/actions/access-requests.ts`
- Modify: `src/lib/i18n.ts` (EN and FR `notif.access.joined.title`)
- Modify: `src/app/(dashboard)/admin-audit/audit-client.tsx` (`ACTIONS`)
- Test: `src/test/actions/access-requests.test.ts`

**Interfaces:**
- Produces: `joinOpCo(opcoSlug: string): Promise<{ ok: true }>`. It throws `"You already belong to an OpCo"`, `"OpCo not found"` or `"User not found"`.
- Audit action name: `access.join`.
- Notification type: `access.joined`.

- [ ] **Step 1: Write the failing tests.** The mock already has `userOpCoAssignment.upsert`; the tests below set `opCo.findUnique` results that include `archivedAt`. Import `joinOpCo` with the other actions. Append:

```ts
describe("joinOpCo", () => {
  it("grants requester in the chosen OpCo, audits it and tells the OpCo's admins in-app", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "admin-1" }])

    await expect(joinOpCo("ghana")).resolves.toEqual({ ok: true })

    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_opcoId: { userId: "bob-db", opcoId: "opco-ghana" } },
      update: { role: "requester", isActive: true, endedAt: null },
      create: { userId: "bob-db", opcoId: "opco-ghana", role: "requester" },
    })
    expect(recordAdminAction).toHaveBeenCalledWith(mockDb, expect.objectContaining({ action: "access.join", opcoId: "opco-ghana" }))
    expect(assignToOrganization).toHaveBeenCalledWith("kc-bob", "ghana")
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "admin-1" }], expect.objectContaining({ type: "access.joined" }))
    expect(sendAccessRequestEmail).not.toHaveBeenCalled()
  })

  it("refuses a user who already has an active OpCo role (and a second click)", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(joinOpCo("ghana")).rejects.toThrow(/already belong to an OpCo/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("only counts active assignments as belonging", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    await joinOpCo("ghana")
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "bob-db", isActive: true },
      select: { id: true },
    })
  })

  it("refuses an unknown or archived OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValueOnce(null)
    await expect(joinOpCo("nowhere")).rejects.toThrow(/OpCo not found/i)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-old", name: "Old", slug: "old", locale: "en", archivedAt: new Date() })
    await expect(joinOpCo("old")).rejects.toThrow(/OpCo not found/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("never notifies the joiner even when they are also an admin elsewhere", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "bob-db" }, { userId: "admin-1" }])
    await joinOpCo("ghana")
    expect(vi.mocked(notifyUsers).mock.calls[0][0]).toEqual([{ userId: "admin-1" }])
  })
})
```

Add to the imports at the top: `import { recordAdminAction } from "@/server/audit"` and `import { assignToOrganization } from "@/server/keycloak"`.

- [ ] **Step 2: Run and watch them fail.**
Run: `pnpm vitest run src/test/actions/access-requests.test.ts --exclude '.claude/**'`
Expected: FAIL, `joinOpCo` is not exported.

- [ ] **Step 3: Implement** in `src/server/actions/access-requests.ts`, above `listAccessRequests`:

```ts
// First sign-in: the user picks their OpCo and becomes a requester there at once.
// Only for users with no active OpCo role, so it can't be used to collect OpCos;
// anything more goes through requestRole or an admin.
export async function joinOpCo(opcoSlug: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const belongs = await db.userOpCoAssignment.findFirst({
    where: { userId: me.id, isActive: true },
    select: { id: true },
  })
  if (belongs) throw new Error("You already belong to an OpCo")

  const opco = await db.opCo.findUnique({
    where: { slug: opcoSlug },
    select: { id: true, name: true, slug: true, locale: true, archivedAt: true },
  })
  if (!opco || opco.archivedAt) throw new Error("OpCo not found")

  await db.$transaction(async (tx) => {
    await tx.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: me.id, opcoId: opco.id } },
      update: { role: "requester", isActive: true, endedAt: null },
      create: { userId: me.id, opcoId: opco.id, role: "requester" },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.join",
      summary: `Joined ${opco.name} as requester`,
      opcoId: opco.id,
      targetUserId: me.id,
      metadata: { opcoSlug },
    })
  })

  try {
    await assignToOrganization(session.keycloakId, opco.slug)
  } catch (err) {
    console.warn(`[keycloak] org assignment skipped for ${opco.slug}:`, err)
  }

  const admins = await db.userOpCoAssignment.findMany({
    where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
    select: { userId: true },
  })
  const recipients = admins.filter((a) => a.userId !== me.id).map((a) => ({ userId: a.userId }))
  await notifyUsers(recipients, {
    type: "access.joined",
    title: t(coerceLocale(opco.locale), "notif.access.joined.title"),
    body: `${session.name ?? session.email} → ${opco.name}`,
  })

  return { ok: true as const }
}
```

Add to `src/lib/i18n.ts`, next to `notif.access.requested.title` in each block:
- EN: `"notif.access.joined.title": "New requester joined",`
- FR: `"notif.access.joined.title": "Nouveau demandeur",`

In `audit-client.tsx`, add `"access.join", "access.request", "access.approve", "access.deny",` to `ACTIONS` after `"delegation.create", "delegation.revoke",`.

- [ ] **Step 4: Run the file.** Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/server/actions/access-requests.ts src/lib/i18n.ts "src/app/(dashboard)/admin-audit/audit-client.tsx" src/test/actions/access-requests.test.ts
git commit -m "feat(access): first sign-in joins an OpCo as requester without approval"
```

---

### Task 3: "Choose your OpCo" gate screen

**Files:**
- Modify: `src/app/(dashboard)/request-access/page.tsx`
- Modify: `src/app/(dashboard)/request-access/request-access-client.tsx`
- Modify: `src/lib/i18n.ts` (EN and FR `access.join.*`; remove the `access.request.*` keys this screen no longer uses: `title`, `intro`, `note`, `submit`, `submitting`, `empty`, `success`. Keep `opco`, `myRequests`, `none` and `status.*`, which Task 5 reuses)
- Test: `src/test/app/request-access-client.test.tsx`

**Interfaces:**
- Consumes: `joinOpCo(opcoSlug)` (Task 2); `update()` from `useSession` reloads roles (Task 1).
- Produces: default export `RequestAccessClient({ opcos }: { opcos: OpCoOption[] })`; `OpCoOption = { name: string; slug: string }`.

- [ ] **Step 1: Write the failing tests.** Replace the file's contents:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const joinOpCo = vi.fn()
const update = vi.fn()
const replace = vi.fn()
vi.mock("@/server/actions/access-requests", () => ({ joinOpCo: (...a: unknown[]) => joinOpCo(...a) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ update }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))
let language = "en"
vi.mock("@/lib/store", () => ({ useStore: () => ({ language }) }))

import RequestAccessClient from "@/app/(dashboard)/request-access/request-access-client"

const opcos = [{ name: "CSquared Ghana", slug: "ghana" }, { name: "CSquared Uganda", slug: "uganda" }]

beforeEach(() => {
  vi.clearAllMocks()
  language = "en"
})

describe("RequestAccessClient (choose your OpCo)", () => {
  it("shows the OpCo picker and the requester notice", () => {
    render(<RequestAccessClient opcos={opcos} />)
    expect(screen.getByText("Choose your OpCo")).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toBeInTheDocument()
    expect(screen.getByText(/You'll start as a requester/)).toBeInTheDocument()
    expect(screen.getByText(/request a role from Settings → Profile/)).toBeInTheDocument()
  })

  it("shows the notice in French", () => {
    language = "fr"
    render(<RequestAccessClient opcos={opcos} />)
    expect(screen.getByText(/Vous commencerez en tant que demandeur/)).toBeInTheDocument()
  })

  it("joins the chosen OpCo, refreshes the session, then goes to the dashboard", async () => {
    joinOpCo.mockResolvedValue({ ok: true })
    render(<RequestAccessClient opcos={opcos} />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "uganda" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"))
    expect(joinOpCo).toHaveBeenCalledWith("uganda")
    expect(update).toHaveBeenCalled()
  })

  it("shows the error and stays put when joining fails", async () => {
    joinOpCo.mockRejectedValue(new Error("You already belong to an OpCo"))
    render(<RequestAccessClient opcos={opcos} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByText("You already belong to an OpCo")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("shows the empty state when no OpCos exist", () => {
    render(<RequestAccessClient opcos={[]} />)
    expect(screen.getByText("No OpCos are set up yet. Contact your administrator.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch them fail.**
Run: `pnpm vitest run src/test/app/request-access-client.test.tsx --exclude '.claude/**'`
Expected: FAIL, the old heading "Request access" renders instead.

- [ ] **Step 3: Implement.** Replace `request-access-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { joinOpCo } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"

export type OpCoOption = { name: string; slug: string }

export default function RequestAccessClient({ opcos }: { opcos: OpCoOption[] }) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const { update } = useSession()
  const router = useRouter()
  const [opcoSlug, setOpcoSlug] = useState(opcos[0]?.slug ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await joinOpCo(opcoSlug)
      // Reload the session's OpCo roles now; otherwise the gate holds the user
      // until the 60s refresh. update() rewrites the session cookie the proxy reads.
      await update()
      router.replace("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{tr("access.join.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("access.join.intro")}</p>
      </div>

      {opcos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.join.empty")}</p>
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
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {tr("access.join.notice")}
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button onClick={submit} disabled={busy || !opcoSlug}>
            {busy ? tr("access.join.continuing") : tr("access.join.continue")}
          </Button>
        </div>
      )}
    </div>
  )
}
```

Replace the body of `page.tsx` below the `hasAnyAccess` redirect with:

```tsx
  const opcos = await getPrisma().opCo.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true, slug: true },
  })

  return <RequestAccessClient opcos={opcos} />
}
```

and drop the now-unused `MyRequest` import.

Add to `src/lib/i18n.ts`, EN block:

```ts
    "access.join.title": "Choose your OpCo",
    "access.join.intro": "Pick the OpCo you work for to start using the CMS.",
    "access.join.notice": "You'll start as a requester: you can raise and track changes for this OpCo. If you need to approve, audit or administer changes, request a role from Settings → Profile once you're in.",
    "access.join.continue": "Continue",
    "access.join.continuing": "Setting up…",
    "access.join.empty": "No OpCos are set up yet. Contact your administrator.",
```

FR block:

```ts
    "access.join.title": "Choisissez votre OpCo",
    "access.join.intro": "Choisissez l'OpCo pour laquelle vous travaillez pour commencer à utiliser le CMS.",
    "access.join.notice": "Vous commencerez en tant que demandeur : vous pourrez créer et suivre des changements pour cette OpCo. Pour approuver, auditer ou administrer des changements, demandez un rôle depuis Paramètres → Profil une fois connecté.",
    "access.join.continue": "Continuer",
    "access.join.continuing": "Configuration…",
    "access.join.empty": "Aucune OpCo n'est encore configurée. Contactez votre administrateur.",
```

Remove the unused `access.request.*` keys listed under **Files** from both blocks.

- [ ] **Step 4: Run the file, then `pnpm tsc --noEmit`.** Expected: tests PASS. tsc may still report `requestAccess` usage elsewhere; there should be none.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(dashboard)/request-access" src/lib/i18n.ts src/test/app/request-access-client.test.tsx
git commit -m "feat(access): choose-your-OpCo screen replaces the access request form"
```

---

### Task 4: `requestRole`, my requests, and a decidable queue

**Files:**
- Modify: `src/server/actions/access-requests.ts` (delete `requestAccess`; add `requestRole`, `listMyRoleRequests`; change `listAccessRequests`)
- Modify: `src/server/email.tsx` (`sendAccessRequestEmail` takes `role`)
- Modify: `src/emails/access-request.tsx` (wording names the role)
- Modify: `src/lib/i18n.ts` (`notif.access.*` titles → role request wording)
- Test: `src/test/actions/access-requests.test.ts`, plus the email template test if `src/test/emails` covers `AccessRequestEmail`

**Interfaces:**
- Produces:
  - `type RequestableRole = "approver" | "auditor" | "admin"` (exported)
  - `requestRole(input: { opcoSlug: string; role: RequestableRole; reason: string }): Promise<{ id: string }>`
  - `listMyRoleRequests(): Promise<{ id: string; opcoName: string; role: string; status: "pending" | "approved" | "denied"; decisionReason: string | null; createdAt: string }[]>`
  - `listAccessRequests()` rows gain `role: string`.
  - `sendAccessRequestEmail({ to, adminName, requesterName, opcoName, role, locale })`.

- [ ] **Step 1: Write the failing tests.** Delete the `describe("requestAccess", …)` block. Change the import line to `import { requestRole, listMyRoleRequests, listAccessRequests, joinOpCo } from "@/server/actions/access-requests"`. Add:

```ts
describe("requestRole", () => {
  const ask = (over: Partial<{ opcoSlug: string; role: "approver" | "auditor" | "admin"; reason: string }> = {}) =>
    requestRole({ opcoSlug: "ghana", role: "approver", reason: "I lead the Ghana NOC", ...over })

  it("creates a pending request with the reason and audits it", async () => {
    await expect(ask()).resolves.toEqual({ id: "ar-1" })
    expect(mockDb.accessRequest.create).toHaveBeenCalledWith({
      data: { userId: "bob-db", opcoId: "opco-ghana", role: "approver", note: "I lead the Ghana NOC" },
    })
    expect(recordAdminAction).toHaveBeenCalledWith(mockDb, expect.objectContaining({ action: "access.request" }))
  })

  it("refuses the requester and group roles", async () => {
    await expect(ask({ role: "requester" as never })).rejects.toThrow(/cannot be requested/i)
    await expect(ask({ role: "group_admin" as never })).rejects.toThrow(/cannot be requested/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("refuses an empty or whitespace reason, and one over 500 characters", async () => {
    await expect(ask({ reason: "   " })).rejects.toThrow(/reason is required/i)
    await expect(ask({ reason: "x".repeat(501) })).rejects.toThrow(/500 characters/i)
  })

  it("refuses a role the user already holds in that OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(ask()).rejects.toThrow(/already have this role/i)
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "bob-db", opcoId: "opco-ghana", role: "approver", isActive: true },
      select: { id: true },
    })
  })

  it("refuses a second pending request for the same OpCo", async () => {
    mockDb.accessRequest.findFirst.mockResolvedValue({ id: "ar-0" })
    await expect(ask()).rejects.toThrow(/pending request for this OpCo/i)
  })

  it("refuses an unknown OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    await expect(ask({ opcoSlug: "nowhere" })).rejects.toThrow(/OpCo not found/i)
  })

  it("sends approver and auditor requests to OpCo admins and group admins, deduped, never the requester", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
    ])
    mockDb.user.findMany.mockResolvedValue([
      { id: "admin-1", email: "admin1@csquared.com", name: "Admin One", locale: "en" },
      { id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" },
      { id: "bob-db", email: "bob@csquared.com", name: "Bob", locale: "en" },
    ])
    await ask({ role: "auditor" })
    const notified = vi.mocked(notifyUsers).mock.calls[0][0]
    expect(notified).toEqual(expect.arrayContaining([{ userId: "admin-1" }, { userId: "ga-2" }]))
    expect(notified).toHaveLength(2)
    expect(sendAccessRequestEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin1@csquared.com", role: "auditor" }))
    expect(sendAccessRequestEmail).toHaveBeenCalledTimes(2)
  })

  it("sends admin requests to group admins only", async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" }])
    await ask({ role: "admin" })
    expect(mockDb.userOpCoAssignment.findMany).not.toHaveBeenCalled()
    expect(vi.mocked(notifyUsers).mock.calls[0][0]).toEqual([{ userId: "ga-2" }])
  })
})

describe("listMyRoleRequests", () => {
  it("returns the caller's requests newest first", async () => {
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-2", role: "approver", status: "pending", decisionReason: null, createdAt: new Date("2026-10-16T09:00:00Z"), opco: { name: "CSquared Ghana" } },
    ])
    await expect(listMyRoleRequests()).resolves.toEqual([
      { id: "ar-2", opcoName: "CSquared Ghana", role: "approver", status: "pending", decisionReason: null, createdAt: "2026-10-16T09:00:00.000Z" },
    ])
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "bob-db" },
      orderBy: { createdAt: "desc" },
    }))
  })
})
```

In `describe("listAccessRequests")`, add:

```ts
  it("hides admin-role requests from OpCo admins, who can't decide them", async () => {
    vi.mocked(getAppSession).mockResolvedValue({
      ...member,
      organizations: [{ id: "opco-ghana", name: "CSquared Ghana", alias: "ghana", roles: ["admin"] }],
    })
    mockDb.accessRequest.findMany.mockResolvedValue([])
    await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "pending", opco: { slug: { in: ["ghana"] } }, role: { not: "admin" } },
    }))
  })

  it("returns each request's role", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-1", role: "approver", note: "Lead", createdAt: new Date("2026-10-16T09:00:00Z"), opco: { name: "CSquared Ghana", slug: "ghana" }, user: { name: "Bob", email: "bob@csquared.com" } },
    ])
    const rows = await listAccessRequests()
    expect(rows[0].role).toBe("approver")
  })
```

Check the two existing `listAccessRequests` tests still match the new `where`. The group-admin case has no `role` filter. In the OpCo-admin case, add `role: { not: "admin" }` to its expected `where`.

- [ ] **Step 2: Run and watch them fail.**
Run: `pnpm vitest run src/test/actions/access-requests.test.ts --exclude '.claude/**'`
Expected: FAIL, `requestRole` is not exported.

- [ ] **Step 3: Implement.** In `access-requests.ts`, delete `requestAccess` and add:

```ts
export type RequestableRole = "approver" | "auditor" | "admin"
const REQUESTABLE_ROLES: readonly string[] = ["approver", "auditor", "admin"]
const MAX_REASON = 500

// Elevation: ask for a higher role in an OpCo. Who is told mirrors canAssignRole:
// OpCo admins can grant approver/auditor in their OpCo; only group admins grant admin.
export async function requestRole(input: { opcoSlug: string; role: RequestableRole; reason: string }) {
  if (!REQUESTABLE_ROLES.includes(input.role)) throw new Error(`The ${input.role} role cannot be requested`)
  const reason = input.reason.trim()
  if (!reason) throw new Error("A reason is required")
  if (reason.length > MAX_REASON) throw new Error(`Keep the reason to ${MAX_REASON} characters`)

  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const opco = await db.opCo.findUnique({
    where: { slug: input.opcoSlug },
    select: { id: true, name: true, locale: true, archivedAt: true },
  })
  if (!opco || opco.archivedAt) throw new Error("OpCo not found")

  const holds = await db.userOpCoAssignment.findFirst({
    where: { userId: me.id, opcoId: opco.id, role: input.role, isActive: true },
    select: { id: true },
  })
  if (holds) throw new Error("You already have this role in this OpCo")

  const pending = await db.accessRequest.findFirst({
    where: { userId: me.id, opcoId: opco.id, status: "pending" },
    select: { id: true },
  })
  if (pending) throw new Error("You already have a pending request for this OpCo")

  const created = await db.accessRequest.create({
    data: { userId: me.id, opcoId: opco.id, role: input.role, note: reason },
  })

  await recordAdminAction(db, {
    actorKeycloakId: session.keycloakId,
    actorEmail: session.email,
    actorName: session.name,
    action: "access.request",
    summary: `Requested ${input.role} in ${opco.name}`,
    opcoId: opco.id,
    metadata: { accessRequestId: created.id, opcoSlug: input.opcoSlug, role: input.role },
  })

  // group_admin lives only in Keycloak, mirrored to User.isGroupAdmin at sign-in.
  const opAdmins =
    input.role === "admin"
      ? []
      : await db.userOpCoAssignment.findMany({
          where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
          select: { userId: true, user: { select: { email: true, name: true, locale: true } } },
        })
  const groupAdmins = await db.user.findMany({
    where: { isGroupAdmin: true, isActive: true },
    select: { id: true, email: true, name: true, locale: true },
  })

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
      { type: "access.requested", title: t(opcoLocale, "notif.access.requested.title"), body: `${requesterName} → ${input.role}, ${opco.name}` }
    ),
    ...recipients.map((r) =>
      sendAccessRequestEmail({
        to: r.email,
        adminName: r.name ?? r.email,
        requesterName,
        opcoName: opco.name,
        role: input.role,
        locale: coerceLocale(r.locale),
      })
    ),
  ])

  return { id: created.id }
}

export async function listMyRoleRequests() {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) return []

  const rows = await db.accessRequest.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, status: true, decisionReason: true, createdAt: true, opco: { select: { name: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    opcoName: r.opco.name,
    role: r.role as string,
    status: r.status,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  }))
}
```

In `listAccessRequests`, change `where` and `select`, and add `role` to the mapped row:

```ts
    where: {
      status: "pending",
      // Only group admins can grant admin (canAssignRole), so OpCo admins never see those.
      ...(scope === "all" ? {} : { opco: { slug: { in: scope } }, role: { not: "admin" as const } }),
    },
```

Add `role: true,` to `select` and `role: r.role as string,` to the returned object.

In `src/server/email.tsx`, `sendAccessRequestEmail` gains `role: string` in `opts`. Its subject becomes `fr ? \`Nouvelle demande de rôle : ${opts.opcoName}\` : \`New role request: ${opts.opcoName}\``, and it passes `role={opts.role}` to the template.

In `src/emails/access-request.tsx`, add `role: string` to the props and change the body sentence:

```tsx
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr ? `a demandé le rôle ${ROLE_FR[role] ?? role} pour ` : `asked for the ${role} role in `}
        <strong>{opcoName}</strong>.
      </Text>
```

with `const ROLE_FR: Record<string, string> = { approver: "approbateur", auditor: "auditeur", admin: "administrateur" }` above the component. The preview text becomes `fr ? \`Demande de rôle : ${opcoName}\` : \`Role request: ${opcoName}\``.

In `src/lib/i18n.ts` change the three titles. EN: `"New role request"`, `"Role request approved"`, `"Role request denied"`. FR: `"Nouvelle demande de rôle"`, `"Demande de rôle approuvée"`, `"Demande de rôle refusée"`.

- [ ] **Step 4: Run the file and the email tests.**
Run: `pnpm vitest run src/test/actions/access-requests.test.ts src/test/emails --exclude '.claude/**'`
Expected: all PASS. Fix any email snapshot or text assertions that quoted "requested access to"; they should now expect the role wording.

- [ ] **Step 5: Commit.**

```bash
git add src/server/actions/access-requests.ts src/server/email.tsx src/emails/access-request.tsx src/lib/i18n.ts src/test
git commit -m "feat(access): request a higher role with a reason; queue shows only decidable requests"
```

---

### Task 5: "Request a role" card on Profile, and the Role requests page

**Files:**
- Create: `src/app/(dashboard)/settings/profile/profile-client.tsx` (the current `page.tsx` content moves here, unchanged apart from rendering the card)
- Create: `src/app/(dashboard)/settings/profile/role-request-card.tsx`
- Modify: `src/app/(dashboard)/settings/profile/page.tsx` (becomes a server component)
- Modify: `src/app/(dashboard)/access-requests/access-requests-client.tsx` (role line, "Reason" label)
- Modify: `src/lib/i18n.ts` (`roles.*`, `access.role.*`; `nav.accessRequests` and `access.queue.*` copy)
- Test: Create `src/test/app/role-request-card.test.tsx`; modify `src/test/app/access-requests-client.test.tsx`

**Interfaces:**
- Consumes: `requestRole`, `listMyRoleRequests`, `RequestableRole` (Task 4); queue rows carry `role` (Task 4).
- Produces: `RoleRequestCard({ opcos, requests }: { opcos: { name: string; slug: string }[]; requests: MyRoleRequest[] })`; `MyRoleRequest` = the `listMyRoleRequests` row type.

- [ ] **Step 1: Write the failing tests.** Create `src/test/app/role-request-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const requestRole = vi.fn()
const refresh = vi.fn()
vi.mock("@/server/actions/access-requests", () => ({ requestRole: (...a: unknown[]) => requestRole(...a) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import RoleRequestCard from "@/app/(dashboard)/settings/profile/role-request-card"

const opcos = [{ name: "CSquared Ghana", slug: "ghana" }]

beforeEach(() => vi.clearAllMocks())

describe("RoleRequestCard", () => {
  it("sends the OpCo, role and reason", async () => {
    requestRole.mockResolvedValue({ id: "ar-1" })
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "auditor" } })
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Quarterly ISO audit" } })
    fireEvent.click(screen.getByRole("button", { name: "Request role" }))
    await waitFor(() => expect(requestRole).toHaveBeenCalledWith({ opcoSlug: "ghana", role: "auditor", reason: "Quarterly ISO audit" }))
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the button disabled until a reason is typed", () => {
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    expect(screen.getByRole("button", { name: "Request role" })).toBeDisabled()
  })

  it("shows the server's refusal", async () => {
    requestRole.mockRejectedValue(new Error("You already have a pending request for this OpCo"))
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Request role" }))
    expect(await screen.findByText("You already have a pending request for this OpCo")).toBeInTheDocument()
  })

  it("lists past requests with role, status and the denial reason", () => {
    render(
      <RoleRequestCard
        opcos={opcos}
        requests={[{ id: "ar-1", opcoName: "CSquared Ghana", role: "approver", status: "denied", decisionReason: "Not on the CAB", createdAt: "2026-10-16T09:00:00.000Z" }]}
      />
    )
    expect(screen.getByText(/Approver · CSquared Ghana/)).toBeInTheDocument()
    expect(screen.getByText(/Denied — Not on the CAB/)).toBeInTheDocument()
  })
})
```

In `src/test/app/access-requests-client.test.tsx`, add `role: "approver"` to `row`. Change the empty-state text to `"No pending role requests."`. Add `expect(screen.getByText("Approver")).toBeInTheDocument()` to the first test.

- [ ] **Step 2: Run and watch them fail.**
Run: `pnpm vitest run src/test/app/role-request-card.test.tsx src/test/app/access-requests-client.test.tsx --exclude '.claude/**'`
Expected: FAIL, the module isn't found, and the old empty-state text renders.

- [ ] **Step 3: Implement.** Create `role-request-card.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { requestRole, type RequestableRole } from "@/server/actions/access-requests"

export type MyRoleRequest = {
  id: string
  opcoName: string
  role: string
  status: "pending" | "approved" | "denied"
  decisionReason: string | null
  createdAt: string
}

const ROLES: RequestableRole[] = ["approver", "auditor", "admin"]
const fieldClass = "mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"

export default function RoleRequestCard({
  opcos,
  requests,
}: {
  opcos: { name: string; slug: string }[]
  requests: MyRoleRequest[]
}) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const router = useRouter()
  const [opcoSlug, setOpcoSlug] = useState(opcos[0]?.slug ?? "")
  const [role, setRole] = useState<RequestableRole>("approver")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await requestRole({ opcoSlug, role, reason })
      setReason("")
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("access.role.title")}</CardTitle>
        <CardDescription>{tr("access.role.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Labels point at their fields by id: a wrapping label's text would include the options. */}
          <div>
            <label htmlFor="rr-opco" className="block text-sm font-medium">{tr("access.request.opco")}</label>
            <select id="rr-opco" className={fieldClass} value={opcoSlug} onChange={(e) => setOpcoSlug(e.target.value)}>
              {opcos.map((o) => (<option key={o.slug} value={o.slug}>{o.name}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="rr-role" className="block text-sm font-medium">{tr("access.role.role")}</label>
            <select id="rr-role" className={fieldClass} value={role} onChange={(e) => setRole(e.target.value as RequestableRole)}>
              {ROLES.map((r) => (<option key={r} value={r}>{tr(`roles.${r}`)}</option>))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="rr-reason" className="block text-sm font-medium">{tr("access.role.reason")}</label>
          <textarea id="rr-reason" className={fieldClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {done && <p className="text-sm text-emerald-600">{tr("access.role.sent")}</p>}
        <Button onClick={submit} disabled={busy || !opcoSlug || !reason.trim()}>
          {tr("access.role.submit")}
        </Button>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tr("access.request.myRequests")}</h3>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("access.request.none")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>{tr(`roles.${r.role}`)} · {r.opcoName}</span>
                  <span className="text-muted-foreground">
                    {tr(`access.request.status.${r.status}`)}
                    {r.decisionReason ? ` — ${r.decisionReason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

Move the whole current `page.tsx` into `profile-client.tsx`, rename the component `ProfileClient`, give it the props `{ opcos, requests }`, and render the card between the two existing cards when the user has an OpCo role:

```tsx
      {(currentUser?.organizations?.length ?? 0) > 0 && <RoleRequestCard opcos={opcos} requests={requests} />}
```

The existing local variable named `opcos` (the profile text) collides with the new prop, so rename it to `opcoSummary` and update its one use.

New `page.tsx`:

```tsx
import { getPrisma } from "@/server/db"
import { listMyRoleRequests } from "@/server/actions/access-requests"
import ProfileClient from "./profile-client"

export default async function ProfileSettingsPage() {
  const [opcos, requests] = await Promise.all([
    getPrisma().opCo.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    listMyRoleRequests(),
  ])
  return <ProfileClient opcos={opcos} requests={requests} />
}
```

In `access-requests-client.tsx`, add `role: string` to `QueueRow`. Under the OpCo line, render:

```tsx
                <div>
                  <span className="font-medium">{tr("access.role.role")}:</span> <span>{tr(`roles.${r.role}`)}</span>
                </div>
```

Add to i18n. EN:

```ts
    "roles.requester": "Requester",
    "roles.approver": "Approver",
    "roles.auditor": "Auditor",
    "roles.admin": "Admin",
    "access.role.title": "Request a role",
    "access.role.desc": "Need to approve, audit or administer changes? Ask for the role here. An admin for that OpCo decides.",
    "access.role.role": "Role",
    "access.role.reason": "Reason",
    "access.role.submit": "Request role",
    "access.role.sent": "Request sent. You'll be notified of the decision.",
```

FR:

```ts
    "roles.requester": "Demandeur",
    "roles.approver": "Approbateur",
    "roles.auditor": "Auditeur",
    "roles.admin": "Administrateur",
    "access.role.title": "Demander un rôle",
    "access.role.desc": "Besoin d'approuver, d'auditer ou d'administrer des changements ? Demandez le rôle ici. Un administrateur de cette OpCo décide.",
    "access.role.role": "Rôle",
    "access.role.reason": "Motif",
    "access.role.submit": "Demander le rôle",
    "access.role.sent": "Demande envoyée. Vous serez informé de la décision.",
```

Change these existing values. EN: `nav.accessRequests` and `access.queue.title` → "Role requests"; `access.queue.empty` → "No pending role requests."; `access.queue.note` → "Reason". FR: "Demandes de rôle", "Aucune demande de rôle en attente.", "Motif".

- [ ] **Step 4: Run both files, then `pnpm tsc --noEmit`.** Expected: PASS, and tsc clean.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(dashboard)/settings/profile" "src/app/(dashboard)/access-requests/access-requests-client.tsx" src/lib/i18n.ts src/test/app
git commit -m "feat(access): request a role from Profile; access requests become role requests"
```

---

### Task 6: Grant pending requester requests at deploy

**Files:**
- Create: `prisma/migrations/20261016120000_self_service_requester/migration.sql`
- Test: Create `src/test/integration/self-service-requester-migration.test.ts`

**Interfaces:**
- Consumes: the existing tables `AccessRequest` and `UserOpCoAssignment`, and the enums `Role` and `AccessRequestStatus`.

- [ ] **Step 1: Write the failing test.** The container runs `prisma migrate deploy` before any rows exist, so the test seeds rows and then runs the migration file's SQL itself:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { startTestDb, stopTestDb, getTestDb } from '../db'

const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261016120000_self_service_requester/migration.sql'),
  'utf8',
)

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  const ghana = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  const uganda = await db.opCo.create({ data: { slug: 'uganda', name: 'Uganda', keycloakOrgId: 'org-ug' } })
  const ama = await db.user.create({ data: { keycloakId: 'kc-ama', email: 'ama@csquared.com' } })
  const kofi = await db.user.create({ data: { keycloakId: 'kc-kofi', email: 'kofi@csquared.com' } })
  const esi = await db.user.create({ data: { keycloakId: 'kc-esi', email: 'esi@csquared.com' } })

  // Ama: plain pending requester request → gets an assignment.
  await db.accessRequest.create({ data: { id: 'ar-ama', userId: ama.id, opcoId: ghana.id, role: 'requester' } })
  // Kofi: pending approver request → untouched.
  await db.accessRequest.create({ data: { id: 'ar-kofi', userId: kofi.id, opcoId: ghana.id, role: 'approver' } })
  // Esi: an ENDED approver row in Uganda plus a pending requester request there → reactivated as requester.
  await db.userOpCoAssignment.create({ data: { userId: esi.id, opcoId: uganda.id, role: 'approver', isActive: false, endedAt: new Date() } })
  await db.accessRequest.create({ data: { id: 'ar-esi', userId: esi.id, opcoId: uganda.id, role: 'requester' } })

  // Statements run one by one: $executeRawUnsafe takes a single statement.
  for (const stmt of SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(stmt)
  }
}, 120_000)

afterAll(stopTestDb)

describe('self-service requester migration', () => {
  it('turns a pending requester request into an active requester assignment', async () => {
    const db = getTestDb()
    const asg = await db.userOpCoAssignment.findFirst({ where: { user: { email: 'ama@csquared.com' } } })
    expect(asg).toMatchObject({ role: 'requester', isActive: true })
    const ar = await db.accessRequest.findUnique({ where: { id: 'ar-ama' } })
    expect(ar).toMatchObject({ status: 'approved', decidedById: null, decisionReason: 'Auto-approved: requester access is self-service' })
    expect(ar?.decidedAt).toBeInstanceOf(Date)
  })

  it('leaves a pending higher-role request alone', async () => {
    const db = getTestDb()
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-kofi' } })).toMatchObject({ status: 'pending' })
    expect(await db.userOpCoAssignment.count({ where: { user: { email: 'kofi@csquared.com' } } })).toBe(0)
  })

  it('reactivates an ended row as requester, not as its old role', async () => {
    const db = getTestDb()
    const asg = await db.userOpCoAssignment.findFirst({ where: { user: { email: 'esi@csquared.com' } } })
    expect(asg).toMatchObject({ role: 'requester', isActive: true, endedAt: null })
  })
})
```

- [ ] **Step 2: Run and watch it fail.** Docker must be running.
Run: `pnpm vitest run src/test/integration/self-service-requester-migration.test.ts --exclude '.claude/**'`
Expected: FAIL, ENOENT reading migration.sql.

- [ ] **Step 3: Implement** `migration.sql`:

```sql
-- Requester access is self-service from 2026-10-16: grant every pending
-- requester request. Pending requests for higher roles stay in the queue.

-- An active row keeps its role; an ended one comes back as requester.
INSERT INTO "UserOpCoAssignment" ("id", "userId", "opcoId", "role", "isActive", "startedAt")
SELECT 'ssr_' || ar."id", ar."userId", ar."opcoId", 'requester'::"Role", true, now()
FROM "AccessRequest" ar
WHERE ar."status" = 'pending'::"AccessRequestStatus" AND ar."role" = 'requester'::"Role"
ON CONFLICT ("userId", "opcoId") DO UPDATE SET
  "role" = CASE WHEN "UserOpCoAssignment"."isActive" THEN "UserOpCoAssignment"."role" ELSE 'requester'::"Role" END,
  "isActive" = true,
  "endedAt" = NULL;

UPDATE "AccessRequest"
SET "status" = 'approved'::"AccessRequestStatus",
    "decidedAt" = now(),
    "decisionReason" = 'Auto-approved: requester access is self-service'
WHERE "status" = 'pending'::"AccessRequestStatus" AND "role" = 'requester'::"Role";
```

- [ ] **Step 4: Run it.** Expected: 3 PASS. Also run `pnpm vitest run src/test/integration --exclude '.claude/**'`: `prisma migrate deploy` now applies the new migration to an empty database, which must succeed as a no-op.

- [ ] **Step 5: Commit.**

```bash
git add prisma/migrations/20261016120000_self_service_requester src/test/integration/self-service-requester-migration.test.ts
git commit -m "feat(access): migration grants pending requester requests"
```

---

### Task 7: Phase gate and docs

**Files:**
- Modify: `CLAUDE.md` (the Auth paragraph: first sign-in picks an OpCo and becomes requester; higher roles via Profile → Request a role)
- Modify: `README.md` only if it describes the access-request flow (`grep -n "access request\|request-access" README.md`)

- [ ] **Step 1:** `grep -rn "requestAccess\|access.request.title\|access.request.intro" src` returns nothing.
- [ ] **Step 2:** `pnpm test --exclude '.claude/**'` passes in full (Docker running). Record the count.
- [ ] **Step 3:** `pnpm tsc --noEmit` is clean, and `pnpm lint` shows 0 errors with no more than 65 warnings.
- [ ] **Step 4:** Update the CLAUDE.md Auth sentence, then commit `docs: self-service requester access in the auth overview`.
- [ ] **Step 5:** Run the deslop pass over `git diff dev...HEAD` and fix anything it finds that's worth fixing.
- [ ] **Step 6 (after merge to dev):** Playwright smoke on https://csq-cms.vercel.app with a user who has no OpCo role:
  - choose an OpCo and land on the dashboard within one navigation;
  - Profile shows "Request a role"; request approver;
  - a group admin sees it on Role requests and approves;
  - the Approvals nav appears for the user within 60 seconds.
