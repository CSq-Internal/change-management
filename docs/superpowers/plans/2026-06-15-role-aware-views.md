# Role-Aware Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the requests page a role-scoped tabular dashboard (form behind a "New Request" button) and gate the ops dashboard so members get their own requests instead of org-wide stats.

**Architecture:** A single pure `viewerTier()` helper classifies the signed-in user as `group` / `opco` / `member`. A `requestScope()` server helper turns that tier into a Prisma `where` for change requests, shared by the requests table and the dashboard. The requests page becomes a table; the creation form moves to `/requests/new`; the `/changes` list is retired (redirected); members are redirected away from the ops dashboard and the "Dashboard" nav item is hidden for them.

**Tech Stack:** Next.js 16 App Router (server components), Prisma v7, NextAuth v5 session, Zustand UI store, Vitest + React Testing Library, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-06-15-role-aware-views-design.md`

---

## Background the engineer needs

- **Session shape** (`src/types/next-auth.d.ts`): `session.user` has `keycloakId: string`, `realmRoles: string[]` (`"group_admin" | "group_auditor"`), and `organizations: SessionOrganization[]` where each org is `{ id, name, alias, roles: string[] }` and `roles` ∈ `"requester" | "approver" | "auditor" | "admin"`. `alias` equals `OpCo.slug`.
- **Permissions** live in `src/lib/permissions.ts` (pure functions over `organizations` + `realmRoles`). Existing: `isGroupLevel(realmRoles)` = group_admin OR group_auditor; `isGroupAdmin`; `manageableOpCoSlugs(orgs, realmRoles)` returns admin slugs or `"all"`.
- **DB access**: `getPrisma()` from `src/server/db.ts`. Change requests = `db.changeRequest`. A change has `requester` (relation to `User` with `keycloakId`), `opco` (relation with `slug`), `status`, `riskLevel`, `infrastructureType`, `approvals` (relation; an `Approval` has `decision: string` where approve = `"approve"`).
- **Server components** call `auth()` from `@/auth`; redirect with `redirect()` from `next/navigation`.
- **i18n**: every user-visible string goes through `t(language, key)`; keys must be added to BOTH the `en` and `fr` blocks in `src/lib/i18n.ts`.
- **Tests**: `pnpm test <path>` runs one file. `pnpm tsc --noEmit` type-checks. `pnpm lint` lints. Action/lib tests mock `@/server/db` with `vi.mock`. Pure-function tests need no mocks.
- **Commit convention**: short conventional-commit subject. **Never** add `Co-Authored-By` trailers. Stage explicit paths only (never `git add -A`/`.`). Never stage `docs/CSquared-CMS-Project-Workplan.xlsx`.

## File structure

- **Create** `src/server/request-scope.ts` — `requestScope(user)` → Prisma `where`. One responsibility: scoping change-request queries by tier.
- **Modify** `src/lib/permissions.ts` — add pure `viewerTier()` and `requestScopedSlugs()`.
- **Create** `src/app/(dashboard)/requests/new/page.tsx` — the creation-form mount (moved verbatim from the current requests page).
- **Create** `src/app/(dashboard)/requests/requests-table-client.tsx` — the scoped table + filters + New Request button + CSV.
- **Rewrite** `src/app/(dashboard)/requests/page.tsx` — fetch via `requestScope`, render the table.
- **Modify** `src/app/page.tsx` — member redirect + scope dashboard via `requestScope`.
- **Replace** `src/app/(dashboard)/changes/page.tsx` — redirect to `/requests?status=...` (keep `[id]` + `[id]/edit`).
- **Delete** `src/app/(dashboard)/changes/changes-client.tsx` — no longer used.
- **Modify** `src/components/app-shell.tsx` — hide "Dashboard" for members, remove "Changes" nav item, generalize per-item gating.
- **Modify** `src/lib/i18n.ts` — requests-table strings (en + fr).
- **Tests**: `src/test/lib/permissions.test.ts` (extend), `src/test/server/request-scope.test.ts` (new), `src/app/(dashboard)/requests/requests-table-client.test.tsx` (new).

---

### Task 1: `viewerTier` + `requestScopedSlugs` in permissions.ts

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/test/lib/permissions.test.ts` (it already imports `SessionOrganization` and the helpers; mirror its existing `org(...)` style — if no helper exists, inline the objects as below):

