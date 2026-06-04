# Admin & Governance — Plan D: OpCo Lifecycle Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group_admin-only OpCo lifecycle management — create (with best-effort Keycloak org provisioning), rename, and archive/unarchive — with atomic auditing.

**Architecture:** New `src/server/actions/opcos.ts`, all actions gated to `group_admin` via a shared `assertGroupAdmin`. `createOpCo` provisions a Keycloak organization **best-effort** (a new `createKeycloakOrg` helper) and falls back to a placeholder `keycloakOrgId` when Keycloak is unavailable (mirroring the existing best-effort `assignToOrganization` pattern and the seed's placeholder convention). Archive is a soft flag (`OpCo.archivedAt`, already in the foundation schema) — OpCos are never hard-deleted (they own changes/history). Every mutation is atomic with one `AdminAuditLog` row.

**Tech Stack:** Next.js server actions, Prisma v7, Keycloak Admin API, Vitest + mocked Prisma/Keycloak.

**Source spec:** `docs/superpowers/specs/2026-06-04-admin-and-governance-design.md` (OpCo lifecycle).

**Depends on:** Plan A (`OpCo.archivedAt`, `recordAdminAction`, mock-DB `$transaction` idiom). **No migration** in this plan. The OpCo-management **UI** is Plan F.

---

## File Structure

- `src/server/keycloak.ts` — add `createKeycloakOrg(slug, name)` (returns the new org id; throws on failure — callers decide whether to treat best-effort).
- `src/server/actions/opcos.ts` — **new**: `createOpCo`, `renameOpCo`, `archiveOpCo`, `unarchiveOpCo`, plus private `assertGroupAdmin` / `loadOpCo` helpers.
- Test: `src/test/actions/opcos.test.ts` (**new**).

> **Authorization note:** OpCo lifecycle is `group_admin`-only. That's exactly `isGroupAdmin(realmRoles)`, so the actions use it directly via a local `assertGroupAdmin` (no separate `canManageOpCoLifecycle` helper — it would be a pure alias).

> **`keycloakOrgId` fallback:** the column is required + unique. When `createKeycloakOrg` fails (e.g. no Keycloak in dev), `createOpCo` stores `pending-keycloak-<slug>` and logs a warning, so the OpCo still persists. A later reconciliation can replace the placeholder — out of scope here.

---

## Task 1: `createKeycloakOrg` helper + `createOpCo`

**Files:**
- Modify: `src/server/keycloak.ts`
- Create: `src/server/actions/opcos.ts`
- Test: `src/test/actions/opcos.test.ts`

- [ ] **Step 1: Add the `createKeycloakOrg` helper**

Append to `src/server/keycloak.ts` (mirrors `createKeycloakUser`'s Location-header id parsing):

```ts
export async function createKeycloakOrg(slug: string, name: string): Promise<string> {
  const token = await getAdminToken()
  const res = await fetch(`${KC_BASE}/admin/realms/csquared/organizations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      alias: slug,
      domains: [{ name: `${slug}.csquared.local`, verified: false }],
    }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create Keycloak org: ${res.status} ${await res.text()}`)
  }
  const location = res.headers.get("Location")
  if (!location) throw new Error("No Location header in Keycloak create-org response")
  const id = location.split("/").at(-1)
  if (!id) throw new Error(`Could not parse org id from Location: ${location}`)
  return id
}
```

- [ ] **Step 2: Write the failing test**

Create `src/test/actions/opcos.test.ts`:

```ts
// src/test/actions/opcos.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-gha",
    email: "gha@t.co",
    name: "Ghana Admin",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    realmRoles: [],
  }),
}))

vi.mock("@/server/keycloak", () => ({
  createKeycloakOrg: vi.fn().mockResolvedValue("kc-org-1"),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "opco-new", slug: "kenya" }),
    update: vi.fn().mockResolvedValue({ id: "opco-1" }),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { createOpCo } from "@/server/actions/opcos"
import { getAppSession } from "@/lib/session"
import { createKeycloakOrg } from "@/server/keycloak"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.opCo.findUnique.mockResolvedValue(null)
  vi.mocked(createKeycloakOrg).mockResolvedValue("kc-org-1")
})

describe("createOpCo", () => {
  it("rejects a non-group_admin (even an OpCo admin)", async () => {
    await expect(createOpCo({ slug: "kenya", name: "Kenya" })).rejects.toThrow(/Forbidden/)
  })

  it("rejects a slug that already exists", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-x", slug: "kenya" })
    await expect(createOpCo({ slug: "kenya", name: "Kenya" })).rejects.toThrow(/already exists/i)
  })

  it("creates an OpCo with the Keycloak org id and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await createOpCo({ slug: "kenya", name: "Kenya" })
    expect(mockDb.opCo.create).toHaveBeenCalledWith({
      data: { slug: "kenya", name: "Kenya", locale: "en", keycloakOrgId: "kc-org-1" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("falls back to a placeholder keycloakOrgId when Keycloak is unavailable", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    vi.mocked(createKeycloakOrg).mockRejectedValueOnce(new Error("no keycloak"))
    await createOpCo({ slug: "kenya", name: "Kenya", locale: "sw" })
    expect(mockDb.opCo.create).toHaveBeenCalledWith({
      data: { slug: "kenya", name: "Kenya", locale: "sw", keycloakOrgId: "pending-keycloak-kenya" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run red**

Run: `pnpm vitest run src/test/actions/opcos.test.ts`
Expected: FAIL — cannot find module `@/server/actions/opcos`.

- [ ] **Step 4: Implement `createOpCo` (with shared helpers)**

Create `src/server/actions/opcos.ts`:

```ts
// src/server/actions/opcos.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin } from "@/lib/permissions"
import { createKeycloakOrg } from "@/server/keycloak"
import { recordAdminAction } from "@/server/audit"

function assertGroupAdmin(session: { realmRoles: string[] }) {
  if (!isGroupAdmin(session.realmRoles)) {
    throw new Error("Forbidden: only a group_admin can manage OpCos")
  }
}

// Loads an OpCo by id; throws if missing.
async function loadOpCo(db: ReturnType<typeof getPrisma>, opcoId: string) {
  const opco = await db.opCo.findUnique({ where: { id: opcoId } })
  if (!opco) throw new Error("OpCo not found")
  return opco
}

export async function createOpCo(input: { slug: string; name: string; locale?: string }) {
  const session = await getAppSession()
  assertGroupAdmin(session)

  const db = getPrisma()
  const existing = await db.opCo.findUnique({ where: { slug: input.slug } })
  if (existing) throw new Error(`OpCo slug already exists: ${input.slug}`)

  // Best-effort Keycloak org provisioning; fall back to a placeholder id if unavailable.
  let keycloakOrgId: string
  try {
    keycloakOrgId = await createKeycloakOrg(input.slug, input.name)
  } catch (err) {
    console.warn(`[createOpCo] Keycloak org creation skipped for ${input.slug}:`, err)
    keycloakOrgId = `pending-keycloak-${input.slug}`
  }

  return db.$transaction(async (tx) => {
    const opco = await tx.opCo.create({
      data: { slug: input.slug, name: input.name, locale: input.locale ?? "en", keycloakOrgId },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.create",
      opcoId: opco.id,
      summary: `Created OpCo ${input.slug} (${input.name})`,
    })
    return opco
  })
}
```

- [ ] **Step 5: Run green**

Run: `pnpm vitest run src/test/actions/opcos.test.ts`
Expected: PASS (4 cases). Then `pnpm tsc --noEmit` → PASS. No casts.

(`loadOpCo` is unused until Task 2 — if `tsc`/lint flags it as unused now, that's fine to leave only if lint passes; otherwise add it together with Task 2. Prefer to keep the file lint-clean: if unused-warning blocks, move the `loadOpCo` definition into Task 2's step instead.)

- [ ] **Step 6: Commit**

```bash
git add src/server/keycloak.ts src/server/actions/opcos.ts src/test/actions/opcos.test.ts
git commit -m "feat(opcos): createOpCo with best-effort Keycloak org and audit"
```

---

## Task 2: `renameOpCo` + `archiveOpCo` + `unarchiveOpCo`

**Files:**
- Modify: `src/server/actions/opcos.ts`
- Test: `src/test/actions/opcos.test.ts`

- [ ] **Step 1: Add failing tests**

In `src/test/actions/opcos.test.ts`, extend the import:

```ts
import { createOpCo, renameOpCo, archiveOpCo, unarchiveOpCo } from "@/server/actions/opcos"
```

Append:

```ts
describe("renameOpCo", () => {
  it("rejects a non-group_admin", async () => {
    await expect(renameOpCo("opco-1", "New Name")).rejects.toThrow(/Forbidden/)
  })

  it("renames an OpCo and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-1", slug: "ghana", name: "Ghana" })
    await renameOpCo("opco-1", "Ghana Telecom")
    expect(mockDb.opCo.update).toHaveBeenCalledWith({
      where: { id: "opco-1" },
      data: { name: "Ghana Telecom" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("throws when the OpCo does not exist", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce(null)
    await expect(renameOpCo("missing", "X")).rejects.toThrow(/not found/i)
  })
})

describe("archiveOpCo / unarchiveOpCo", () => {
  it("rejects a non-group_admin archiving", async () => {
    await expect(archiveOpCo("opco-1")).rejects.toThrow(/Forbidden/)
  })

  it("archives an OpCo (sets archivedAt) and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-1", slug: "ghana", name: "Ghana" })
    await archiveOpCo("opco-1")
    expect(mockDb.opCo.update).toHaveBeenCalledWith({
      where: { id: "opco-1" },
      data: { archivedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("unarchives an OpCo (clears archivedAt) and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-1", slug: "ghana", name: "Ghana" })
    await unarchiveOpCo("opco-1")
    expect(mockDb.opCo.update).toHaveBeenCalledWith({
      where: { id: "opco-1" },
      data: { archivedAt: null },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run red**

Run: `pnpm vitest run src/test/actions/opcos.test.ts -t "renameOpCo|archiveOpCo"`
Expected: FAIL — `renameOpCo is not a function` (etc.).

- [ ] **Step 3: Implement**

Append to `src/server/actions/opcos.ts` (the `loadOpCo` helper added in Task 1 is now used):

```ts
export async function renameOpCo(opcoId: string, name: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  return db.$transaction(async (tx) => {
    const updated = await tx.opCo.update({ where: { id: opcoId }, data: { name } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.rename",
      opcoId,
      summary: `Renamed OpCo ${opco.slug} to "${name}"`,
      metadata: { from: opco.name, to: name },
    })
    return updated
  })
}

export async function archiveOpCo(opcoId: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  await db.$transaction(async (tx) => {
    await tx.opCo.update({ where: { id: opcoId }, data: { archivedAt: new Date() } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.archive",
      opcoId,
      summary: `Archived OpCo ${opco.slug}`,
    })
  })
}

export async function unarchiveOpCo(opcoId: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  await db.$transaction(async (tx) => {
    await tx.opCo.update({ where: { id: opcoId }, data: { archivedAt: null } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.unarchive",
      opcoId,
      summary: `Unarchived OpCo ${opco.slug}`,
    })
  })
}
```

- [ ] **Step 4: Run green (FULL file)**

Run: `pnpm vitest run src/test/actions/opcos.test.ts`
Expected: PASS (all create/rename/archive/unarchive cases). Then `pnpm tsc --noEmit` → PASS. No casts.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/opcos.ts src/test/actions/opcos.test.ts
git commit -m "feat(opcos): rename/archive/unarchive OpCo actions with audit"
```

---

## Task 3: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` (Docker available → integration tests run too).
Expected: PASS — all suites incl. the new `opcos.test.ts`.

- [ ] **Step 2: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS / no new errors (pre-existing `security/detect-object-injection` warnings unchanged).

- [ ] **Step 3: Deslop pass**

Run the `deslop` skill over this plan's diff; address findings.

- [ ] **Step 4: Final commit (if deslop produced changes)**

```bash
git add -A
git commit -m "chore(opcos): deslop pass for OpCo lifecycle backend"
```

---

## Self-Review (author's check against the spec)

- **group_admin-only** (spec §Authority Matrix: OpCo lifecycle = group_admin): `assertGroupAdmin` in every action. ✓
- **Create + Keycloak org** (spec §Actions: `createOpCo` + best-effort `createKeycloakOrg`): Task 1, with placeholder fallback. ✓
- **Rename** (spec): `renameOpCo` (Task 2). ✓
- **Archive/unarchive** (spec §Data Model: soft `archivedAt`, never hard-delete): Task 2. ✓
- **Slug uniqueness** guarded in `createOpCo`. ✓
- **Atomic audit** (spec §Transaction & audit pattern): every mutation wraps writes + `recordAdminAction` in `$transaction`. ✓
- **Out of scope**: OpCo-management UI (Plan F); reconciling the placeholder `keycloakOrgId` against a live Keycloak (future).
