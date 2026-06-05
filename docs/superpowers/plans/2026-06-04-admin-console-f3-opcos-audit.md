# Admin Console — Plan F3: OpCos + Audit Log UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the group_admin-only OpCos management page and the read-only Admin Audit log page, wired to the `opcos.ts` actions and a new `listAdminAudit` reader — and switch the Administration sidebar group to per-item capability gating so OpCos shows only to group_admin and Audit shows to admins + group_auditor.

**Architecture:** Same surface template as F1/F2 (server component → client container → table + modal dialogs). The nav group gains per-item `gate` predicates evaluated in `app-shell.tsx`. The Audit page is filter-driven (action + date), scoped server-side by the caller's manageable OpCos (group-level sees all). Components verified with render smoke tests.

**Tech Stack:** Next.js App Router (RSC + server actions), NextAuth, Prisma v7, shadcn/ui, Vitest + React Testing Library.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-console-ui-design.md` (Plan F, phase F3).

**Depends on:** Plans A–E (`opcos.ts`: `createOpCo`/`renameOpCo`/`archiveOpCo`/`unarchiveOpCo`; the `AdminAuditLog` model) and F1/F2 (surface template, `confirm-dialog`, `activeOpCoSlugFilter`). Branch: `feat/admin-governance-opco-lifecycle` (holds D+E+F1+F2).

**Schema facts:** `AdminAuditLog` has an `actor` relation (User) but `opcoId` and `targetUserId` are plain nullable strings (no relations) — so `listAdminAudit` resolves `opcoId` → slug via a follow-up query (same pattern F1/F2 used). `OpCo` has `archivedAt: DateTime?`.

---

## File Structure

- `src/components/app-shell.tsx` — per-item gating for the Administration group; add `/opcos` + `/admin-audit` items with `gate` tags.
- `src/lib/i18n.ts` — `nav.opcos`, `nav.audit`, `opcosAdmin.*`, `auditAdmin.*` (en + fr).
- `src/server/actions/audit-log.ts` — **new**: `listAdminAudit(filters)` read action.
- `src/app/(dashboard)/opcos/` — **new**: `page.tsx`, `types.ts`, `opcos-client.tsx`, `opco-list.tsx`, `opco-form-dialog.tsx`.
- `src/app/(dashboard)/admin-audit/` — **new**: `page.tsx`, `types.ts`, `audit-client.tsx`, `audit-list.tsx`.
- Reuse: `src/app/(dashboard)/users/confirm-dialog.tsx`.
- Tests: `src/test/actions/audit-log.test.ts` (**new**), smoke tests under `src/test/app/opcos/` and `src/test/app/admin-audit/`.

---

## Task 1: Per-item nav gating + items + i18n

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the nav items with gates**

In `src/components/app-shell.tsx`, add `Building2` and `ScrollText` to the `lucide-react` import. Change the `nav.userManagement` group's `items` to include `gate` tags on every item:

```tsx
    items: [
      { href: "/users", labelKey: "nav.users", icon: Users, gate: "admin" },
      { href: "/teams", labelKey: "nav.teams", icon: UsersRound, gate: "admin" },
      { href: "/cab", labelKey: "nav.cab", icon: Gavel, gate: "admin" },
      { href: "/delegations", labelKey: "nav.delegations", icon: ArrowLeftRight, gate: "admin" },
      { href: "/opcos", labelKey: "nav.opcos", icon: Building2, gate: "groupAdmin" },
      { href: "/admin-audit", labelKey: "nav.audit", icon: ScrollText, gate: "adminOrAudit" },
    ],
