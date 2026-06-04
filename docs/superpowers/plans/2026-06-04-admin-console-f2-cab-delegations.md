# Admin Console — Plan F2: CAB + Delegations UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the CAB and Delegations admin pages, wired to the `cab.ts` / `delegations.ts` server actions, using the shared surface template (table + modal dialogs) established in F1, plus a `listOpCoApprovers` picker helper.

**Architecture:** Each page is a server component that reads scope + the `csq-active-opco` cookie, queries Prisma (scoped to manageable OpCos), and passes plain props to a client container that renders tables and modal dialogs calling server actions + `router.refresh()`. CAB has Per-OpCo / Group tabs. Add/create dialogs fetch approver-eligible users on demand via `listOpCoApprovers`. Components are verified with React Testing Library render smoke tests (mocked props/actions).

**Tech Stack:** Next.js App Router (RSC + server actions), NextAuth, Prisma v7, shadcn/ui (`Button`, `Card`, `Input`), Vitest + React Testing Library.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-console-ui-design.md` (Plan F, phase F2).

**Depends on:** Plans A–E (`cab.ts`: `addCabMember`/`removeCabMember`/`listCabMembers`; `delegations.ts`: `createDelegation`/`revokeDelegation`/`listDelegations`; `recordAdminAction`), and F1 (the surface template + `confirm-dialog`). Branch: `feat/admin-governance-opco-lifecycle` (already holds D+E+F1).

**Schema facts this plan relies on:** `CABMembership` has `user` and nullable `opco` relations. `ApproverDelegation` has `fromUser`/`toUser` relations but **no `opco` relation** (only an `opcoId` column) — so the Delegations page scopes by resolving managed OpCo ids first, then mapping `opcoId` → OpCo for display (same approach F1 used for team members).

---

## File Structure

- `src/components/app-shell.tsx` — add `/cab` and `/delegations` items to the `nav.userManagement` (Administration) group.
- `src/lib/i18n.ts` — add `nav.cab`, `nav.delegations`, `cabAdmin.*`, `delegationsAdmin.*` (en + fr).
- `src/server/actions/users.ts` — add `listOpCoApprovers(opcoSlug | null)` read action.
- `src/app/(dashboard)/cab/` — **new**: `page.tsx`, `types.ts`, `cab-client.tsx`, `cab-table.tsx`, `cab-add-dialog.tsx`.
- `src/app/(dashboard)/delegations/` — **new**: `page.tsx`, `types.ts`, `delegations-client.tsx`, `delegation-list.tsx`, `delegation-create-dialog.tsx`.
- Reuse: `src/app/(dashboard)/users/confirm-dialog.tsx`.
- Tests: `src/test/actions/users-authz.test.ts` (extend), and smoke tests under `src/test/app/cab/` and `src/test/app/delegations/`.

---

## Task 1: Nav items + i18n keys

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the nav items**

In `src/components/app-shell.tsx`, find the icon import from `lucide-react` and add two icons to it: `Gavel` and `ArrowLeftRight`.

Then change the `nav.userManagement` group's `items` array to:

```tsx
    items: [
      { href: "/users", labelKey: "nav.users", icon: Users },
      { href: "/teams", labelKey: "nav.teams", icon: UsersRound },
      { href: "/cab", labelKey: "nav.cab", icon: Gavel },
      { href: "/delegations", labelKey: "nav.delegations", icon: ArrowLeftRight },
    ],
