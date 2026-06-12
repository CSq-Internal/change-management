# Admin Console — Plan F1: Administration nav + Teams UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the sidebar group to "Administration" and replace the Teams page's Zustand stub with a real, modal-based management UI wired to the `teams.ts` server actions (team CRUD + member add/remove/set-lead), scoped to the manageable OpCos and the active-OpCo header switcher.

**Architecture:** Follow the existing Users page template exactly: a server component (`page.tsx`) reads scope + the `csq-active-opco` cookie, queries Prisma, and passes plain props to a client container; the container renders a table plus modal dialogs that call server actions and `router.refresh()`. Member-picker data is fetched on demand via a new `listOpCoMembers` server action. Components are verified with React Testing Library render smoke tests (mocked props), mirroring `user-list.test.tsx`.

**Tech Stack:** Next.js App Router (RSC + server actions), NextAuth session, Prisma v7, shadcn/ui (`Button`, `Card`, `Input`, `Textarea`), Vitest + React Testing Library.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-console-ui-design.md` (Plan F, phase F1).

**Depends on:** Plans A–E (the `teams.ts` actions: `createTeam`, `updateTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `setTeamMemberRole`; `recordAdminAction`; the mock-DB test idiom). This plan is on branch `feat/admin-governance-opco-lifecycle` (which already holds D+E).

---

## File Structure

- `src/lib/i18n.ts` — rename `nav.userManagement` value → "Administration"/"Administration"; add `teamsAdmin.*` keys (en + fr).
- `src/server/actions/teams.ts` — add `listOpCoMembers(opcoSlug)` read action.
- `src/app/(dashboard)/teams/page.tsx` — rewrite: scope by `manageableOpCoSlugs` + active-OpCo cookie; richer member include; serialize.
- `src/app/(dashboard)/teams/types.ts` — **new**: shared `DbTeam` / `DbTeamMember` / `OpCoMember` types.
- `src/app/(dashboard)/teams/team-list.tsx` — **new**: table of teams with row actions.
- `src/app/(dashboard)/teams/team-form-dialog.tsx` — **new**: create/edit team modal.
- `src/app/(dashboard)/teams/team-members-dialog.tsx` — **new**: manage members modal (add/remove/set-lead).
- `src/app/(dashboard)/teams/teams-client.tsx` — rewrite: container wiring list + dialogs + confirm.
- Reuse: `src/app/(dashboard)/users/confirm-dialog.tsx` (imported by the teams container).
- Tests: `src/test/actions/teams.test.ts` (extend), `src/test/app/teams/team-list.test.tsx` (**new**), `src/test/app/teams/team-form-dialog.test.tsx` (**new**), `src/test/app/teams/team-members-dialog.test.tsx` (**new**).

> **Users "alignment":** the Users page needs no code change — it already matches the template and isn't group-label-coupled. F1's only Users-facing change is the nav-group rename (Task 1).

---

## Task 1: Rename nav group + add Teams i18n keys

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Rename the group label (en + fr)**

In `src/lib/i18n.ts`, change the two `nav.userManagement` values:
- Line ~11 (English): `"nav.userManagement": "User Management",` → `"nav.userManagement": "Administration",`
- Line ~406 (French): `"nav.userManagement": "Gestion Utilisateurs",` → `"nav.userManagement": "Administration",`