```

(Items in other groups have no `gate` and always show.)

- [ ] **Step 2: Update the gating logic**

In `src/components/app-shell.tsx`, update the permissions import to add `isGroupAdmin` and `isGroupLevel`:

```tsx
import { canManageAnyOpCo, isGroupAdmin, isGroupLevel } from "@/lib/permissions"
```

Replace the `showAdminNav` + `effectiveNavGroups` block (currently around lines 122–128) with:

```tsx
  const anyAdmin = session ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles) : false
  const groupAdmin = session ? isGroupAdmin(session.user.realmRoles) : false
  const groupLevel = session ? isGroupLevel(session.user.realmRoles) : false
  const showAdminGroup = anyAdmin || groupLevel

  const itemAllowed = (gate?: string) => {
    if (gate === "groupAdmin") return groupAdmin
    if (gate === "adminOrAudit") return anyAdmin || groupLevel
    if (gate === "admin") return anyAdmin
    return true
  }

  const effectiveNavGroups = useMemo(
    () =>
      navGroups
        .filter((group) => group.labelKey !== "nav.userManagement" || showAdminGroup)
        .map((group) =>
          group.labelKey === "nav.userManagement"
            ? { ...group, items: group.items.filter((item) => itemAllowed((item as { gate?: string }).gate)) }
            : group
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAdminGroup, anyAdmin, groupAdmin, groupLevel]
  )
```

(The `as { gate?: string }` cast is because the other groups' items don't declare `gate`; the optional read is safe.)

- [ ] **Step 3: English i18n keys**

In `src/lib/i18n.ts`, in the English map after the `delegationsAdmin.*` block (before `"nav.settings"`), add:

```ts
    "nav.opcos": "OpCos",
    "nav.audit": "Audit Log",
    "opcosAdmin.title": "Operating Companies",
    "opcosAdmin.desc": "Create and manage OpCos (group admin only).",
    "opcosAdmin.new": "New OpCo",
    "opcosAdmin.none": "No OpCos yet.",
    "opcosAdmin.colName": "Name",
    "opcosAdmin.colSlug": "Slug",
    "opcosAdmin.colStatus": "Status",
    "opcosAdmin.statusActive": "Active",
    "opcosAdmin.statusArchived": "Archived",
    "opcosAdmin.rename": "Rename",
    "opcosAdmin.archive": "Archive",
    "opcosAdmin.unarchive": "Unarchive",
    "opcosAdmin.createTitle": "Create OpCo",
    "opcosAdmin.renameTitle": "Rename OpCo",
    "opcosAdmin.fieldName": "Name",
    "opcosAdmin.fieldSlug": "Slug (lowercase, unique)",
    "opcosAdmin.fieldLocale": "Locale",
    "opcosAdmin.save": "Save",
    "opcosAdmin.cancel": "Cancel",
    "opcosAdmin.archiveTitle": "Archive OpCo?",
    "opcosAdmin.archiveBody": "Archiving hides the OpCo from active lists and blocks new changes. History is kept.",
    "opcosAdmin.saved": "Saved",
    "opcosAdmin.archived": "OpCo archived",
    "opcosAdmin.unarchived": "OpCo restored",
    "opcosAdmin.failed": "Action failed",
    "auditAdmin.title": "Admin Audit Log",
    "auditAdmin.desc": "Immutable record of administrative actions.",
    "auditAdmin.colWhen": "When",
    "auditAdmin.colActor": "Actor",
    "auditAdmin.colAction": "Action",
    "auditAdmin.colOpco": "OpCo",
    "auditAdmin.colSummary": "Summary",
    "auditAdmin.none": "No audit entries.",
    "auditAdmin.filterAction": "Action",
    "auditAdmin.filterActionAll": "All actions",
    "auditAdmin.filterFrom": "From",
    "auditAdmin.filterTo": "To",
    "auditAdmin.apply": "Apply",
    "auditAdmin.clear": "Clear",