```

- [ ] **Step 2: Add i18n keys (English)**

In `src/lib/i18n.ts`, in the English map after `"nav.teams": "Teams",` (and the `teamsAdmin.*` block), add:

```ts
    "nav.cab": "CAB",
    "nav.delegations": "Delegations",
    "cabAdmin.title": "Change Advisory Board",
    "cabAdmin.desc": "Manage who sits on each OpCo's CAB and the group CAB.",
    "cabAdmin.tabPerOpco": "Per-OpCo",
    "cabAdmin.tabGroup": "Group CAB",
    "cabAdmin.add": "Add member",
    "cabAdmin.colMember": "Member",
    "cabAdmin.colOpco": "OpCo",
    "cabAdmin.colApproverIn": "Approver in",
    "cabAdmin.remove": "Remove",
    "cabAdmin.none": "No CAB members yet.",
    "cabAdmin.addTitle": "Add CAB member",
    "cabAdmin.pick": "Eligible approvers",
    "cabAdmin.pickHint": "Only users with the approver role are listed.",
    "cabAdmin.cancel": "Cancel",
    "cabAdmin.removeTitle": "Remove CAB member?",
    "cabAdmin.removeBody": "This removes the user from the board. They can be re-added later.",
    "cabAdmin.added": "Member added",
    "cabAdmin.removed": "Member removed",
    "cabAdmin.failed": "Action failed",
    "delegationsAdmin.title": "Approver Delegations",
    "delegationsAdmin.desc": "Temporarily hand an approver's rights to another approver.",
    "delegationsAdmin.new": "New delegation",
    "delegationsAdmin.colFrom": "From",
    "delegationsAdmin.colTo": "To",
    "delegationsAdmin.colOpco": "OpCo",
    "delegationsAdmin.colUntil": "Valid until",
    "delegationsAdmin.revoke": "Revoke",
    "delegationsAdmin.none": "No active delegations.",
    "delegationsAdmin.createTitle": "Create delegation",
    "delegationsAdmin.fieldOpco": "OpCo",
    "delegationsAdmin.fieldFrom": "Delegator (approver)",
    "delegationsAdmin.fieldTo": "Delegatee (approver)",
    "delegationsAdmin.fieldUntil": "Valid until",
    "delegationsAdmin.save": "Create",
    "delegationsAdmin.cancel": "Cancel",
    "delegationsAdmin.revokeTitle": "Revoke delegation?",
    "delegationsAdmin.revokeBody": "This ends the delegation immediately.",
    "delegationsAdmin.created": "Delegation created",
    "delegationsAdmin.revoked": "Delegation revoked",
    "delegationsAdmin.failed": "Action failed",
```

- [ ] **Step 3: Add i18n keys (French)**

In the French map after `"nav.teams": "Equipes",` (and its `teamsAdmin.*` block), add:

```ts
    "nav.cab": "CAB",
    "nav.delegations": "Délégations",
    "cabAdmin.title": "Comité consultatif (CAB)",
    "cabAdmin.desc": "Gérez les membres du CAB de chaque OpCo et du CAB de groupe.",
    "cabAdmin.tabPerOpco": "Par OpCo",
    "cabAdmin.tabGroup": "CAB de groupe",
    "cabAdmin.add": "Ajouter un membre",
    "cabAdmin.colMember": "Membre",
    "cabAdmin.colOpco": "OpCo",
    "cabAdmin.colApproverIn": "Approbateur dans",
    "cabAdmin.remove": "Retirer",
    "cabAdmin.none": "Aucun membre du CAB.",
    "cabAdmin.addTitle": "Ajouter un membre du CAB",
    "cabAdmin.pick": "Approbateurs éligibles",
    "cabAdmin.pickHint": "Seuls les utilisateurs ayant le rôle approbateur sont listés.",
    "cabAdmin.cancel": "Annuler",
    "cabAdmin.removeTitle": "Retirer le membre du CAB ?",
    "cabAdmin.removeBody": "Ceci retire l'utilisateur du comité. Il pourra être rajouté.",
    "cabAdmin.added": "Membre ajouté",
    "cabAdmin.removed": "Membre retiré",
    "cabAdmin.failed": "Échec de l'action",
    "delegationsAdmin.title": "Délégations d'approbateur",
    "delegationsAdmin.desc": "Transférez temporairement les droits d'un approbateur à un autre.",
    "delegationsAdmin.new": "Nouvelle délégation",
    "delegationsAdmin.colFrom": "De",
    "delegationsAdmin.colTo": "À",
    "delegationsAdmin.colOpco": "OpCo",
    "delegationsAdmin.colUntil": "Valable jusqu'au",
    "delegationsAdmin.revoke": "Révoquer",
    "delegationsAdmin.none": "Aucune délégation active.",
    "delegationsAdmin.createTitle": "Créer une délégation",
    "delegationsAdmin.fieldOpco": "OpCo",
    "delegationsAdmin.fieldFrom": "Délégant (approbateur)",
    "delegationsAdmin.fieldTo": "Délégataire (approbateur)",
    "delegationsAdmin.fieldUntil": "Valable jusqu'au",
    "delegationsAdmin.save": "Créer",
    "delegationsAdmin.cancel": "Annuler",
    "delegationsAdmin.revokeTitle": "Révoquer la délégation ?",
    "delegationsAdmin.revokeBody": "Ceci met fin à la délégation immédiatement.",
    "delegationsAdmin.created": "Délégation créée",
    "delegationsAdmin.revoked": "Délégation révoquée",
    "delegationsAdmin.failed": "Échec de l'action",