```ts
import { viewerTier, requestScopedSlugs } from '@/lib/permissions'

describe('viewerTier', () => {
  const memberOrg = { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }
  const approverOrg = { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }
  const adminOrg = { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] }

  it('group_admin → group', () => {
    expect(viewerTier([memberOrg], ['group_admin'])).toBe('group')
  })
  it('group_auditor → group', () => {
    expect(viewerTier([], ['group_auditor'])).toBe('group')
  })
  it('opco admin → opco', () => {
    expect(viewerTier([adminOrg], [])).toBe('opco')
  })
  it('opco approver → opco', () => {
    expect(viewerTier([approverOrg], [])).toBe('opco')
  })
  it('only requester role → member', () => {
    expect(viewerTier([memberOrg], [])).toBe('member')
  })
  it('no orgs, no realm roles → member', () => {
    expect(viewerTier([], [])).toBe('member')
  })
})

describe('requestScopedSlugs', () => {
  it('returns slugs where the user is admin or approver, deduped', () => {
    const orgs = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['approver'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] },
      { id: 'o3', name: 'Togo', alias: 'togo', roles: ['requester'] },
    ]
    expect(requestScopedSlugs(orgs).sort()).toEqual(['ghana', 'uganda'])
  })
  it('returns [] when the user holds neither role anywhere', () => {
    expect(requestScopedSlugs([{ id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: FAIL — `viewerTier`/`requestScopedSlugs` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/permissions.ts` (it already imports `SessionOrganization` and defines `isGroupLevel`):