```

- [ ] **Step 4: French i18n keys**

In the French map after its `delegationsAdmin.*` block, add:

```ts
    "nav.opcos": "OpCos",
    "nav.audit": "Journal d'audit",
    "opcosAdmin.title": "Sociétés opérationnelles",
    "opcosAdmin.desc": "Créez et gérez les OpCos (admin groupe uniquement).",
    "opcosAdmin.new": "Nouvel OpCo",
    "opcosAdmin.none": "Aucun OpCo.",
    "opcosAdmin.colName": "Nom",
    "opcosAdmin.colSlug": "Identifiant",
    "opcosAdmin.colStatus": "Statut",
    "opcosAdmin.statusActive": "Actif",
    "opcosAdmin.statusArchived": "Archivé",
    "opcosAdmin.rename": "Renommer",
    "opcosAdmin.archive": "Archiver",
    "opcosAdmin.unarchive": "Désarchiver",
    "opcosAdmin.createTitle": "Créer un OpCo",
    "opcosAdmin.renameTitle": "Renommer l'OpCo",
    "opcosAdmin.fieldName": "Nom",
    "opcosAdmin.fieldSlug": "Identifiant (minuscule, unique)",
    "opcosAdmin.fieldLocale": "Langue",
    "opcosAdmin.save": "Enregistrer",
    "opcosAdmin.cancel": "Annuler",
    "opcosAdmin.archiveTitle": "Archiver l'OpCo ?",
    "opcosAdmin.archiveBody": "L'archivage masque l'OpCo des listes actives et bloque les nouveaux changements. L'historique est conservé.",
    "opcosAdmin.saved": "Enregistré",
    "opcosAdmin.archived": "OpCo archivé",
    "opcosAdmin.unarchived": "OpCo restauré",
    "opcosAdmin.failed": "Échec de l'action",
    "auditAdmin.title": "Journal d'audit administrateur",
    "auditAdmin.desc": "Enregistrement immuable des actions administratives.",
    "auditAdmin.colWhen": "Quand",
    "auditAdmin.colActor": "Acteur",
    "auditAdmin.colAction": "Action",
    "auditAdmin.colOpco": "OpCo",
    "auditAdmin.colSummary": "Résumé",
    "auditAdmin.none": "Aucune entrée d'audit.",
    "auditAdmin.filterAction": "Action",
    "auditAdmin.filterActionAll": "Toutes les actions",
    "auditAdmin.filterFrom": "Du",
    "auditAdmin.filterTo": "Au",
    "auditAdmin.apply": "Appliquer",
    "auditAdmin.clear": "Effacer",
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm tsc --noEmit && pnpm vitest run src/app/dashboard-client.test.tsx`
Expected: PASS.

```bash
git add src/components/app-shell.tsx src/lib/i18n.ts
git commit -m "feat(admin-ui): per-item nav gating; add OpCos + Audit nav items and i18n"
```

---

## Task 2: `listAdminAudit` read action

**Files:**
- Create: `src/server/actions/audit-log.ts`
- Test: `src/test/actions/audit-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/audit-log.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-ghr",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  opCo: { findMany: vi.fn().mockResolvedValue([{ id: "opco-gh", slug: "ghana" }]), findUnique: vi.fn() },
  adminAuditLog: {
    findMany: vi.fn().mockResolvedValue([
      { id: "a1", actor: { id: "u1", name: "GA", email: "ga@csquared.com" }, action: "role.update", summary: "x", opcoId: "opco-gh", at: new Date("2026-06-01T00:00:00Z") },
    ]),
  },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { listAdminAudit } from "@/server/actions/audit-log"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", organizations: [], realmRoles: ["group_admin"] }
const groupAuditor = { keycloakId: "kc-gaud", organizations: [], realmRoles: ["group_auditor"] }
const ghanaAdmin = { keycloakId: "kc-gha", organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }], realmRoles: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.opCo.findMany.mockResolvedValue([{ id: "opco-gh", slug: "ghana" }])
  mockDb.adminAuditLog.findMany.mockResolvedValue([
    { id: "a1", actor: { id: "u1", name: "GA", email: "ga@csquared.com" }, action: "role.update", summary: "x", opcoId: "opco-gh", at: new Date("2026-06-01T00:00:00Z") },
  ])
})