(The key stays `nav.userManagement` so `app-shell.tsx`'s gating filter — which matches on that key — keeps working unchanged.)

- [ ] **Step 2: Add Teams-admin keys to the English map**

In the English block, next to the existing `teams.*` keys, add:

```ts
    "teamsAdmin.title": "Teams",
    "teamsAdmin.desc": "Create work groups and manage their members.",
    "teamsAdmin.new": "New team",
    "teamsAdmin.none": "No teams yet.",
    "teamsAdmin.colName": "Team",
    "teamsAdmin.colOpco": "OpCo",
    "teamsAdmin.colMembers": "Members",
    "teamsAdmin.edit": "Edit",
    "teamsAdmin.members": "Members",
    "teamsAdmin.delete": "Delete",
    "teamsAdmin.createTitle": "Create team",
    "teamsAdmin.editTitle": "Edit team",
    "teamsAdmin.fieldName": "Team name",
    "teamsAdmin.fieldDesc": "Description (optional)",
    "teamsAdmin.fieldOpco": "OpCo",
    "teamsAdmin.save": "Save",
    "teamsAdmin.cancel": "Cancel",
    "teamsAdmin.membersTitle": "Manage members",
    "teamsAdmin.addMember": "Add member",
    "teamsAdmin.roleLead": "Lead",
    "teamsAdmin.roleMember": "Member",
    "teamsAdmin.makeLead": "Make lead",
    "teamsAdmin.makeMember": "Make member",
    "teamsAdmin.remove": "Remove",
    "teamsAdmin.noMembers": "No members yet.",
    "teamsAdmin.pickMember": "Add a member from this OpCo",
    "teamsAdmin.deleteTitle": "Delete team?",
    "teamsAdmin.deleteBody": "This permanently removes the team and its membership. This cannot be undone.",
    "teamsAdmin.saved": "Saved",
    "teamsAdmin.deleted": "Team deleted",
    "teamsAdmin.failed": "Action failed",
```

- [ ] **Step 3: Add the same keys to the French map**

In the French block, add:

```ts
    "teamsAdmin.title": "Équipes",
    "teamsAdmin.desc": "Créez des groupes de travail et gérez leurs membres.",
    "teamsAdmin.new": "Nouvelle équipe",
    "teamsAdmin.none": "Aucune équipe.",
    "teamsAdmin.colName": "Équipe",
    "teamsAdmin.colOpco": "OpCo",
    "teamsAdmin.colMembers": "Membres",
    "teamsAdmin.edit": "Modifier",
    "teamsAdmin.members": "Membres",
    "teamsAdmin.delete": "Supprimer",
    "teamsAdmin.createTitle": "Créer une équipe",
    "teamsAdmin.editTitle": "Modifier l'équipe",
    "teamsAdmin.fieldName": "Nom de l'équipe",
    "teamsAdmin.fieldDesc": "Description (facultatif)",
    "teamsAdmin.fieldOpco": "OpCo",
    "teamsAdmin.save": "Enregistrer",
    "teamsAdmin.cancel": "Annuler",
    "teamsAdmin.membersTitle": "Gérer les membres",
    "teamsAdmin.addMember": "Ajouter un membre",
    "teamsAdmin.roleLead": "Responsable",
    "teamsAdmin.roleMember": "Membre",
    "teamsAdmin.makeLead": "Définir responsable",
    "teamsAdmin.makeMember": "Définir membre",
    "teamsAdmin.remove": "Retirer",
    "teamsAdmin.noMembers": "Aucun membre.",
    "teamsAdmin.pickMember": "Ajouter un membre de cet OpCo",
    "teamsAdmin.deleteTitle": "Supprimer l'équipe ?",
    "teamsAdmin.deleteBody": "Ceci supprime définitivement l'équipe et ses membres. Action irréversible.",
    "teamsAdmin.saved": "Enregistré",
    "teamsAdmin.deleted": "Équipe supprimée",
    "teamsAdmin.failed": "Échec de l'action",
```

- [ ] **Step 4: Type-check and run the i18n-dependent smoke tests**

Run: `pnpm tsc --noEmit`
Expected: PASS.

Run: `pnpm vitest run src/app/dashboard-client.test.tsx`
Expected: PASS (confirms i18n map still parses).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(admin-ui): rename nav group to Administration; add teams-admin i18n keys"
```

---

## Task 2: `listOpCoMembers` read action

Returns the active-assignment users in an OpCo (for the add-member picker). Authorized like team management (`canManageTeams`).

**Files:**
- Modify: `src/server/actions/teams.ts`
- Test: `src/test/actions/teams.test.ts`

- [ ] **Step 1: Add the failing test**

In `src/test/actions/teams.test.ts`, add to the mock `mockDb.userOpCoAssignment` a `findMany` mock (the object currently only has `findFirst`). Update that property to:

```ts
  userOpCoAssignment: {
    findFirst: vi.fn().mockResolvedValue({ id: "a1" }),
    findMany: vi.fn().mockResolvedValue([
      { user: { id: "u1", name: "Ada", email: "ada@csquared.com" } },
      { user: { id: "u2", name: "Bo", email: "bo@csquared.com" } },
    ]),
  },
```

Extend the import to include `listOpCoMembers`:

```ts
import {
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  listOpCoMembers,
} from "@/server/actions/teams"
```

Append this describe block:

```ts
describe("listOpCoMembers", () => {
  it("rejects a non-admin", async () => {
    await expect(listOpCoMembers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("returns the OpCo's active-assignment users for an admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    const members = await listOpCoMembers("ghana")
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { opco: { slug: "ghana" }, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
    expect(members).toEqual([
      { id: "u1", name: "Ada", email: "ada@csquared.com" },
      { id: "u2", name: "Bo", email: "bo@csquared.com" },
    ])
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/teams.test.ts -t listOpCoMembers`
Expected: FAIL — `listOpCoMembers is not a function`.

- [ ] **Step 3: Implement**

Append to `src/server/actions/teams.ts`:

```ts
export async function listOpCoMembers(opcoSlug: string) {
  const session = await getAppSession()
  assertCanManageTeams(session, opcoSlug)
  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { opco: { slug: opcoSlug }, isActive: true },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}
```

- [ ] **Step 4: Run green**

Run: `pnpm vitest run src/test/actions/teams.test.ts`
Expected: PASS (existing + the 2 new cases). Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/teams.ts src/test/actions/teams.test.ts
git commit -m "feat(teams): add listOpCoMembers read action for the member picker"
```

---

## Task 3: Teams page server component + shared types

**Files:**
- Create: `src/app/(dashboard)/teams/types.ts`
- Modify: `src/app/(dashboard)/teams/page.tsx`

- [ ] **Step 1: Create the shared types**

Create `src/app/(dashboard)/teams/types.ts`:

```ts
export type DbTeamMember = {
  userId: string
  name: string | null
  email: string
  role: "lead" | "member"
}

export type DbTeam = {
  id: string
  name: string
  description: string | null
  opco: { name: string; slug: string }
  members: DbTeamMember[]
}

export type OpCoMember = {
  id: string
  name: string | null
  email: string
}
```

- [ ] **Step 2: Rewrite the page to scope + include members**

Replace the entire contents of `src/app/(dashboard)/teams/page.tsx` with:

```tsx
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs } from "@/lib/permissions"
import TeamsClient from "./teams-client"
import type { DbTeam } from "./types"

export default async function TeamsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  // Narrow to the active OpCo when it is a specific, manageable one.
  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }

  const db = getPrisma()
  const teams = await db.team.findMany({
    where: slugFilter ? { opco: { slug: slugFilter } } : {},
    include: {
      opco: true,
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { name: "asc" },
  })

  const serializable: DbTeam[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    opco: { name: team.opco.name, slug: team.opco.slug },
    members: team.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  }))

  return <TeamsClient teams={serializable} />
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: FAIL — `teams-client` still exports the old `TeamsClient` whose props (`{ teams: DbTeam[] }` with the OLD `DbTeam` shape) no longer match. This is expected; Task 6 rewrites the container. **Do not commit yet** — proceed to Tasks 4–6, which rewrite the client side, then commit page + client together in Task 6.

> Note: this task intentionally leaves the tree non-compiling until Task 6. If you prefer a green tree per task, do Tasks 4, 5, 6 first and Task 3 immediately before Task 6's commit. The grouped commit happens in Task 6.

---

## Task 4: `team-list.tsx` table + smoke test

**Files:**
- Create: `src/app/(dashboard)/teams/team-list.tsx`
- Test: `src/test/app/teams/team-list.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `src/test/app/teams/team-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import TeamList from "@/app/(dashboard)/teams/team-list"
import type { DbTeam } from "@/app/(dashboard)/teams/types"

const teams: DbTeam[] = [
  {
    id: "t1", name: "Core Network", description: null,
    opco: { name: "Ghana", slug: "ghana" },
    members: [{ userId: "u1", name: "Ada", email: "ada@csquared.com", role: "lead" }],
  },
]

describe("TeamList", () => {
  it("renders team rows with OpCo and member count", () => {
    render(
      <TeamList
        teams={teams}
        language="en"
        onEdit={vi.fn()}
        onMembers={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByText("Core Network")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("shows an empty state when there are no teams", () => {
    render(
      <TeamList teams={[]} language="en" onEdit={vi.fn()} onMembers={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByText("No teams yet.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/app/teams/team-list.test.tsx`
Expected: FAIL — cannot find module `team-list`.

- [ ] **Step 3: Implement**

Create `src/app/(dashboard)/teams/team-list.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbTeam } from "./types"

interface TeamListProps {
  teams: DbTeam[]
  language: Language
  onEdit: (team: DbTeam) => void
  onMembers: (team: DbTeam) => void
  onDelete: (team: DbTeam) => void
}

export default function TeamList({ teams, language, onEdit, onMembers, onDelete }: TeamListProps) {
  if (teams.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.none")}</p>
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
              <th className="px-4 py-2">{t(language, "teamsAdmin.colName")}</th>
              <th className="px-4 py-2">{t(language, "teamsAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "teamsAdmin.colMembers")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="border-b border-border/40">
                <td className="px-4 py-2">
                  <div className="font-medium">{team.name}</div>
                  {team.description && (
                    <div className="text-xs text-muted-foreground">{team.description}</div>
                  )}
                </td>
                <td className="px-4 py-2">{team.opco.slug}</td>
                <td className="px-4 py-2">{team.members.length}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onMembers(team)}>
                      {t(language, "teamsAdmin.members")}
                    </Button>
                    <Button variant="outline" onClick={() => onEdit(team)}>
                      {t(language, "teamsAdmin.edit")}
                    </Button>
                    <Button variant="outline" onClick={() => onDelete(team)}>
                      {t(language, "teamsAdmin.delete")}
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

> Note: `src/components/ui/button.tsx` supports only `variant` (`default`/`outline`/`destructive`) — there is no `size` prop, so none is used here.

- [ ] **Step 4: Run green**

Run: `pnpm vitest run src/test/app/teams/team-list.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/teams/team-list.tsx" src/test/app/teams/team-list.test.tsx "src/app/(dashboard)/teams/types.ts"
git commit -m "feat(teams): add team-list table component"
```

---

## Task 5: `team-form-dialog.tsx` + `team-members-dialog.tsx`

**Files:**
- Create: `src/app/(dashboard)/teams/team-form-dialog.tsx`
- Create: `src/app/(dashboard)/teams/team-members-dialog.tsx`
- Test: `src/test/app/teams/team-form-dialog.test.tsx`
- Test: `src/test/app/teams/team-members-dialog.test.tsx`

- [ ] **Step 1: Write the failing smoke tests**

Create `src/test/app/teams/team-form-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/teams", () => ({
  createTeam: vi.fn().mockResolvedValue({ id: "t-new" }),
  updateTeam: vi.fn().mockResolvedValue({ id: "t1" }),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import TeamFormDialog from "@/app/(dashboard)/teams/team-form-dialog"

describe("TeamFormDialog", () => {
  it("renders create mode with an OpCo picker", () => {
    render(
      <TeamFormDialog
        language="en"
        manageableSlugs={["ghana", "uganda"]}
        team={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByText("Create team")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("renders edit mode pre-filled with the team name", () => {
    render(
      <TeamFormDialog
        language="en"
        manageableSlugs={["ghana"]}
        team={{ id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members: [] }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByText("Edit team")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Core Network")).toBeInTheDocument()
  })
})
```

Create `src/test/app/teams/team-members-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/teams", () => ({
  addTeamMember: vi.fn().mockResolvedValue({}),
  removeTeamMember: vi.fn().mockResolvedValue(undefined),
  setTeamMemberRole: vi.fn().mockResolvedValue({}),
  listOpCoMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import TeamMembersDialog from "@/app/(dashboard)/teams/team-members-dialog"

describe("TeamMembersDialog", () => {
  it("lists current members with their role", () => {
    render(
      <TeamMembersDialog
        language="en"
        team={{
          id: "t1", name: "Core Network", description: null,
          opco: { name: "Ghana", slug: "ghana" },
          members: [{ userId: "u1", name: "Ada", email: "ada@csquared.com", role: "lead" }],
        }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("Lead")).toBeInTheDocument()
  })

  it("shows an empty state with no members", () => {
    render(
      <TeamMembersDialog
        language="en"
        team={{ id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members: [] }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText("No members yet.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/app/teams/team-form-dialog.test.tsx src/test/app/teams/team-members-dialog.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `team-form-dialog.tsx`**

Create `src/app/(dashboard)/teams/team-form-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createTeam, updateTeam } from "@/server/actions/teams"
import type { DbTeam } from "./types"

interface TeamFormDialogProps {
  language: Language
  manageableSlugs: string[]
  team: DbTeam | null // null = create
  onClose: () => void
  onSaved: () => void
}

export default function TeamFormDialog({
  language,
  manageableSlugs,
  team,
  onClose,
  onSaved,
}: TeamFormDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState(team?.name ?? "")
  const [description, setDescription] = useState(team?.description ?? "")
  const [opcoSlug, setOpcoSlug] = useState(team?.opco.slug ?? manageableSlugs[0] ?? "")
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setPending(true)
    try {
      if (team) {
        await updateTeam(team.id, { name, description })
      } else {
        await createTeam({ opcoSlug, name, description })
      }
      toast({ title: t(language, "teamsAdmin.saved"), description: name, variant: "success" })
      onSaved()
    } catch (err) {
      toast({
        title: t(language, "teamsAdmin.failed"),
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">
            {t(language, team ? "teamsAdmin.editTitle" : "teamsAdmin.createTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!team && (
            <select
              aria-label={t(language, "teamsAdmin.fieldOpco")}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              value={opcoSlug}
              onChange={(e) => setOpcoSlug(e.target.value)}
            >
              {manageableSlugs.map((slug) => (
                <option key={slug} value={slug}>{slug}</option>
              ))}
            </select>
          )}
          <Input
            placeholder={t(language, "teamsAdmin.fieldName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder={t(language, "teamsAdmin.fieldDesc")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t(language, "teamsAdmin.cancel")}
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {t(language, "teamsAdmin.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Implement `team-members-dialog.tsx`**

Create `src/app/(dashboard)/teams/team-members-dialog.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import {
  addTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  listOpCoMembers,
} from "@/server/actions/teams"
import type { DbTeam, OpCoMember } from "./types"

interface TeamMembersDialogProps {
  language: Language
  team: DbTeam
  onClose: () => void
  onChanged: () => void
}

export default function TeamMembersDialog({ language, team, onClose, onChanged }: TeamMembersDialogProps) {
  const { toast } = useToast()
  const [candidates, setCandidates] = useState<OpCoMember[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    listOpCoMembers(team.opco.slug)
      .then(setCandidates)
      .catch(() => setCandidates([]))
  }, [team.opco.slug])

  const memberIds = new Set(team.members.map((m) => m.userId))
  const addable = candidates.filter((c) => !memberIds.has(c.id))

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true)
    try {
      await fn()
      onChanged()
    } catch (err) {
      toast({
        title: t(language, "teamsAdmin.failed"),
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-lg border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">
            {t(language, "teamsAdmin.membersTitle")} — {team.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {team.members.length === 0 && (
              <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.noMembers")}</p>
            )}
            {team.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded border border-border/60 px-3 py-2 text-sm">
                <div>
                  <div>{m.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(language, m.role === "lead" ? "teamsAdmin.roleLead" : "teamsAdmin.roleMember")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(() => setTeamMemberRole(team.id, m.userId, m.role === "lead" ? "member" : "lead"))
                    }
                    disabled={pending}
                  >
                    {t(language, m.role === "lead" ? "teamsAdmin.makeMember" : "teamsAdmin.makeLead")}
                  </Button>
                  <Button variant="outline" onClick={() => run(() => removeTeamMember(team.id, m.userId))} disabled={pending}>
                    {t(language, "teamsAdmin.remove")}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs text-muted-foreground">{t(language, "teamsAdmin.pickMember")}</div>
            <div className="space-y-1">
              {addable.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded border border-border/40 px-3 py-1.5 text-sm">
                  <span>{c.email}</span>
                  <Button variant="outline" onClick={() => run(() => addTeamMember(team.id, c.id, "member"))} disabled={pending}>
                    {t(language, "teamsAdmin.addMember")}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t(language, "teamsAdmin.cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Run green**

Run: `pnpm vitest run src/test/app/teams/team-form-dialog.test.tsx src/test/app/teams/team-members-dialog.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/teams/team-form-dialog.tsx" "src/app/(dashboard)/teams/team-members-dialog.tsx" src/test/app/teams/team-form-dialog.test.tsx src/test/app/teams/team-members-dialog.test.tsx
git commit -m "feat(teams): add team form + members management dialogs"
```

---

## Task 6: `teams-client.tsx` container rewrite + page commit

**Files:**
- Modify: `src/app/(dashboard)/teams/teams-client.tsx` (full rewrite)
- Test: (covered by component smoke tests + the existing dashboard smoke test)

- [ ] **Step 1: Rewrite the container**

Replace the entire contents of `src/app/(dashboard)/teams/teams-client.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { deleteTeam } from "@/server/actions/teams"
import ConfirmDialog from "../users/confirm-dialog"
import TeamList from "./team-list"
import TeamFormDialog from "./team-form-dialog"
import TeamMembersDialog from "./team-members-dialog"
import type { DbTeam } from "./types"

interface TeamsClientProps {
  teams: DbTeam[]
}

export default function TeamsClient({ teams }: TeamsClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
  const scope = session
    ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
    : []
  // The form's OpCo picker needs concrete slugs; "all" (group_admin) falls back to the slugs present in the data.
  const manageableSlugs =
    scope === "all" ? Array.from(new Set(teams.map((tm) => tm.opco.slug))) : scope

  const [formTeam, setFormTeam] = useState<DbTeam | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [membersTeam, setMembersTeam] = useState<DbTeam | null>(null)
  const [confirmTeam, setConfirmTeam] = useState<DbTeam | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const handleDelete = async () => {
    if (!confirmTeam) return
    setPending(true)
    try {
      await deleteTeam(confirmTeam.id)
      toast({ title: t(language, "teamsAdmin.deleted"), description: confirmTeam.name, variant: "success" })
      setConfirmTeam(null)
      refresh()
    } catch (err) {
      toast({
        title: t(language, "teamsAdmin.failed"),
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "teams.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "teams.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "teamsAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.desc")}</p>
        </div>
        <Button
          onClick={() => { setFormTeam(null); setFormOpen(true) }}
          disabled={!isAdmin || manageableSlugs.length === 0}
        >
          {t(language, "teamsAdmin.new")}
        </Button>
      </div>

      <TeamList
        teams={teams}
        language={language}
        onEdit={(team) => { setFormTeam(team); setFormOpen(true) }}
        onMembers={(team) => setMembersTeam(team)}
        onDelete={(team) => setConfirmTeam(team)}
      />

      {formOpen && (
        <TeamFormDialog
          language={language}
          manageableSlugs={manageableSlugs}
          team={formTeam}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refresh() }}
        />
      )}

      {membersTeam && (
        <TeamMembersDialog
          language={language}
          team={membersTeam}
          onClose={() => setMembersTeam(null)}
          onChanged={refresh}
        />
      )}

      {confirmTeam && (
        <ConfirmDialog
          title={t(language, "teamsAdmin.deleteTitle")}
          body={t(language, "teamsAdmin.deleteBody")}
          confirmLabel={t(language, "teamsAdmin.delete")}
          cancelLabel={t(language, "teamsAdmin.cancel")}
          pending={pending}
          onConfirm={handleDelete}
          onCancel={() => setConfirmTeam(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check the whole tree (page + client now aligned)**

Run: `pnpm tsc --noEmit`
Expected: PASS — the new `DbTeam` shape flows page → container → children consistently, and the old store-based stub is gone.

- [ ] **Step 3: Run the teams component tests + dashboard smoke**

Run: `pnpm vitest run src/test/app/teams/ src/app/dashboard-client.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit (page + container together)**

```bash
git add "src/app/(dashboard)/teams/page.tsx" "src/app/(dashboard)/teams/teams-client.tsx"
git commit -m "feat(teams): wire Teams page to teams.ts actions with modal UI"
```

---

## Task 7: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` (Docker available → integration tests run too).
Expected: PASS — all suites incl. the new teams component tests and the `listOpCoMembers` action test.

- [ ] **Step 2: Type-check, lint, build**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors.

Run: `pnpm build`
Expected: succeeds (`prisma generate` + `next build`) — confirms the rewritten Teams server component compiles in a production build. If `next build` requires `DATABASE_URL` at build time and none is available, note it; the build should still type-check pages.

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(teams): deslop pass for Teams admin UI"
```

---

## Self-Review (author's check against the spec)

- **Rename group → Administration** (spec §IA): Task 1. ✓
- **Users alignment** (spec: no behavior change): covered by the nav rename only; no Users code change needed. ✓
- **Teams wired to actions** (spec §Per-Surface Teams): create/edit/delete + member add/remove/set-lead via `teams.ts` (Tasks 4–6). ✓
- **`listOpCoMembers` picker helper** (spec §Small Backend Additions): Task 2. ✓
- **Shared surface template** (spec §Template): container → list → modal dialogs + reused `confirm-dialog`. ✓
- **OpCo scoping via active-OpCo cookie + manageable** (spec §OpCo Scoping): Task 3 reads `csq-active-opco`, falls back to `manageableOpCoSlugs` aggregate. ✓
- **Render smoke tests** (spec §Testing): Tasks 4–5 (list + both dialogs). ✓
- **i18n en+fr** (spec §i18n): Task 1. ✓
- **Out of scope**: CAB/Delegations/OpCos/Audit (F2/F3); team→change assignment; live login. ✓

> Verified APIs: `Button` supports `variant` only (no `size`); `useToast().toast({ variant })` accepts `success`/`error`/`default`.