```

- [ ] **Step 4: Type-check + dashboard smoke**

Run: `pnpm tsc --noEmit && pnpm vitest run src/app/dashboard-client.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell.tsx src/lib/i18n.ts
git commit -m "feat(admin-ui): add CAB + Delegations nav items and i18n keys"
```

---

## Task 2: `listOpCoApprovers` read action

Returns active `approver` users in an OpCo (or any OpCo when `opcoSlug` is null, for the group CAB). Authorized: per-OpCo → `canManageUsers`; group → `isGroupAdmin`.

**Files:**
- Modify: `src/server/actions/users.ts`
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Add the failing tests**

In `src/test/actions/users-authz.test.ts`, add a `findMany` returning approver rows to the existing `mockDb.userOpCoAssignment` object (it currently has `create/updateMany/findMany/count/upsert/update` — set the `findMany` default used by this suite inside the new describe with `mockResolvedValueOnce`). Extend the import to include `listOpCoApprovers`. Append:

```ts
describe("listOpCoApprovers", () => {
  it("rejects a non-admin for a per-OpCo request", async () => {
    await expect(listOpCoApprovers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a non-group_admin for a group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(listOpCoApprovers(null)).rejects.toThrow(/Forbidden/)
  })

  it("returns approver users for an OpCo admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { user: { id: "u1", name: "Ada", email: "ada@csquared.com" } },
    ])
    const approvers = await listOpCoApprovers("ghana")
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: "approver", isActive: true, opco: { slug: "ghana" } },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
    expect(approvers).toEqual([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
  })

  it("queries across all OpCos for a group_admin group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    await listOpCoApprovers(null)
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: "approver", isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts -t listOpCoApprovers`
Expected: FAIL — `listOpCoApprovers is not a function`.

- [ ] **Step 3: Implement**

Append to `src/server/actions/users.ts` (it already imports `getAppSession`, `getPrisma`, `isGroupAdmin`, `canManageUsers`):

```ts
export async function listOpCoApprovers(opcoSlug: string | null) {
  const session = await getAppSession()
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can list group approvers")
    }
  } else if (!canManageUsers(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot list approvers in ${opcoSlug}`)
  }

  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { role: "approver", isActive: true, ...(opcoSlug ? { opco: { slug: opcoSlug } } : {}) },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}
```

- [ ] **Step 4: Run green**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts`
Expected: PASS (existing + 4 new). Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(users): add listOpCoApprovers read action for CAB/delegation pickers"
```

---

## Task 3: CAB components (types, table, add dialog)

**Files:**
- Create: `src/app/(dashboard)/cab/types.ts`
- Create: `src/app/(dashboard)/cab/cab-table.tsx`
- Create: `src/app/(dashboard)/cab/cab-add-dialog.tsx`
- Test: `src/test/app/cab/cab-table.test.tsx`, `src/test/app/cab/cab-add-dialog.test.tsx`

- [ ] **Step 1: Create the types**

Create `src/app/(dashboard)/cab/types.ts`:

```ts
export type CabMember = {
  id: string
  userId: string
  name: string | null
  email: string
  opco: { name: string; slug: string } | null // null = group CAB
}
```

- [ ] **Step 2: Write the failing smoke tests**

Create `src/test/app/cab/cab-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import CabTable from "@/app/(dashboard)/cab/cab-table"
import type { CabMember } from "@/app/(dashboard)/cab/types"

const members: CabMember[] = [
  { id: "c1", userId: "u1", name: "Ada", email: "ada@csquared.com", opco: { name: "Ghana", slug: "ghana" } },
]

describe("CabTable", () => {
  it("renders members with the OpCo column", () => {
    render(<CabTable members={members} language="en" showOpco onRemove={vi.fn()} />)
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<CabTable members={[]} language="en" showOpco={false} onRemove={vi.fn()} />)
    expect(screen.getByText("No CAB members yet.")).toBeInTheDocument()
  })
})
```

Create `src/test/app/cab/cab-add-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/cab", () => ({ addCabMember: vi.fn().mockResolvedValue({}) }))
vi.mock("@/server/actions/users", () => ({ listOpCoApprovers: vi.fn().mockResolvedValue([]) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import CabAddDialog from "@/app/(dashboard)/cab/cab-add-dialog"

describe("CabAddDialog", () => {
  it("renders the add dialog title and hint", () => {
    render(
      <CabAddDialog language="en" opcoSlug="ghana" existingUserIds={[]} onClose={vi.fn()} onAdded={vi.fn()} />
    )
    expect(screen.getByText("Add CAB member")).toBeInTheDocument()
    expect(screen.getByText("Only users with the approver role are listed.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run red**

Run: `pnpm vitest run src/test/app/cab/`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `cab-table.tsx`**

Create `src/app/(dashboard)/cab/cab-table.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { CabMember } from "./types"

interface CabTableProps {
  members: CabMember[]
  language: Language
  showOpco: boolean
  onRemove: (member: CabMember) => void
}

export default function CabTable({ members, language, showOpco, onRemove }: CabTableProps) {
  if (members.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "cabAdmin.none")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">{t(language, "cabAdmin.colMember")}</th>
              {showOpco && <th className="px-4 py-2">{t(language, "cabAdmin.colOpco")}</th>}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/40">
                <td className="px-4 py-2">{m.email}</td>
                {showOpco && <td className="px-4 py-2">{m.opco?.slug ?? "—"}</td>}
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => onRemove(m)}>
                      {t(language, "cabAdmin.remove")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Implement `cab-add-dialog.tsx`**

Create `src/app/(dashboard)/cab/cab-add-dialog.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { addCabMember } from "@/server/actions/cab"
import { listOpCoApprovers } from "@/server/actions/users"

type Approver = { id: string; name: string | null; email: string }

interface CabAddDialogProps {
  language: Language
  opcoSlug: string | null // null = group CAB
  existingUserIds: string[]
  onClose: () => void
  onAdded: () => void
}

export default function CabAddDialog({ language, opcoSlug, existingUserIds, onClose, onAdded }: CabAddDialogProps) {
  const { toast } = useToast()
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    listOpCoApprovers(opcoSlug).then(setApprovers).catch(() => setApprovers([]))
  }, [opcoSlug])

  const existing = new Set(existingUserIds)
  const addable = approvers.filter((a) => !existing.has(a.id))

  const add = async (userId: string) => {
    setPending(true)
    try {
      await addCabMember(userId, opcoSlug)
      toast({ title: t(language, "cabAdmin.added"), variant: "success" })
      onAdded()
    } catch (err) {
      toast({ title: t(language, "cabAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "cabAdmin.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">{t(language, "cabAdmin.pick")}</div>
          <div className="space-y-1">
            {addable.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-border/40 px-3 py-1.5 text-sm">
                <span>{a.email}</span>
                <Button variant="outline" onClick={() => add(a.id)} disabled={pending}>
                  {t(language, "cabAdmin.add")}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t(language, "cabAdmin.pickHint")}</p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t(language, "cabAdmin.cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Run green**

Run: `pnpm vitest run src/test/app/cab/`
Expected: PASS (3 cases). Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/cab/types.ts" "src/app/(dashboard)/cab/cab-table.tsx" "src/app/(dashboard)/cab/cab-add-dialog.tsx" src/test/app/cab/
git commit -m "feat(cab-ui): add CAB table + add-member dialog components"
```

---

## Task 4: CAB page + container

**Files:**
- Create: `src/app/(dashboard)/cab/page.tsx`
- Create: `src/app/(dashboard)/cab/cab-client.tsx`

- [ ] **Step 1: Create the server component**

Create `src/app/(dashboard)/cab/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs, isGroupLevel } from "@/lib/permissions"
import CabClient from "./cab-client"
import type { CabMember } from "./types"

export default async function CabPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }

  const db = getPrisma()
  const perOpcoRows = await db.cABMembership.findMany({
    where: { isActive: true, opcoId: { not: null }, ...(slugFilter ? { opco: { slug: slugFilter } } : {}) },
    include: { user: { select: { id: true, name: true, email: true } }, opco: { select: { name: true, slug: true } } },
  })

  const showGroup = isGroupLevel(session.user.realmRoles)
  const groupRows = showGroup
    ? await db.cABMembership.findMany({
        where: { isActive: true, opcoId: null },
        include: { user: { select: { id: true, name: true, email: true } } },
      })
    : []

  const perOpco: CabMember[] = perOpcoRows.map((r) => ({
    id: r.id, userId: r.userId, name: r.user.name, email: r.user.email,
    opco: r.opco ? { name: r.opco.name, slug: r.opco.slug } : null,
  }))
  const group: CabMember[] = groupRows.map((r) => ({
    id: r.id, userId: r.userId, name: r.user.name, email: r.user.email, opco: null,
  }))

  return <CabClient perOpco={perOpco} group={group} showGroup={showGroup} />
}
```

- [ ] **Step 2: Create the client container**

Create `src/app/(dashboard)/cab/cab-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { removeCabMember } from "@/server/actions/cab"
import ConfirmDialog from "../users/confirm-dialog"
import CabTable from "./cab-table"
import CabAddDialog from "./cab-add-dialog"
import type { CabMember } from "./types"

interface CabClientProps {
  perOpco: CabMember[]
  group: CabMember[]
  showGroup: boolean
}

export default function CabClient({ perOpco, group, showGroup }: CabClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles) : false
  const scope = session ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles) : []
  // A specific managed OpCo for "+ Add" in the Per-OpCo tab: prefer the one present in the data, else the first managed slug.
  const perOpcoSlug =
    perOpco[0]?.opco?.slug ?? (scope === "all" ? undefined : scope[0])

  const [tab, setTab] = useState<"perOpco" | "group">("perOpco")
  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<CabMember | null>(null)
  const [pending, setPending] = useState(false)

  const activeMembers = tab === "group" ? group : perOpco
  const addSlug = tab === "group" ? null : perOpcoSlug ?? null

  const refresh = () => router.refresh()

  const handleRemove = async () => {
    if (!confirm) return
    setPending(true)
    try {
      await removeCabMember(confirm.userId, confirm.opco?.slug ?? null)
      toast({ title: t(language, "cabAdmin.removed"), description: confirm.email, variant: "success" })
      setConfirm(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "cabAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "cabAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "cabAdmin.desc")}</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          disabled={!isAdmin || (tab === "perOpco" && !addSlug)}
        >
          {t(language, "cabAdmin.add")}
        </Button>
      </div>

      <div className="flex gap-2 text-sm">
        <Button variant={tab === "perOpco" ? "default" : "outline"} onClick={() => setTab("perOpco")}>
          {t(language, "cabAdmin.tabPerOpco")}
        </Button>
        {showGroup && (
          <Button variant={tab === "group" ? "default" : "outline"} onClick={() => setTab("group")}>
            {t(language, "cabAdmin.tabGroup")}
          </Button>
        )}
      </div>

      <CabTable
        members={activeMembers}
        language={language}
        showOpco={tab === "perOpco"}
        onRemove={(m) => setConfirm(m)}
      />

      {addOpen && (
        <CabAddDialog
          language={language}
          opcoSlug={addSlug}
          existingUserIds={activeMembers.map((m) => m.userId)}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); refresh() }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={t(language, "cabAdmin.removeTitle")}
          body={t(language, "cabAdmin.removeBody")}
          confirmLabel={t(language, "cabAdmin.remove")}
          cancelLabel={t(language, "cabAdmin.cancel")}
          pending={pending}
          onConfirm={handleRemove}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check + run CAB tests + dashboard smoke**

Run: `pnpm tsc --noEmit && pnpm vitest run src/test/app/cab/ src/app/dashboard-client.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/cab/page.tsx" "src/app/(dashboard)/cab/cab-client.tsx"
git commit -m "feat(cab-ui): add CAB page with per-OpCo and group tabs"
```

---

## Task 5: Delegations components (types, list, create dialog)

**Files:**
- Create: `src/app/(dashboard)/delegations/types.ts`
- Create: `src/app/(dashboard)/delegations/delegation-list.tsx`
- Create: `src/app/(dashboard)/delegations/delegation-create-dialog.tsx`
- Test: `src/test/app/delegations/delegation-list.test.tsx`, `src/test/app/delegations/delegation-create-dialog.test.tsx`

- [ ] **Step 1: Create the types**

Create `src/app/(dashboard)/delegations/types.ts`:

```ts
export type DbDelegation = {
  id: string
  opco: { name: string; slug: string }
  fromUser: { id: string; name: string | null; email: string }
  toUser: { id: string; name: string | null; email: string }
  validUntil: string // ISO string
}
```

- [ ] **Step 2: Write the failing smoke tests**

Create `src/test/app/delegations/delegation-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import DelegationList from "@/app/(dashboard)/delegations/delegation-list"
import type { DbDelegation } from "@/app/(dashboard)/delegations/types"

const rows: DbDelegation[] = [
  {
    id: "d1", opco: { name: "Ghana", slug: "ghana" },
    fromUser: { id: "u1", name: "Ada", email: "ada@csquared.com" },
    toUser: { id: "u2", name: "Bo", email: "bo@csquared.com" },
    validUntil: "2026-12-31T00:00:00.000Z",
  },
]

describe("DelegationList", () => {
  it("renders delegation rows", () => {
    render(<DelegationList delegations={rows} language="en" onRevoke={vi.fn()} />)
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("bo@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<DelegationList delegations={[]} language="en" onRevoke={vi.fn()} />)
    expect(screen.getByText("No active delegations.")).toBeInTheDocument()
  })
})
```

Create `src/test/app/delegations/delegation-create-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/delegations", () => ({ createDelegation: vi.fn().mockResolvedValue({}) }))
vi.mock("@/server/actions/users", () => ({ listOpCoApprovers: vi.fn().mockResolvedValue([]) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import DelegationCreateDialog from "@/app/(dashboard)/delegations/delegation-create-dialog"

describe("DelegationCreateDialog", () => {
  it("renders the create dialog with an OpCo picker", () => {
    render(
      <DelegationCreateDialog language="en" manageableSlugs={["ghana"]} onClose={vi.fn()} onCreated={vi.fn()} />
    )
    expect(screen.getByText("Create delegation")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run red**

Run: `pnpm vitest run src/test/app/delegations/`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `delegation-list.tsx`**

Create `src/app/(dashboard)/delegations/delegation-list.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbDelegation } from "./types"

interface DelegationListProps {
  delegations: DbDelegation[]
  language: Language
  onRevoke: (delegation: DbDelegation) => void
}

export default function DelegationList({ delegations, language, onRevoke }: DelegationListProps) {
  if (delegations.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "delegationsAdmin.none")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colFrom")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colTo")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colUntil")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {delegations.map((d) => (
              <tr key={d.id} className="border-b border-border/40">
                <td className="px-4 py-2">{d.fromUser.email}</td>
                <td className="px-4 py-2">{d.toUser.email}</td>
                <td className="px-4 py-2">{d.opco.slug}</td>
                <td className="px-4 py-2">{new Date(d.validUntil).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => onRevoke(d)}>
                      {t(language, "delegationsAdmin.revoke")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Implement `delegation-create-dialog.tsx`**

Create `src/app/(dashboard)/delegations/delegation-create-dialog.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createDelegation } from "@/server/actions/delegations"
import { listOpCoApprovers } from "@/server/actions/users"

type Approver = { id: string; name: string | null; email: string }

interface DelegationCreateDialogProps {
  language: Language
  manageableSlugs: string[]
  onClose: () => void
  onCreated: () => void
}

export default function DelegationCreateDialog({ language, manageableSlugs, onClose, onCreated }: DelegationCreateDialogProps) {
  const { toast } = useToast()
  const [opcoSlug, setOpcoSlug] = useState(manageableSlugs[0] ?? "")
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [fromUserId, setFromUserId] = useState("")
  const [toUserId, setToUserId] = useState("")
  const [until, setUntil] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!opcoSlug) return
    listOpCoApprovers(opcoSlug).then(setApprovers).catch(() => setApprovers([]))
  }, [opcoSlug])

  const canSubmit = opcoSlug && fromUserId && toUserId && fromUserId !== toUserId && until

  const submit = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      await createDelegation({ opcoSlug, fromUserId, toUserId, validUntil: new Date(until) })
      toast({ title: t(language, "delegationsAdmin.created"), variant: "success" })
      onCreated()
    } catch (err) {
      toast({ title: t(language, "delegationsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "delegationsAdmin.createTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            aria-label={t(language, "delegationsAdmin.fieldOpco")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={opcoSlug}
            onChange={(e) => { setOpcoSlug(e.target.value); setFromUserId(""); setToUserId("") }}
          >
            {manageableSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            aria-label={t(language, "delegationsAdmin.fieldFrom")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={fromUserId}
            onChange={(e) => setFromUserId(e.target.value)}
          >
            <option value="">{t(language, "delegationsAdmin.fieldFrom")}</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <select
            aria-label={t(language, "delegationsAdmin.fieldTo")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
          >
            <option value="">{t(language, "delegationsAdmin.fieldTo")}</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <Input type="date" aria-label={t(language, "delegationsAdmin.fieldUntil")} value={until} onChange={(e) => setUntil(e.target.value)} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "delegationsAdmin.cancel")}</Button>
            <Button onClick={submit} disabled={pending || !canSubmit}>{t(language, "delegationsAdmin.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Run green**

Run: `pnpm vitest run src/test/app/delegations/`
Expected: PASS (3 cases). Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/delegations/types.ts" "src/app/(dashboard)/delegations/delegation-list.tsx" "src/app/(dashboard)/delegations/delegation-create-dialog.tsx" src/test/app/delegations/
git commit -m "feat(delegations-ui): add delegation list + create dialog components"
```

---

## Task 6: Delegations page + container

**Files:**
- Create: `src/app/(dashboard)/delegations/page.tsx`
- Create: `src/app/(dashboard)/delegations/delegations-client.tsx`

- [ ] **Step 1: Create the server component**

`ApproverDelegation` has no `opco` relation, so resolve managed OpCo ids first, then map. Create `src/app/(dashboard)/delegations/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs } from "@/lib/permissions"
import DelegationsClient from "./delegations-client"
import type { DbDelegation } from "./types"

export default async function DelegationsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }

  const db = getPrisma()
  const opcos = await db.opCo.findMany({
    where: slugFilter ? { slug: slugFilter } : {},
    select: { id: true, name: true, slug: true },
  })
  const opcoById = new Map(opcos.map((o) => [o.id, o]))

  const rows = await db.approverDelegation.findMany({
    where: { isActive: true, opcoId: { in: opcos.map((o) => o.id) } },
    include: {
      fromUser: { select: { id: true, name: true, email: true } },
      toUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { validUntil: "asc" },
  })

  const delegations: DbDelegation[] = rows.map((d) => {
    const opco = opcoById.get(d.opcoId)
    return {
      id: d.id,
      opco: { name: opco?.name ?? "", slug: opco?.slug ?? "" },
      fromUser: d.fromUser,
      toUser: d.toUser,
      validUntil: d.validUntil.toISOString(),
    }
  })

  return <DelegationsClient delegations={delegations} />
}
```

- [ ] **Step 2: Create the client container**

Create `src/app/(dashboard)/delegations/delegations-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { revokeDelegation } from "@/server/actions/delegations"
import ConfirmDialog from "../users/confirm-dialog"
import DelegationList from "./delegation-list"
import DelegationCreateDialog from "./delegation-create-dialog"
import type { DbDelegation } from "./types"

interface DelegationsClientProps {
  delegations: DbDelegation[]
}

export default function DelegationsClient({ delegations }: DelegationsClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles) : false
  const scope = session ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles) : []
  const manageableSlugs =
    scope === "all" ? Array.from(new Set(delegations.map((d) => d.opco.slug).filter(Boolean))) : scope

  const [createOpen, setCreateOpen] = useState(false)
  const [confirm, setConfirm] = useState<DbDelegation | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const handleRevoke = async () => {
    if (!confirm) return
    setPending(true)
    try {
      await revokeDelegation(confirm.id)
      toast({ title: t(language, "delegationsAdmin.revoked"), variant: "success" })
      setConfirm(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "delegationsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "delegationsAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "delegationsAdmin.desc")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!isAdmin || manageableSlugs.length === 0}>
          {t(language, "delegationsAdmin.new")}
        </Button>
      </div>

      <DelegationList delegations={delegations} language={language} onRevoke={(d) => setConfirm(d)} />

      {createOpen && (
        <DelegationCreateDialog
          language={language}
          manageableSlugs={manageableSlugs}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); refresh() }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={t(language, "delegationsAdmin.revokeTitle")}
          body={t(language, "delegationsAdmin.revokeBody")}
          confirmLabel={t(language, "delegationsAdmin.revoke")}
          cancelLabel={t(language, "delegationsAdmin.cancel")}
          pending={pending}
          onConfirm={handleRevoke}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check + run delegations tests + dashboard smoke**

Run: `pnpm tsc --noEmit && pnpm vitest run src/test/app/delegations/ src/app/dashboard-client.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/delegations/page.tsx" "src/app/(dashboard)/delegations/delegations-client.tsx"
git commit -m "feat(delegations-ui): add Delegations page with create + revoke"
```

---

## Task 7: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites incl. the new CAB/Delegations component tests and `listOpCoApprovers`.

- [ ] **Step 2: Type-check, lint, build**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors.

Run: `pnpm build`
Expected: succeeds; `/cab` and `/delegations` appear as `ƒ` (dynamic).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(admin-ui): deslop pass for CAB + Delegations UI"
```

---

## Self-Review (author's check against the spec)

- **CAB page** (spec §CAB): Per-OpCo + Group tabs, member table, approver-eligible add dialog, soft remove with confirm (Tasks 3–4). ✓
- **Delegations page** (spec §Delegations): table (from→to, valid-until), create dialog with approver pickers + date, revoke with confirm (Tasks 5–6). ✓
- **`listOpCoApprovers`** (spec §Small Backend Additions): Task 2, per-OpCo + group authz. ✓
- **Nav + gating** (spec §IA): CAB + Delegations added to the Administration group (Task 1); both gated by the group's `canManageAnyOpCo` filter already in `app-shell.tsx`; the Group CAB tab is shown only to `isGroupLevel`. ✓
- **Template + OpCo scoping** (spec §Template/Scoping): server component reads active-OpCo cookie + `manageableOpCoSlugs`; aggregate with OpCo column when "All OpCos"; modal dialogs + reused `confirm-dialog`. ✓
- **Render smoke tests + i18n en/fr** (spec §Testing/i18n): Tasks 1, 3, 5. ✓
- **Out of scope**: OpCos + Audit (F3); CAB engagement workflow; live login. ✓

> Note: the CAB "+ Add" button in the Per-OpCo tab is disabled when no specific managed OpCo can be resolved (group_admin viewing "All OpCos" with no rows) — they pick a specific OpCo via the header switcher to add. The Group CAB tab's add uses `opcoSlug = null`.