describe("listAdminAudit", () => {
  it("rejects a plain requester", async () => {
    await expect(listAdminAudit({})).rejects.toThrow(/Forbidden/)
  })

  it("returns all entries for a group_admin (no opco scope) and serializes rows", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const rows = await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toBeUndefined()
    expect(rows[0]).toEqual({
      id: "a1", actorEmail: "ga@csquared.com", action: "role.update",
      summary: "x", opcoSlug: "ghana", at: "2026-06-01T00:00:00.000Z",
    })
  })

  it("lets a group_auditor read (no opco scope)", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAuditor)
    await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toBeUndefined()
  })

  it("scopes an OpCo admin to their managed OpCo ids", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toEqual({ in: ["opco-gh"] })
  })

  it("applies the action filter", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await listAdminAudit({ action: "user.deactivate" })
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.action).toBe("user.deactivate")
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/audit-log.test.ts`
Expected: FAIL — cannot find module `@/server/actions/audit-log`.

- [ ] **Step 3: Implement**

Create `src/server/actions/audit-log.ts`:

```ts
// src/server/actions/audit-log.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupLevel, canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"

export type AdminAuditRow = {
  id: string
  actorEmail: string
  action: string
  summary: string
  opcoSlug: string | null
  at: string
}

export async function listAdminAudit(filters: {
  opcoSlug?: string
  action?: string
  from?: Date
  to?: Date
}): Promise<AdminAuditRow[]> {
  const session = await getAppSession()
  const groupLevel = isGroupLevel(session.realmRoles)
  const anyAdmin = canManageAnyOpCo(session.organizations, session.realmRoles)
  if (!groupLevel && !anyAdmin) {
    throw new Error("Forbidden: cannot read the admin audit log")
  }

  const db = getPrisma()

  // OpCo admins (not group-level) only see entries for OpCos they manage.
  let opcoIdClause: { in: string[] } | string | undefined
  if (!groupLevel) {
    const managed = manageableOpCoSlugs(session.organizations, session.realmRoles)
    const slugs = managed === "all" ? [] : managed
    const managedOpcos = await db.opCo.findMany({ where: { slug: { in: slugs } }, select: { id: true } })
    opcoIdClause = { in: managedOpcos.map((o) => o.id) }
  }

  // Optional explicit OpCo filter, still subject to scope.
  if (filters.opcoSlug) {
    const opco = await db.opCo.findUnique({ where: { slug: filters.opcoSlug }, select: { id: true } })
    const id = opco?.id
    const inScope = id && (groupLevel || (typeof opcoIdClause === "object" && opcoIdClause.in.includes(id)))
    opcoIdClause = inScope ? id : "__no_match__"
  }

  const at =
    filters.from || filters.to
      ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) }
      : undefined

  const rows = await db.adminAuditLog.findMany({
    where: {
      ...(opcoIdClause !== undefined ? { opcoId: opcoIdClause } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(at ? { at } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { at: "desc" },
    take: 200,
  })

  const opcoIds = [...new Set(rows.map((r) => r.opcoId).filter((x): x is string => Boolean(x)))]
  const opcos = opcoIds.length
    ? await db.opCo.findMany({ where: { id: { in: opcoIds } }, select: { id: true, slug: true } })
    : []
  const slugById = new Map(opcos.map((o) => [o.id, o.slug]))

  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actor.email,
    action: r.action,
    summary: r.summary,
    opcoSlug: r.opcoId ? slugById.get(r.opcoId) ?? null : null,
    at: r.at.toISOString(),
  }))
}
```

- [ ] **Step 4: Run green**

Run: `pnpm vitest run src/test/actions/audit-log.test.ts`
Expected: PASS (5 cases). Then `pnpm tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/audit-log.ts src/test/actions/audit-log.test.ts
git commit -m "feat(audit): add listAdminAudit scoped read action"
```

---

## Task 3: OpCos components (types, list, form dialog)

**Files:**
- Create: `src/app/(dashboard)/opcos/types.ts`, `opco-list.tsx`, `opco-form-dialog.tsx`
- Test: `src/test/app/opcos/opco-list.test.tsx`, `src/test/app/opcos/opco-form-dialog.test.tsx`

- [ ] **Step 1: Create types**

Create `src/app/(dashboard)/opcos/types.ts`:

```ts
export type DbOpCo = {
  id: string
  name: string
  slug: string
  locale: string
  archived: boolean
}
```

- [ ] **Step 2: Write failing smoke tests**

Create `src/test/app/opcos/opco-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import OpcoList from "@/app/(dashboard)/opcos/opco-list"
import type { DbOpCo } from "@/app/(dashboard)/opcos/types"