```ts
/** OpCo slugs where the user holds an `admin` or `approver` role (deduped). */
export function requestScopedSlugs(organizations: SessionOrganization[]): string[] {
  const slugs = organizations
    .filter((o) => o.roles.includes("admin") || o.roles.includes("approver"))
    .map((o) => o.alias)
  return [...new Set(slugs)]
}

/**
 * Visibility tier for change-request data:
 * - "group"  → group-level (sees all OpCos)
 * - "opco"   → admin/approver in ≥1 OpCo (sees those OpCos)
 * - "member" → everyone else (sees only their own requests)
 */
export function viewerTier(
  organizations: SessionOrganization[],
  realmRoles: string[]
): "group" | "opco" | "member" {
  if (isGroupLevel(realmRoles)) return "group"
  if (requestScopedSlugs(organizations).length > 0) return "opco"
  return "member"
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/lib/permissions.test.ts`
Expected: PASS (all new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/test/lib/permissions.test.ts
git commit -m "feat(permissions): viewerTier + requestScopedSlugs for role-aware scoping"
```

---

### Task 2: `requestScope` server helper

**Files:**
- Create: `src/server/request-scope.ts`
- Test: `src/test/server/request-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/request-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { requestScope } from "@/server/request-scope"

const user = (orgs: { alias: string; roles: string[] }[], realmRoles: string[]) => ({
  keycloakId: "kc-1",
  organizations: orgs.map((o, i) => ({ id: `o${i}`, name: o.alias, alias: o.alias, roles: o.roles })),
  realmRoles,
})

describe("requestScope", () => {
  it("group → empty where (all changes)", () => {
    expect(requestScope(user([], ["group_admin"]))).toEqual({})
  })
  it("opco admin/approver → scoped by opco slug", () => {
    const where = requestScope(user([{ alias: "ghana", roles: ["approver"] }, { alias: "uganda", roles: ["admin"] }], []))
    expect(where).toEqual({ opco: { slug: { in: ["ghana", "uganda"] } } })
  })
  it("member → own requests by requester keycloakId", () => {
    expect(requestScope(user([{ alias: "ghana", roles: ["requester"] }], []))).toEqual({
      requester: { keycloakId: "kc-1" },
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/server/request-scope.test.ts`
Expected: FAIL — module `@/server/request-scope` not found.

- [ ] **Step 3: Implement `requestScope`**

Create `src/server/request-scope.ts`:

```ts
import type { Prisma } from "@prisma/client"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

/**
 * Prisma `where` selecting the change requests a user may browse:
 *   group  → {} (all)
 *   opco   → { opco: { slug: { in: <admin/approver slugs> } } }
 *   member → { requester: { keycloakId } } (own only)
 */
export function requestScope(user: {
  keycloakId: string
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Prisma.ChangeRequestWhereInput {
  const tier = viewerTier(user.organizations, user.realmRoles)
  if (tier === "group") return {}
  if (tier === "opco") return { opco: { slug: { in: requestScopedSlugs(user.organizations) } } }
  return { requester: { keycloakId: user.keycloakId } }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/server/request-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/request-scope.ts src/test/server/request-scope.test.ts
git commit -m "feat(scope): requestScope helper maps viewer tier to a Prisma where"
```

---

### Task 3: Move the creation form to `/requests/new`

This is a verbatim relocation of the *current* `src/app/(dashboard)/requests/page.tsx` (the form + its data fetching) to a new route. The `RequestForm` component and its server actions are unchanged.

**Files:**
- Create: `src/app/(dashboard)/requests/new/page.tsx`

- [ ] **Step 1: Create the new-request route**

Create `src/app/(dashboard)/requests/new/page.tsx` with the exact body of the current requests page (only the file location changes; `RequestForm` is imported from one directory up):

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { OPCO_SLUGS } from "@/lib/opco"
import RequestForm from "../request-form"

export default async function NewRequestPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const opcoOptions = isGroupLevel(session.user.realmRoles)
    ? [...OPCO_SLUGS]
    : session.user.organizations.map((o) => o.alias)

  const opcoRecords = await db.opCo.findMany({
    where: { slug: { in: opcoOptions } },
    select: { id: true, slug: true },
  })
  const groupCtos = (await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    include: { user: { select: { name: true, email: true } } },
  })).map((m) => m.user)

  const opcoCab = await db.cABMembership.findMany({
    where: { opcoId: { in: opcoRecords.map((o) => o.id) }, isActive: true },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversByOpco: Record<string, { name: string | null; email: string }[]> = {}
  for (const o of opcoRecords) approversByOpco[o.slug] = []
  for (const m of opcoCab) {
    if (m.opco) approversByOpco[m.opco.slug]?.push({ name: m.user.name, email: m.user.email })
  }

  return (
    <RequestForm
      opcoOptions={opcoOptions}
      defaultEmail={session.user.email ?? ""}
      groupCtos={groupCtos}
      approversByOpco={approversByOpco}
    />
  )
}
```

Note: the `myRequests` prop is dropped here (the sidebar list moves to the table page). `RequestForm`'s `myRequests` prop is optional (`myRequests?:`), so omitting it is valid — confirm by reading `src/app/(dashboard)/requests/request-form.tsx` line ~59.

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev` (if not running), open `http://localhost:3000/requests/new` while logged in.
Expected: the change-request form renders (no "My Requests" sidebar). On submit it still routes to the change detail (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/requests/new/page.tsx"
git commit -m "feat(requests): mount creation form at /requests/new"
```

---

### Task 4: Requests table client component

A focused client table with single-select native filters (status / risk / infra / OpCo), CSV export (same pattern as `src/components/dashboard/matching-changes-list.tsx`), and a New Request button. Filtering is client-side over the rows passed in. An optional `initialStatus` pre-selects the status filter (used by the `/changes` redirect).

**Files:**
- Create: `src/app/(dashboard)/requests/requests-table-client.tsx`
- Test: `src/app/(dashboard)/requests/requests-table-client.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/requests/requests-table-client.test.tsx`:

```tsx
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import RequestsTableClient, { type RequestRow } from "./requests-table-client"

const rows: RequestRow[] = [
  { id: "c1", title: "Core router upgrade", status: "pending", riskLevel: "high", infrastructureType: "Backbone IP Network", opcoName: "Ghana", approvalsGiven: 1, requesterName: "Ada" },
  { id: "c2", title: "Wifi patch", status: "approved", riskLevel: "medium", infrastructureType: "Wifi", opcoName: "Ghana", approvalsGiven: 2, requesterName: "Bob" },
]

describe("RequestsTableClient", () => {
  it("renders rows and a New Request link", () => {
    render(<RequestsTableClient rows={rows} showRequester />)
    expect(screen.getByText("Core router upgrade")).toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /New Request/i })).toHaveAttribute("href", "/requests/new")
  })

  it("filters by status", () => {
    render(<RequestsTableClient rows={rows} showRequester />)
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } })
    expect(screen.queryByText("Core router upgrade")).not.toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
  })

  it("honors initialStatus", () => {
    render(<RequestsTableClient rows={rows} showRequester initialStatus="approved" />)
    expect(screen.queryByText("Core router upgrade")).not.toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
  })

  it("shows the empty state when nothing matches", () => {
    render(<RequestsTableClient rows={[]} showRequester />)
    expect(screen.getByText(/No requests/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test "src/app/(dashboard)/requests/requests-table-client.test.tsx"`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `src/app/(dashboard)/requests/requests-table-client.tsx`:

```tsx
"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { StatusPill, RiskPill } from "@/components/change-badges"

export type RequestRow = {
  id: string
  title: string
  status: string
  riskLevel: string
  infrastructureType: string
  opcoName: string
  approvalsGiven: number
  requesterName: string
}

const STATUSES = ["draft", "pending", "approved", "implemented", "verified", "rejected", "closed"]
const RISKS = ["low", "medium", "high", "emergency"]

function csvEscape(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function RequestsTableClient({
  rows, showRequester, initialStatus = "",
}: {
  rows: RequestRow[]
  showRequester: boolean
  initialStatus?: string
}) {
  const { language } = useStore()
  const [status, setStatus] = useState(initialStatus)
  const [risk, setRisk] = useState("")
  const [infra, setInfra] = useState("")
  const [opco, setOpco] = useState("")

  const infraOptions = useMemo(() => [...new Set(rows.map((r) => r.infrastructureType))].sort(), [rows])
  const opcoOptions = useMemo(() => [...new Set(rows.map((r) => r.opcoName))].sort(), [rows])

  const filtered = useMemo(
    () => rows.filter((r) =>
      (!status || r.status === status) &&
      (!risk || r.riskLevel === risk) &&
      (!infra || r.infrastructureType === infra) &&
      (!opco || r.opcoName === opco)
    ),
    [rows, status, risk, infra, opco]
  )

  const exportCsv = () => {
    const header = ["Title", "Status", "Risk", "Infrastructure", "OpCo", "Approvals", "Requester"]
    const lines = [header.join(",")].concat(
      filtered.map((r) =>
        [r.title, r.status, r.riskLevel, r.infrastructureType, r.opcoName, String(r.approvalsGiven), r.requesterName]
          .map(csvEscape).join(",")
      )
    )
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `requests-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{t(language, "requests.pageTitle")}</h1>
        <Button asChild>
          <Link href="/requests/new"><Plus className="mr-1.5 h-4 w-4" />{t(language, "requests.new")}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t(language, "requests.filter.allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Risk" className={selectClass} value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">{t(language, "requests.filter.allRisks")}</option>
          {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Infrastructure" className={selectClass} value={infra} onChange={(e) => setInfra(e.target.value)}>
          <option value="">{t(language, "requests.filter.allInfra")}</option>
          {infraOptions.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select aria-label="OpCo" className={selectClass} value={opco} onChange={(e) => setOpco(e.target.value)}>
          <option value="">{t(language, "requests.filter.allOpcos")}</option>
          {opcoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} / {rows.length}</span>
        <Button variant="outline" onClick={exportCsv}>{t(language, "requests.exportCsv")}</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t(language, "requests.col.title")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.status")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.risk")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.infra")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.opco")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.approvals")}</th>
              {showRequester && <th className="px-3 py-2">{t(language, "requests.col.requester")}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link href={`/changes/${r.id}`} className="text-primary hover:underline">{r.title}</Link>
                </td>
                <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                <td className="px-3 py-2"><RiskPill risk={r.riskLevel} /></td>
                <td className="px-3 py-2">{r.infrastructureType}</td>
                <td className="px-3 py-2">{r.opcoName}</td>
                <td className="px-3 py-2 tabular-nums">{r.approvalsGiven > 0 ? `${r.approvalsGiven} ✓` : "—"}</td>
                {showRequester && <td className="px-3 py-2">{r.requesterName}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t(language, "requests.none")}</p>
        )}
      </div>
    </div>
  )
}
```

Note: confirm `StatusPill` and `RiskPill` are exported from `src/components/change-badges.tsx` (they are used in `request-form.tsx` and `triage-view.tsx`). Confirm `Button` supports `asChild` (shadcn button); if not, replace the New Request `<Button asChild><Link/></Button>` with a plain `<Link>` styled with the button classes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test "src/app/(dashboard)/requests/requests-table-client.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/requests/requests-table-client.tsx" "src/app/(dashboard)/requests/requests-table-client.test.tsx"
git commit -m "feat(requests): scoped requests table client with filters + CSV"
```

---

### Task 5: Rewrite `/requests` to the scoped table

**Files:**
- Modify (rewrite): `src/app/(dashboard)/requests/page.tsx`

- [ ] **Step 1: Replace the page body**

Replace the entire contents of `src/app/(dashboard)/requests/page.tsx` with:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { viewerTier } from "@/lib/permissions"
import { requestScope } from "@/server/request-scope"
import RequestsTableClient, { type RequestRow } from "./requests-table-client"

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const tier = viewerTier(session.user.organizations, session.user.realmRoles)
  const where = requestScope(session.user)

  const changes = await db.changeRequest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, status: true, riskLevel: true, infrastructureType: true,
      opco: { select: { name: true } },
      requester: { select: { name: true, email: true } },
      approvals: { select: { decision: true } },
    },
  })

  const rows: RequestRow[] = changes.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    riskLevel: c.riskLevel,
    infrastructureType: c.infrastructureType,
    opcoName: c.opco?.name ?? "—",
    approvalsGiven: c.approvals.filter((a) => a.decision === "approve").length,
    requesterName: c.requester?.name ?? c.requester?.email ?? "—",
  }))

  const { status } = await searchParams
  // The /changes redirect passes a comma list; the table filters by a single value,
  // so use the first as the initial selection (sufficient for the retired-list case).
  const initialStatus = status?.split(",")[0] ?? ""

  return <RequestsTableClient rows={rows} showRequester={tier !== "member"} initialStatus={initialStatus} />
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean. (`searchParams` is a Promise in Next 16 — it is awaited above.)

- [ ] **Step 3: Verify live**

With `pnpm dev` running and logged in as the admin (`devops@csquared.com`), open `/requests`.
Expected: a table of change requests (all, since admin) with filters, a "New Request" button, a Requester column. Selecting a status filter narrows rows. As a member, only their own requests would show and the Requester column is hidden.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/requests/page.tsx"
git commit -m "feat(requests): /requests is now the scoped requests table"
```

---

### Task 6: Retire the `/changes` list (redirect)

Keep `/changes/[id]` and `/changes/[id]/edit`. Only the list index `/changes` is replaced with a redirect, and its now-unused client is deleted.

**Files:**
- Replace: `src/app/(dashboard)/changes/page.tsx`
- Delete: `src/app/(dashboard)/changes/changes-client.tsx`

- [ ] **Step 1: Replace the list page with a redirect**

Replace the entire contents of `src/app/(dashboard)/changes/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

// The standalone changes list is retired; its approved/implemented/verified view is
// now a status filter on the requests table. Preserve old links.
export default function ChangesIndex() {
  redirect("/requests?status=approved,implemented,verified")
}
```

- [ ] **Step 2: Delete the unused client**

```bash
git rm "src/app/(dashboard)/changes/changes-client.tsx"
```

- [ ] **Step 3: Type-check (catches stray imports of the deleted client)**

Run: `pnpm tsc --noEmit`
Expected: clean. If `tsc` flags a stale reference under `.next/types`, clear it: `rm -rf .next/types .next/dev/types` and re-run.

- [ ] **Step 4: Verify live**

Open `/changes` → should redirect to `/requests?status=approved,...` with the status filter pre-applied. `/changes/<id>` for an existing change still renders the detail.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/changes/page.tsx"
git commit -m "refactor(changes): retire the changes list, redirect to the requests table"
```

---

### Task 7: Dashboard — member redirect + scoped via `requestScope`

The dashboard currently scopes by `isGroupLevel ? {} : { opco: { slug: { in: <all member opcos> } } }`. Switch it to: redirect members to `/requests`, and scope the change + audit queries via `requestScope` so OpCo admins see their *managed* OpCos (admin/approver), not merely any membership.

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the member redirect and tier-based scoping**

In `src/app/page.tsx`, the top currently reads (around lines 22-34):

```tsx
  const db = getPrisma()
  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const now = Date.now()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  // Fire-and-forget SLA escalation sweep — never block render.
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})
```

Replace that block with (note the new `viewerTier`/`requestScope` imports and `requestScopedSlugs`):

```tsx
  const db = getPrisma()
  // Members have no ops dashboard — send them to their requests.
  const tier = viewerTier(session.user.organizations, session.user.realmRoles)
  if (tier === "member") redirect("/requests")

  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const now = Date.now()
  const groupLevel = tier === "group"
  // Managed OpCos for an OpCo admin/approver (admin OR approver); group sees all.
  const opcoSlugs = groupLevel ? [] : requestScopedSlugs(session.user.organizations)
  const opcoFilter = requestScope(session.user)

  // Fire-and-forget SLA escalation sweep — never block render.
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})
```

Then update the imports at the top of the file. The file currently has:

```tsx
import { isGroupLevel } from "@/lib/permissions"
```

Replace with:

```tsx
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import { requestScope } from "@/server/request-scope"
```

(`redirect` is already imported from `next/navigation` at the top of the file.)

- [ ] **Step 2: Confirm downstream uses still hold**

The existing `opcoFilter` is used as the `where` for the changes query (`db.changeRequest.findMany({ where: opcoFilter, ... })`) and the audit query (`where: { change: opcoFilter }`). `requestScope` returns the same *shape* (`ChangeRequestWhereInput`), so both remain valid. The blackout query uses `opcoSlugs` for its `OR` filter — for the `group` tier `opcoSlugs` is now `[]` but `groupLevel` short-circuits that branch (`groupLevel ? {} : {...}`), so behavior is unchanged for group; for the opco tier `opcoSlugs` now holds the managed slugs, which is correct. Read lines ~36-56 of `src/app/page.tsx` to confirm these three call sites.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify live**

- As admin (`devops@csquared.com`): `/` still renders the ops dashboard, scoped to managed OpCos.
- A pure member (a user whose only org role is `requester`) hitting `/` should redirect to `/requests`. (If no such seeded user exists, this is covered by the redirect path in Step 1; verify the logic by reading, and rely on Task 8's nav-hiding for the member UX.)

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): redirect members to /requests; scope ops view via requestScope"
```

---

### Task 8: Nav — hide Dashboard for members, drop Changes

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Remove the Changes nav item and gate Dashboard**

In `src/components/app-shell.tsx`, the Core nav group (around lines 53-60) reads:

```tsx
  {
    labelKey: "nav.core",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: BarChart3, tour: "nav-dashboard" },
      { href: "/requests", labelKey: "nav.requests", icon: ClipboardList, tour: "nav-requests" },
      { href: "/approvals", labelKey: "nav.approvals", icon: ShieldCheck, tour: "nav-approvals" },
      { href: "/changes", labelKey: "nav.changes", icon: GitCompare, tour: "nav-changes" },
      { href: "/audits", labelKey: "nav.audits", icon: FileClock },
    ],
  },
```

Replace with (Dashboard gets `gate: "dashboard"`; the Changes item is removed):

```tsx
  {
    labelKey: "nav.core",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: BarChart3, gate: "dashboard", tour: "nav-dashboard" },
      { href: "/requests", labelKey: "nav.requests", icon: ClipboardList, tour: "nav-requests" },
      { href: "/approvals", labelKey: "nav.approvals", icon: ShieldCheck, tour: "nav-approvals" },
      { href: "/audits", labelKey: "nav.audits", icon: FileClock },
    ],
  },
```

`GitCompare` may now be an unused import — remove it from the `lucide-react` import line if so (tsc/lint will flag it).

- [ ] **Step 2: Teach the gate about "dashboard" and apply gating to all groups**

In `src/components/app-shell.tsx`, `itemAllowed` (around lines 124-129) reads:

```tsx
  const itemAllowed = (gate?: string) => {
    if (gate === "groupAdmin") return groupAdmin
    if (gate === "adminOrAudit") return anyAdmin || groupLevel
    if (gate === "admin") return anyAdmin
    return true
  }
```

Add the dashboard tier (members excluded). Members = not group-level and no admin/approver role; the simplest available signal is `anyAdmin || groupLevel` plus approver. Compute an `anyApprover` near the other role flags (around line 120, after `groupLevel`):

```tsx
  const anyApprover = session ? session.user.organizations.some((o) => o.roles.includes("approver")) : false
```

Then extend `itemAllowed`:

```tsx
  const itemAllowed = (gate?: string) => {
    if (gate === "groupAdmin") return groupAdmin
    if (gate === "adminOrAudit") return anyAdmin || groupLevel
    if (gate === "admin") return anyAdmin
    if (gate === "dashboard") return anyAdmin || groupLevel || anyApprover
    return true
  }
```

Now `effectiveNavGroups` (around lines 132-141) only filters items inside the `nav.userManagement` group. Generalize it to filter every group's items by `itemAllowed`:

```tsx
  const effectiveNavGroups = useMemo(
    () =>
      navGroups
        .filter((group) => group.labelKey !== "nav.userManagement" || showAdminGroup)
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => itemAllowed((item as { gate?: string }).gate)),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAdminGroup, anyAdmin, groupAdmin, groupLevel, anyApprover]
  )
```

(Items without a `gate` return `true` from `itemAllowed`, so non-gated items in every group are unaffected.)

- [ ] **Step 3: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: tsc clean; lint 0 errors (remove `GitCompare` import if flagged as unused).

- [ ] **Step 4: Verify live**

- Admin: sidebar shows Dashboard, Requests, Approvals, Audits (no Changes).
- A member (requester-only) would not see the Dashboard item; their nav starts at Requests.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(nav): hide Dashboard from members, remove retired Changes item"
```

---

### Task 9: i18n strings + full verification

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the requests-table keys (en + fr)**

In `src/lib/i18n.ts`, add these keys to BOTH the English and French maps (find the existing `requests.*` block; place alongside it). English values:

```ts
"requests.pageTitle": "Change Requests",
"requests.new": "New Request",
"requests.exportCsv": "Export CSV",
"requests.none": "No requests match.",
"requests.filter.allStatuses": "All statuses",
"requests.filter.allRisks": "All risks",
"requests.filter.allInfra": "All infrastructure",
"requests.filter.allOpcos": "All OpCos",
"requests.col.title": "Title",
"requests.col.status": "Status",
"requests.col.risk": "Risk",
"requests.col.infra": "Infrastructure",
"requests.col.opco": "OpCo",
"requests.col.approvals": "Approvals",
"requests.col.requester": "Requester",
```

French values:

```ts
"requests.pageTitle": "Demandes de changement",
"requests.new": "Nouvelle demande",
"requests.exportCsv": "Exporter CSV",
"requests.none": "Aucune demande correspondante.",
"requests.filter.allStatuses": "Tous les statuts",
"requests.filter.allRisks": "Tous les risques",
"requests.filter.allInfra": "Toutes les infrastructures",
"requests.filter.allOpcos": "Tous les OpCo",
"requests.col.title": "Titre",
"requests.col.status": "Statut",
"requests.col.risk": "Risque",
"requests.col.infra": "Infrastructure",
"requests.col.opco": "OpCo",
"requests.col.approvals": "Approbations",
"requests.col.requester": "Demandeur",
```

Note: `nav.changes` is now unused but leave the key in place (removing it is unrelated cleanup; an unused i18n key is harmless).

- [ ] **Step 2: Full verification**

Run each and confirm:

```bash
pnpm tsc --noEmit          # clean
pnpm lint                  # 0 errors
pnpm test                  # all pass (incl. new permissions/request-scope/table tests)
```

Expected: tsc clean, lint 0 errors, all tests green.

- [ ] **Step 3: Live smoke (admin + member if available)**

With `pnpm dev` and the local stack up (see `CLAUDE.md` / the local-dev-stack runbook):
- `/requests` → table renders, filters work, New Request → `/requests/new` form, submit still works.
- `/changes` → redirects to the filtered requests table.
- `/` as admin → ops dashboard (scoped). Toggle FR in Preferences → table headers/buttons translate, no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "i18n: requests table strings (en + fr)"
```

---

## Notes / deviations from the spec

- **Approvals column:** the spec mockup showed `1/2` (given vs. required). Computing the *required* denominator per row needs the routing + CAB-quorum engine for every change (per-change queries, and overrides complicate it). To keep the list query O(1) and avoid a misleading denominator, this plan renders **approvals given** (`N ✓`, or `—`), with the authoritative state in the Status column. A precise `given/required` denominator can be added later as an enhancement if wanted.
- **Filters** are single-select native `<select>`s (not the dashboard's multi-select), to keep the table self-contained. Can be upgraded to the `multi-select` primitive later.
- **Planned-start column** from the spec's column sketch is omitted to keep the table compact; status/risk/approvals are the triage signals and the planned dates are on the detail page. Add a column later if admins want it in-list.
- **`/changes` redirect** passes a comma status list; the single-select table uses the first value. This is sufficient for the retired-list case (all three are post-approval states; "approved" as the landing filter is reasonable). Revisit if multi-status filtering is needed.