const opcos: DbOpCo[] = [
  { id: "o1", name: "Ghana", slug: "ghana", locale: "en", archived: false },
  { id: "o2", name: "Uganda", slug: "uganda", locale: "en", archived: true },
]

describe("OpcoList", () => {
  it("renders OpCo rows with status", () => {
    render(<OpcoList opcos={opcos} language="en" onRename={vi.fn()} onArchiveToggle={vi.fn()} />)
    expect(screen.getByText("Ghana")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("Archived")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<OpcoList opcos={[]} language="en" onRename={vi.fn()} onArchiveToggle={vi.fn()} />)
    expect(screen.getByText("No OpCos yet.")).toBeInTheDocument()
  })
})
```

Create `src/test/app/opcos/opco-form-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/opcos", () => ({
  createOpCo: vi.fn().mockResolvedValue({ id: "o-new" }),
  renameOpCo: vi.fn().mockResolvedValue({ id: "o1" }),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import OpcoFormDialog from "@/app/(dashboard)/opcos/opco-form-dialog"

describe("OpcoFormDialog", () => {
  it("renders create mode with slug field", () => {
    render(<OpcoFormDialog language="en" opco={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText("Create OpCo")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Slug (lowercase, unique)")).toBeInTheDocument()
  })

  it("renders rename mode pre-filled, without slug field", () => {
    render(
      <OpcoFormDialog
        language="en"
        opco={{ id: "o1", name: "Ghana", slug: "ghana", locale: "en", archived: false }}
        onClose={vi.fn()} onSaved={vi.fn()}
      />
    )
    expect(screen.getByText("Rename OpCo")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Ghana")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Slug (lowercase, unique)")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run red**

Run: `pnpm vitest run src/test/app/opcos/`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `opco-list.tsx`**

Create `src/app/(dashboard)/opcos/opco-list.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbOpCo } from "./types"

interface OpcoListProps {
  opcos: DbOpCo[]
  language: Language
  onRename: (opco: DbOpCo) => void
  onArchiveToggle: (opco: DbOpCo) => void
}

export default function OpcoList({ opcos, language, onRename, onArchiveToggle }: OpcoListProps) {
  if (opcos.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "opcosAdmin.none")}</p>
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
              <th className="px-4 py-2">{t(language, "opcosAdmin.colName")}</th>
              <th className="px-4 py-2">{t(language, "opcosAdmin.colSlug")}</th>
              <th className="px-4 py-2">{t(language, "opcosAdmin.colStatus")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {opcos.map((o) => (
              <tr key={o.id} className="border-b border-border/40">
                <td className="px-4 py-2 font-medium">{o.name}</td>
                <td className="px-4 py-2">{o.slug}</td>
                <td className="px-4 py-2">
                  {t(language, o.archived ? "opcosAdmin.statusArchived" : "opcosAdmin.statusActive")}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onRename(o)}>
                      {t(language, "opcosAdmin.rename")}
                    </Button>
                    <Button variant="outline" onClick={() => onArchiveToggle(o)}>
                      {t(language, o.archived ? "opcosAdmin.unarchive" : "opcosAdmin.archive")}
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

- [ ] **Step 5: Implement `opco-form-dialog.tsx`**

Create `src/app/(dashboard)/opcos/opco-form-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createOpCo, renameOpCo } from "@/server/actions/opcos"
import type { DbOpCo } from "./types"

interface OpcoFormDialogProps {
  language: Language
  opco: DbOpCo | null // null = create
  onClose: () => void
  onSaved: () => void
}

export default function OpcoFormDialog({ language, opco, onClose, onSaved }: OpcoFormDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState(opco?.name ?? "")
  const [slug, setSlug] = useState("")
  const [locale, setLocale] = useState("en")
  const [pending, setPending] = useState(false)

  const canSubmit = opco ? name.trim() : name.trim() && slug.trim()

  const save = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      if (opco) {
        await renameOpCo(opco.id, name)
      } else {
        await createOpCo({ slug: slug.trim(), name: name.trim(), locale })
      }
      toast({ title: t(language, "opcosAdmin.saved"), description: name, variant: "success" })
      onSaved()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">
            {t(language, opco ? "opcosAdmin.renameTitle" : "opcosAdmin.createTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={t(language, "opcosAdmin.fieldName")} value={name} onChange={(e) => setName(e.target.value)} />
          {!opco && (
            <>
              <Input placeholder={t(language, "opcosAdmin.fieldSlug")} value={slug} onChange={(e) => setSlug(e.target.value)} />
              <select
                aria-label={t(language, "opcosAdmin.fieldLocale")}
                className="w-full rounded border bg-background px-2 py-2 text-sm"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="en">en</option>
                <option value="fr">fr</option>
              </select>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "opcosAdmin.cancel")}</Button>
            <Button onClick={save} disabled={pending || !canSubmit}>{t(language, "opcosAdmin.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Run green + commit**

Run: `pnpm vitest run src/test/app/opcos/` → PASS (4 cases). Then `pnpm tsc --noEmit` → PASS.

```bash
git add "src/app/(dashboard)/opcos/types.ts" "src/app/(dashboard)/opcos/opco-list.tsx" "src/app/(dashboard)/opcos/opco-form-dialog.tsx" src/test/app/opcos/
git commit -m "feat(opcos-ui): add OpCo list + create/rename dialog components"
```

---

## Task 4: OpCos page + container

**Files:**
- Create: `src/app/(dashboard)/opcos/page.tsx`, `src/app/(dashboard)/opcos/opcos-client.tsx`

- [ ] **Step 1: Create the server component (group_admin-gated)**

Create `src/app/(dashboard)/opcos/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import OpcosClient from "./opcos-client"
import type { DbOpCo } from "./types"

export default async function OpcosPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isGroupAdmin(session.user.realmRoles)) redirect("/")

  const db = getPrisma()
  const opcos = await db.opCo.findMany({ orderBy: { name: "asc" } })

  const serializable: DbOpCo[] = opcos.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    locale: o.locale,
    archived: o.archivedAt !== null,
  }))

  return <OpcosClient opcos={serializable} />
}
```

- [ ] **Step 2: Create the container**

Create `src/app/(dashboard)/opcos/opcos-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { archiveOpCo, unarchiveOpCo } from "@/server/actions/opcos"
import ConfirmDialog from "../users/confirm-dialog"
import OpcoList from "./opco-list"
import OpcoFormDialog from "./opco-form-dialog"
import type { DbOpCo } from "./types"

interface OpcosClientProps {
  opcos: DbOpCo[]
}

export default function OpcosClient({ opcos }: OpcosClientProps) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()

  const [formOpco, setFormOpco] = useState<DbOpCo | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<DbOpCo | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const toggleArchive = async (opco: DbOpCo) => {
    // Archiving is confirmed; unarchiving is immediate.
    if (!opco.archived) {
      setConfirmArchive(opco)
      return
    }
    try {
      await unarchiveOpCo(opco.id)
      toast({ title: t(language, "opcosAdmin.unarchived"), description: opco.name, variant: "success" })
      refresh()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    }
  }

  const doArchive = async () => {
    if (!confirmArchive) return
    setPending(true)
    try {
      await archiveOpCo(confirmArchive.id)
      toast({ title: t(language, "opcosAdmin.archived"), description: confirmArchive.name, variant: "success" })
      setConfirmArchive(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "opcosAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "opcosAdmin.desc")}</p>
        </div>
        <Button onClick={() => { setFormOpco(null); setFormOpen(true) }}>
          {t(language, "opcosAdmin.new")}
        </Button>
      </div>

      <OpcoList
        opcos={opcos}
        language={language}
        onRename={(o) => { setFormOpco(o); setFormOpen(true) }}
        onArchiveToggle={toggleArchive}
      />

      {formOpen && (
        <OpcoFormDialog
          language={language}
          opco={formOpco}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refresh() }}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title={t(language, "opcosAdmin.archiveTitle")}
          body={t(language, "opcosAdmin.archiveBody")}
          confirmLabel={t(language, "opcosAdmin.archive")}
          cancelLabel={t(language, "opcosAdmin.cancel")}
          pending={pending}
          onConfirm={doArchive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm tsc --noEmit && pnpm vitest run src/test/app/opcos/ src/app/dashboard-client.test.tsx` → PASS.

```bash
git add "src/app/(dashboard)/opcos/page.tsx" "src/app/(dashboard)/opcos/opcos-client.tsx"
git commit -m "feat(opcos-ui): add OpCos management page (group_admin only)"
```

---

## Task 5: Audit components (types, list)

**Files:**
- Create: `src/app/(dashboard)/admin-audit/types.ts`, `audit-list.tsx`
- Test: `src/test/app/admin-audit/audit-list.test.tsx`

- [ ] **Step 1: Create types**

Create `src/app/(dashboard)/admin-audit/types.ts`:

```ts
export type AuditRow = {
  id: string
  actorEmail: string
  action: string
  summary: string
  opcoSlug: string | null
  at: string // ISO
}
```

- [ ] **Step 2: Write the failing smoke test**

Create `src/test/app/admin-audit/audit-list.test.tsx`:

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import AuditList from "@/app/(dashboard)/admin-audit/audit-list"
import type { AuditRow } from "@/app/(dashboard)/admin-audit/types"

const rows: AuditRow[] = [
  { id: "a1", actorEmail: "ga@csquared.com", action: "role.update", summary: "Updated assignments", opcoSlug: "ghana", at: "2026-06-01T10:00:00.000Z" },
]

describe("AuditList", () => {
  it("renders audit rows", () => {
    render(<AuditList rows={rows} language="en" />)
    expect(screen.getByText("ga@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("role.update")).toBeInTheDocument()
    expect(screen.getByText("Updated assignments")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<AuditList rows={[]} language="en" />)
    expect(screen.getByText("No audit entries.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run red**

Run: `pnpm vitest run src/test/app/admin-audit/`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `audit-list.tsx`**

Create `src/app/(dashboard)/admin-audit/audit-list.tsx`:

```tsx
"use client"

import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { AuditRow } from "./types"

interface AuditListProps {
  rows: AuditRow[]
  language: Language
}

export default function AuditList({ rows, language }: AuditListProps) {
  if (rows.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "auditAdmin.none")}</p>
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
              <th className="px-4 py-2">{t(language, "auditAdmin.colWhen")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colActor")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colAction")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colSummary")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 align-top">
                <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(r.at).toLocaleString()}
                </td>
                <td className="px-4 py-2">{r.actorEmail}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2">{r.opcoSlug ?? "—"}</td>
                <td className="px-4 py-2">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Run green + commit**

Run: `pnpm vitest run src/test/app/admin-audit/` → PASS (2 cases). Then `pnpm tsc --noEmit` → PASS.

```bash
git add "src/app/(dashboard)/admin-audit/types.ts" "src/app/(dashboard)/admin-audit/audit-list.tsx" src/test/app/admin-audit/
git commit -m "feat(audit-ui): add audit log table component"
```

---

## Task 6: Audit page + container (filters)

**Files:**
- Create: `src/app/(dashboard)/admin-audit/page.tsx`, `src/app/(dashboard)/admin-audit/audit-client.tsx`

- [ ] **Step 1: Create the server component**

Create `src/app/(dashboard)/admin-audit/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageAnyOpCo, isGroupLevel } from "@/lib/permissions"
import { listAdminAudit } from "@/server/actions/audit-log"
import AuditClient from "./audit-client"

export default async function AdminAuditPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const allowed =
    canManageAnyOpCo(session.user.organizations, session.user.realmRoles) ||
    isGroupLevel(session.user.realmRoles)
  if (!allowed) redirect("/")

  const rows = await listAdminAudit({})
  return <AuditClient initialRows={rows} />
}
```

- [ ] **Step 2: Create the container (filters call the action client-side)**

Create `src/app/(dashboard)/admin-audit/audit-client.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { listAdminAudit } from "@/server/actions/audit-log"
import AuditList from "./audit-list"
import type { AuditRow } from "./types"

const ACTIONS = [
  "user.onboard", "user.link", "user.deactivate", "user.reactivate", "role.update",
  "team.create", "team.delete", "team.member.add", "team.member.remove", "team.member.role",
  "cab.add", "cab.remove", "opco.create", "opco.rename", "opco.archive", "opco.unarchive",
  "delegation.create", "delegation.revoke",
]

interface AuditClientProps {
  initialRows: AuditRow[]
}

export default function AuditClient({ initialRows }: AuditClientProps) {
  const { language } = useStore()
  const { toast } = useToast()
  const [rows, setRows] = useState<AuditRow[]>(initialRows)
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [pending, setPending] = useState(false)

  const apply = async () => {
    setPending(true)
    try {
      const next = await listAdminAudit({
        action: action || undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      })
      setRows(next)
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  const clear = async () => {
    setAction(""); setFrom(""); setTo("")
    setPending(true)
    try {
      setRows(await listAdminAudit({}))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "auditAdmin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "auditAdmin.desc")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterAction")}
          <select
            className="mt-1 block rounded border bg-background px-2 py-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">{t(language, "auditAdmin.filterActionAll")}</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterFrom")}
          <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterTo")}
          <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button onClick={apply} disabled={pending}>{t(language, "auditAdmin.apply")}</Button>
        <Button variant="outline" onClick={clear} disabled={pending}>{t(language, "auditAdmin.clear")}</Button>
      </div>

      <AuditList rows={rows} language={language} />
    </div>
  )
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm tsc --noEmit && pnpm vitest run src/test/app/admin-audit/ src/app/dashboard-client.test.tsx` → PASS.

```bash
git add "src/app/(dashboard)/admin-audit/page.tsx" "src/app/(dashboard)/admin-audit/audit-client.tsx"
git commit -m "feat(audit-ui): add Admin Audit log page with filters"
```

---

## Task 7: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites incl. the new OpCos/Audit component tests and `listAdminAudit`.

- [ ] **Step 2: Type-check, lint, build**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors.

Run: `pnpm build`
Expected: succeeds; `/opcos` and `/admin-audit` appear as `ƒ` (dynamic).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(admin-ui): deslop pass for OpCos + Audit UI"
```

---

## Self-Review (author's check against the spec)

- **OpCos page, group_admin only** (spec §OpCos): page redirects non-group_admin; table + create/rename/archive/unarchive (Tasks 3–4). ✓
- **Audit log page** (spec §Audit): filterable read-only table; scoped server-side (group → all, OpCo admin → own, group_auditor → read); `listAdminAudit` (Tasks 2, 5–6). ✓
- **Per-item nav gating** (spec §IA): group shows for `canManageAnyOpCo || isGroupLevel`; OpCos gated `groupAdmin`, Audit gated `adminOrAudit`, others `admin` (Task 1). ✓
- **Template + dialogs + i18n + smoke tests**: Tasks 1,3,5. ✓
- **Out of scope**: explicit OpCo dropdown filter on the audit page (auto-scope + action/date filters only — OpCo filter is supported in `listAdminAudit` but the page UI ships action+date; an OpCo filter control is a small follow-up); CAB engagement; live login.

> Note: this is the final F phase — after it, the full Admin & Governance feature (backend A–E + UI F1–F3) is complete on the branch, ready to merge.
