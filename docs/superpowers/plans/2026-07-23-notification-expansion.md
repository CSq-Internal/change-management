# Notification Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send in-app and email notifications for every meaningful action in the change-request flow, not just the five moments wired today.

**Architecture:** A central `resolveAudience(type, change, actorId)` maps each event type to role-based groups, so call sites say *what happened* rather than *who to tell*. A `notifyChange(type, changeId, ctx)` facade loads the change once, resolves and dedupes the audience, applies per-event channel defaults then stored preferences, writes a `NotificationDispatch` ledger row, and fans out. One generic `ChangeEventEmail` renders all thirteen new events; the five existing bespoke templates are untouched. Two cron-driven reminders ride the existing `/api/cron/sla` sweep.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma v7 + `@prisma/adapter-pg`, React Email (`@react-email/components`), Vitest + React Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-23-notification-expansion-design.md`

**Depends on:** Spec A (`2026-07-23-requester-selected-approvers-design.md`), merged to `dev` as `273ec4d`. This plan builds on `getRoutedApprovers` / `getNamedApprovers` as they exist after that merge.

## Global Constraints

- Use `pnpm` for every command. `pnpm-lock.yaml` is authoritative; there is no `package-lock.json`.
- All user-visible copy goes through `src/lib/i18n.ts` in **both** the EN and FR maps. Notification titles/bodies and chat text live in `src/lib/notifications.ts`, which carries its own inline EN/FR branches — follow that file's existing pattern, do not route it through `i18n.ts`.
- Server action errors stay plain English strings.
- **Notifications are best-effort and must never fail a domain operation.** Every call site wraps in `.catch(() => {})`; every fan-out uses `Promise.allSettled`.
- Notifications fire **after** a `$transaction` commits, never inside one.
- The five existing event types must keep their exact current behaviour: `{ email: true, in_app: true }` defaults, same recipients, same bespoke templates.
- `CHAT_BROADCAST_TYPES` grows by exactly two: `change_implemented`, `change_verified`.
- One additive migration (`NotificationDispatch`). No backfill. No changes to existing tables.
- Deep links point at `/changes/<id>` — the live change-detail route. Bare `/changes` is a redirect.
- Path alias `@/*` maps to `src/*`.
- Match each file's existing style, comment density, and naming idiom.
- `pnpm tsc --noEmit`, `pnpm lint` (0 errors), and the full `pnpm test` must be clean before each commit.
- Do NOT add a `Co-Authored-By` trailer to commit messages.

---

### Task 1: Event catalog, channel defaults, and copy

The pure, DB-free foundation. Everything else consumes it.

**Files:**
- Modify: `src/lib/notifications.ts`
- Test: `src/test/lib/notifications.test.ts` (extend)

**Interfaces:**
- Produces:
  - `NotifyEventType` — union of 18 types
  - `NOTIFY_EVENT_TYPES: NotifyEventType[]` — all 18
  - `NOTIFY_EVENT_GROUPS: { key: string; types: NotifyEventType[] }[]` — 4 groups covering all 18
  - `DEFAULT_CHANNELS: Record<NotifyEventType, { email: boolean; in_app: boolean }>`
  - `notificationContent(type, changeTitle, ctx, locale): { title: string; body: string }`
  - `isChannelEnabled(prefs, userId, type, channel): boolean` — now falls back to `DEFAULT_CHANNELS`
  - `NotifyContext` — extended with `actorName`, `role`, `outcome`, `windowFrom`, `windowTo`, `dueAt`

- [ ] **Step 1: Write the failing tests**

Append to `src/test/lib/notifications.test.ts`:

```ts
import {
  NOTIFY_EVENT_TYPES, NOTIFY_EVENT_GROUPS, DEFAULT_CHANNELS, CHAT_BROADCAST_TYPES,
  notificationContent, isChannelEnabled, type NotifyEventType,
} from "@/lib/notifications"

describe("event catalog", () => {
  it("has 18 event types", () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(18)
  })

  it("groups cover every type exactly once", () => {
    const grouped = NOTIFY_EVENT_GROUPS.flatMap((g) => g.types)
    expect(grouped).toHaveLength(NOTIFY_EVENT_TYPES.length)
    expect(new Set(grouped).size).toBe(NOTIFY_EVENT_TYPES.length)
    for (const t of NOTIFY_EVENT_TYPES) expect(grouped).toContain(t)
  })

  it("DEFAULT_CHANNELS has an entry for every type", () => {
    for (const t of NOTIFY_EVENT_TYPES) expect(DEFAULT_CHANNELS[t]).toBeDefined()
  })

  it("preserves the five pre-existing types as email+in-app on", () => {
    const existing: NotifyEventType[] = [
      "approval_requested", "change_approved", "change_rejected", "sla_escalated", "emergency_submitted",
    ]
    for (const t of existing) expect(DEFAULT_CHANNELS[t]).toEqual({ email: true, in_app: true })
  })

  it("ambient lifecycle events default to in-app only", () => {
    const ambient: NotifyEventType[] = [
      "change_closed", "change_reopened", "change_cancelled", "change_rescheduled", "assignee_removed",
    ]
    for (const t of ambient) expect(DEFAULT_CHANNELS[t]).toEqual({ email: false, in_app: true })
  })

  it("subject-of-the-event types default to email on", () => {
    const loud: NotifyEventType[] = [
      "change_submitted", "change_implemented", "change_verified",
      "assignee_added", "retro_approved", "retro_rejected", "retro_overdue", "approver_nudge",
    ]
    for (const t of loud) expect(DEFAULT_CHANNELS[t].email).toBe(true)
  })

  it("broadcasts exactly six types to chat", () => {
    expect([...CHAT_BROADCAST_TYPES].sort()).toEqual([
      "change_approved", "change_implemented", "change_rejected",
      "change_verified", "emergency_submitted", "sla_escalated",
    ])
  })
})

describe("isChannelEnabled — DEFAULT_CHANNELS fallback", () => {
  it("falls back to the per-event default when no row exists", () => {
    const prefs = new Map<string, boolean>()
    expect(isChannelEnabled(prefs, "u1", "change_closed", "email")).toBe(false)
    expect(isChannelEnabled(prefs, "u1", "change_closed", "in_app")).toBe(true)
    expect(isChannelEnabled(prefs, "u1", "change_implemented", "email")).toBe(true)
  })

  it("a stored row always wins over the default", () => {
    const prefs = new Map([["u1:change_closed:email", true], ["u1:change_implemented:email", false]])
    expect(isChannelEnabled(prefs, "u1", "change_closed", "email")).toBe(true)
    expect(isChannelEnabled(prefs, "u1", "change_implemented", "email")).toBe(false)
  })
})

describe("notificationContent — new types", () => {
  const newTypes: NotifyEventType[] = [
    "change_submitted", "change_implemented", "change_verified", "change_closed",
    "change_reopened", "change_cancelled", "change_rescheduled", "assignee_added",
    "assignee_removed", "retro_approved", "retro_rejected", "retro_overdue", "approver_nudge",
  ]

  it("returns non-empty EN copy for every new type", () => {
    for (const t of newTypes) {
      const { title, body } = notificationContent(t, "Router upgrade", {}, "en")
      expect(title.length).toBeGreaterThan(0)
      expect(body).toContain("Router upgrade")
    }
  })

  it("returns non-empty FR copy distinct from EN for every new type", () => {
    for (const t of newTypes) {
      const en = notificationContent(t, "Router upgrade", {}, "en")
      const fr = notificationContent(t, "Router upgrade", {}, "fr")
      expect(fr.title.length).toBeGreaterThan(0)
      expect(fr.title).not.toBe(en.title)
    }
  })

  it("interpolates the reschedule window", () => {
    const { body } = notificationContent(
      "change_rescheduled", "Router upgrade",
      { windowFrom: "12 Aug 22:00", windowTo: "19 Aug 22:00" }, "en",
    )
    expect(body).toContain("19 Aug 22:00")
  })

  it("interpolates the assignee role", () => {
    const { body } = notificationContent("assignee_added", "Router upgrade", { role: "approver" }, "en")
    expect(body).toContain("approver")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/lib/notifications.test.ts`
Expected: FAIL — `NOTIFY_EVENT_GROUPS` and `DEFAULT_CHANNELS` are not exported; the catalog has 5 types.

- [ ] **Step 3: Write the implementation**

Replace the type/constant block at the top of `src/lib/notifications.ts`:

```ts
export type NotifyEventType =
  // pre-existing
  | "approval_requested" | "change_approved" | "change_rejected"
  | "sla_escalated" | "emergency_submitted"
  // lifecycle
  | "change_submitted" | "change_implemented" | "change_verified"
  | "change_closed" | "change_reopened" | "change_cancelled" | "change_rescheduled"
  // assignment
  | "assignee_added" | "assignee_removed"
  // emergency / compliance
  | "retro_approved" | "retro_rejected" | "retro_overdue" | "approver_nudge"

export type NotifyChannel = "email" | "in_app"

export type NotifyContext = {
  requesterName?: string
  newStatus?: string
  level?: number
  riskLevel?: string
  /** Who performed the action, for copy like "Kofi marked this implemented". */
  actorName?: string
  /** assignee_added / assignee_removed — "approver" or "implementer". */
  role?: string
  /** change_verified — the PIR outcome. */
  outcome?: string
  /** change_rescheduled — human-readable old and new windows. */
  windowFrom?: string
  windowTo?: string
  /** retro_overdue — when the retrospective approval is due. */
  dueAt?: string
  /** Free-text note (rejection comment, PIR summary, status-change note). */
  note?: string
}

export const NOTIFY_EVENT_TYPES: NotifyEventType[] = [
  "approval_requested", "approver_nudge", "change_approved", "change_rejected",
  "change_submitted", "change_implemented", "change_verified", "change_closed",
  "change_reopened", "change_cancelled", "change_rescheduled",
  "assignee_added", "assignee_removed",
  "emergency_submitted", "sla_escalated", "retro_approved", "retro_rejected", "retro_overdue",
]

/** Preference-matrix sections. 18 types x 2 channels is unusable as a flat list. */
export const NOTIFY_EVENT_GROUPS: { key: string; types: NotifyEventType[] }[] = [
  { key: "approvals", types: ["approval_requested", "approver_nudge", "change_approved", "change_rejected"] },
  { key: "lifecycle", types: ["change_submitted", "change_implemented", "change_verified", "change_closed", "change_reopened", "change_cancelled", "change_rescheduled"] },
  { key: "assignment", types: ["assignee_added", "assignee_removed"] },
  { key: "emergency", types: ["emergency_submitted", "sla_escalated", "retro_approved", "retro_rejected", "retro_overdue"] },
]

/**
 * Channel defaults applied when a user has no stored preference row.
 *
 * Email is on where the recipient is the *subject* of the event (their request moved,
 * they were named on a change, something needs their action) and off for ambient events
 * they merely have a stake in — those stay in-app so the feed remains complete without
 * flooding inboxes. The five pre-existing types keep `{ email: true, in_app: true }`,
 * which is exactly what the previous blanket `true` fallback produced.
 */
export const DEFAULT_CHANNELS: Record<NotifyEventType, { email: boolean; in_app: boolean }> = {
  approval_requested:  { email: true,  in_app: true },
  change_approved:     { email: true,  in_app: true },
  change_rejected:     { email: true,  in_app: true },
  sla_escalated:       { email: true,  in_app: true },
  emergency_submitted: { email: true,  in_app: true },

  change_submitted:    { email: true,  in_app: true },
  change_implemented:  { email: true,  in_app: true },
  change_verified:     { email: true,  in_app: true },
  assignee_added:      { email: true,  in_app: true },
  retro_approved:      { email: true,  in_app: true },
  retro_rejected:      { email: true,  in_app: true },
  retro_overdue:       { email: true,  in_app: true },
  approver_nudge:      { email: true,  in_app: true },

  change_closed:       { email: false, in_app: true },
  change_reopened:     { email: false, in_app: true },
  change_cancelled:    { email: false, in_app: true },
  change_rescheduled:  { email: false, in_app: true },
  assignee_removed:    { email: false, in_app: true },
}

export const CHAT_BROADCAST_TYPES: NotifyEventType[] = [
  "emergency_submitted", "sla_escalated", "change_approved", "change_rejected",
  "change_implemented", "change_verified",
]
```

Replace `isChannelEnabled`:

```ts
export function isChannelEnabled(
  prefs: Map<string, boolean>, userId: string, type: NotifyEventType, channel: NotifyChannel
): boolean {
  const key = `${userId}:${type}:${channel}`
  if (prefs.has(key)) return prefs.get(key)!
  return DEFAULT_CHANNELS[type][channel]
}
```

Extend `notificationContent` with the thirteen new cases in both locale branches. Add to the **FR** switch, before the existing cases:

```ts
      case "change_submitted":
        return { title: "Demande soumise", body: `Votre demande « ${changeTitle} » a été soumise pour approbation.` }
      case "change_implemented":
        return { title: "Changement mis en œuvre", body: `${ctx.actorName ?? "Quelqu'un"} a marqué « ${changeTitle} » comme mis en œuvre.` }
      case "change_verified":
        return { title: "Changement vérifié", body: `« ${changeTitle} » a été vérifié${ctx.outcome ? ` (${ctx.outcome})` : ""}.` }
      case "change_closed":
        return { title: "Changement clôturé", body: `« ${changeTitle} » a été clôturé.` }
      case "change_reopened":
        return { title: "Changement rouvert", body: `« ${changeTitle} » a été rouvert et repasse en brouillon.` }
      case "change_cancelled":
        return { title: "Changement annulé", body: `« ${changeTitle} » a été annulé.` }
      case "change_rescheduled":
        return { title: "Changement replanifié", body: `« ${changeTitle} » a été replanifié${ctx.windowFrom ? ` de ${ctx.windowFrom}` : ""}${ctx.windowTo ? ` à ${ctx.windowTo}` : ""}.` }
      case "assignee_added":
        return { title: "Vous avez été désigné", body: `Vous avez été désigné ${ctx.role ?? "intervenant"} sur « ${changeTitle} ».` }
      case "assignee_removed":
        return { title: "Désignation retirée", body: `Vous n'êtes plus ${ctx.role ?? "intervenant"} sur « ${changeTitle} ».` }
      case "retro_approved":
        return { title: "Approbation rétrospective", body: `« ${changeTitle} » a reçu son approbation rétrospective.` }
      case "retro_rejected":
        return { title: "Approbation rétrospective refusée", body: `L'approbation rétrospective de « ${changeTitle} » a été refusée.` }
      case "retro_overdue":
        return { title: "Approbation rétrospective en retard", body: `« ${changeTitle} » attend toujours son approbation rétrospective${ctx.dueAt ? ` (échéance ${ctx.dueAt})` : ""}.` }
      case "approver_nudge":
        return { title: "Approbation en attente", body: `« ${changeTitle} » attend toujours votre approbation.` }
```

And the matching **EN** cases, before the existing ones:

```ts
    case "change_submitted":
      return { title: "Request submitted", body: `Your request "${changeTitle}" has been submitted for approval.` }
    case "change_implemented":
      return { title: "Change implemented", body: `${ctx.actorName ?? "Someone"} marked "${changeTitle}" as implemented.` }
    case "change_verified":
      return { title: "Change verified", body: `"${changeTitle}" was verified${ctx.outcome ? ` (${ctx.outcome})` : ""}.` }
    case "change_closed":
      return { title: "Change closed", body: `"${changeTitle}" was closed.` }
    case "change_reopened":
      return { title: "Change reopened", body: `"${changeTitle}" was reopened and is back in draft.` }
    case "change_cancelled":
      return { title: "Change cancelled", body: `"${changeTitle}" was cancelled.` }
    case "change_rescheduled":
      return { title: "Change rescheduled", body: `"${changeTitle}" was rescheduled${ctx.windowFrom ? ` from ${ctx.windowFrom}` : ""}${ctx.windowTo ? ` to ${ctx.windowTo}` : ""}.` }
    case "assignee_added":
      return { title: "You were assigned", body: `You were named ${ctx.role ?? "an assignee"} on "${changeTitle}".` }
    case "assignee_removed":
      return { title: "Assignment removed", body: `You are no longer ${ctx.role ?? "an assignee"} on "${changeTitle}".` }
    case "retro_approved":
      return { title: "Retrospective approval recorded", body: `"${changeTitle}" received its retrospective approval.` }
    case "retro_rejected":
      return { title: "Retrospective approval rejected", body: `The retrospective approval for "${changeTitle}" was rejected.` }
    case "retro_overdue":
      return { title: "Retrospective approval overdue", body: `"${changeTitle}" is still awaiting retrospective approval${ctx.dueAt ? ` (due ${ctx.dueAt})` : ""}.` }
    case "approver_nudge":
      return { title: "Approval still pending", body: `"${changeTitle}" is still waiting for your approval.` }
```

Add the two new chat broadcast strings to `chatMessageText`, FR branch:

```ts
      case "change_implemented": return `🚀 Changement mis en œuvre : « ${changeTitle} »`
      case "change_verified": return `🔎 Changement vérifié : « ${changeTitle} »`
```

EN branch:

```ts
    case "change_implemented": return `🚀 Change implemented: "${changeTitle}"`
    case "change_verified": return `🔎 Change verified: "${changeTitle}"`
```

`chatMessageText` switches on `NotifyEventType` and TypeScript will now demand every case. The types that never broadcast still need arms to satisfy exhaustiveness — add a shared fallback at the end of each locale branch rather than 11 dead cases:

```ts
    default: return `"${changeTitle}"`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/lib/notifications.test.ts`
Expected: PASS — pre-existing tests plus 11 new ones.

- [ ] **Step 5: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`

Expected: clean. `notification-prefs.ts` and the prefs client still hardcode `?? true`; that is corrected in Task 8 and does not break anything here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/test/lib/notifications.test.ts
git commit -m "feat(notifications): 18-event catalog, per-event channel defaults

Adds 13 lifecycle/assignment/compliance event types with EN+FR copy, groups
them into four preference sections, and replaces isChannelEnabled's blanket
true fallback with a per-event DEFAULT_CHANNELS map. The five pre-existing
types keep email+in-app on, so current behaviour is unchanged. Chat broadcast
grows by change_implemented and change_verified."
```

---

### Task 2: `NotificationDispatch` send ledger

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260723120000_add_notification_dispatch/migration.sql`

**Interfaces:**
- Produces: Prisma model `NotificationDispatch` with fields `id`, `userId`, `changeId`, `type`, `sentAt`, indexed on `(userId, changeId, type, sentAt)`.

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`, after the `ChatWebhook` model:

```prisma
/// Send ledger. Written after every fan-out attempt; read by the reminder sweep so a
/// recurring nudge fires at most once per interval. Intentionally relation-free — it is
/// an append-only audit of what was sent, not a foreign-key-enforced join table.
model NotificationDispatch {
  id       String   @id @default(cuid())
  userId   String
  changeId String
  type     String
  sentAt   DateTime @default(now())

  @@index([userId, changeId, type, sentAt])
}
```

- [ ] **Step 2: Hand-author the migration**

`pnpm prisma migrate dev` needs a live database plus a shadow database. Local Postgres is not assumed to be running, so write the SQL Prisma would emit and let `prisma migrate deploy` apply it in CI/prod.

Create `prisma/migrations/20260723120000_add_notification_dispatch/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDispatch_userId_changeId_type_sentAt_idx" ON "NotificationDispatch"("userId", "changeId", "type", "sentAt");
```

- [ ] **Step 3: Regenerate the client and verify the model is typed**

Run: `pnpm prisma generate`
Expected: `Generated Prisma Client`.

Run: `pnpm prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Type-check and full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean — nothing consumes the model yet.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): NotificationDispatch send ledger

Append-only record of notification fan-outs, keyed (userId, changeId, type).
Backs per-interval idempotency for the cron reminders. Additive, no backfill,
no changes to existing tables. Migration is hand-authored because migrate dev
needs a live shadow DB; migrate deploy applies it in CI/prod."
```

---

### Task 3: Audience resolver

**Files:**
- Create: `src/server/audience.ts`
- Test: `src/test/server/audience.test.ts`

**Interfaces:**
- Consumes: `getRoutedApprovers(change)` and `getNamedApprovers(changeId)` from `@/server/approval-authority`; `NotifyRecipient` from `@/server/notify`.
- Produces:
  - `AudienceRole = "requester" | "assignees" | "voters" | "approversPending" | "opcoAdmins" | "groupCab"`
  - `AUDIENCE: Record<NotifyEventType, AudienceRole[]>`
  - `resolveAudience(type, change, actorId?): Promise<NotifyRecipient[]>` where
    `change: { id: string; opcoId: string; infrastructureType: string; requesterId: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/test/server/audience.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  user: { findMany: vi.fn() },
  changeAssignee: { findMany: vi.fn() },
  approval: { findMany: vi.fn() },
  userOpCoAssignment: { findMany: vi.fn() },
  cABMembership: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { getRoutedApprovers, getNamedApprovers } = vi.hoisted(() => ({
  getRoutedApprovers: vi.fn(),
  getNamedApprovers: vi.fn(),
}))
vi.mock("@/server/approval-authority", () => ({ getRoutedApprovers, getNamedApprovers }))

import { resolveAudience, AUDIENCE } from "@/server/audience"
import { NOTIFY_EVENT_TYPES } from "@/lib/notifications"

const CHANGE = { id: "c1", opcoId: "opco-1", infrastructureType: "Wifi", requesterId: "u-req" }
const user = (id: string, active = true) => ({ id, name: id, email: `${id}@c.com`, isActive: active })

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockResolvedValue([])
  mockDb.approval.findMany.mockResolvedValue([])
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
  getRoutedApprovers.mockResolvedValue([])
  getNamedApprovers.mockResolvedValue([])
})

describe("AUDIENCE table", () => {
  // assignee_added / assignee_removed target one specific person known only to the
  // caller, so they carry empty role lists by design and pass recipients explicitly.
  const EXPLICIT_RECIPIENT_TYPES = ["assignee_added", "assignee_removed"]

  it("defines an entry for every event type", () => {
    for (const t of NOTIFY_EVENT_TYPES) {
      expect(AUDIENCE[t], `missing audience for ${t}`).toBeDefined()
    }
  })

  it("every resolver-driven type has at least one role group", () => {
    for (const t of NOTIFY_EVENT_TYPES) {
      if (EXPLICIT_RECIPIENT_TYPES.includes(t)) continue
      expect(AUDIENCE[t].length, `empty audience for ${t}`).toBeGreaterThan(0)
    }
  })

  it("the explicit-recipient types resolve to nobody on their own", async () => {
    for (const t of EXPLICIT_RECIPIENT_TYPES) {
      expect(AUDIENCE[t as keyof typeof AUDIENCE]).toEqual([])
    }
  })
})

describe("resolveAudience", () => {
  it("change_submitted resolves to the requester", async () => {
    mockDb.user.findMany.mockResolvedValue([user("u-req")])
    const out = await resolveAudience("change_submitted", CHANGE)
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("suppresses the actor from their own event", async () => {
    mockDb.user.findMany.mockResolvedValue([user("u-req"), user("u-other")])
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: "u-other" }])
    const out = await resolveAudience("change_implemented", CHANGE, "u-req")
    expect(out.map((r) => r.userId)).toEqual(["u-other"])
  })

  it("does NOT suppress the actor for change_submitted — it is a receipt", async () => {
    mockDb.user.findMany.mockResolvedValue([user("u-req")])
    const out = await resolveAudience("change_submitted", CHANGE, "u-req")
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("dedupes a user who appears in two role groups", async () => {
    mockDb.user.findMany.mockResolvedValue([user("u-req")])
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: "u-req" }])
    mockDb.approval.findMany.mockResolvedValue([{ approverId: "u-req" }])
    const out = await resolveAudience("change_implemented", CHANGE)
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("drops inactive users", async () => {
    mockDb.user.findMany.mockResolvedValue([user("u-req", false)])
    const out = await resolveAudience("change_submitted", CHANGE)
    expect(out).toEqual([])
  })

  it("approversPending excludes users who have already voted", async () => {
    getRoutedApprovers.mockResolvedValue([{ id: "a1" }, { id: "a2" }])
    getNamedApprovers.mockResolvedValue([{ id: "a3" }])
    mockDb.approval.findMany.mockResolvedValue([{ approverId: "a2" }])
    mockDb.user.findMany.mockResolvedValue([user("a1"), user("a3")])
    const out = await resolveAudience("approver_nudge", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["a1", "a3"])
  })

  it("retro_overdue reaches the requester and the group CAB", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cab1" }])
    mockDb.user.findMany.mockResolvedValue([user("u-req"), user("cab1")])
    const out = await resolveAudience("retro_overdue", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["cab1", "u-req"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
  })

  it("change_verified reaches the requester and OpCo admins", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "adm1" }])
    mockDb.user.findMany.mockResolvedValue([user("u-req"), user("adm1")])
    const out = await resolveAudience("change_verified", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["adm1", "u-req"])
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", role: "admin", isActive: true }) })
    )
  })

  it("returns an empty list rather than throwing when no one matches", async () => {
    mockDb.user.findMany.mockResolvedValue([])
    const out = await resolveAudience("change_closed", CHANGE)
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/server/audience.test.ts`
Expected: FAIL — cannot resolve `@/server/audience`.

- [ ] **Step 3: Write the implementation**

Create `src/server/audience.ts`:

```ts
// src/server/audience.ts
// Maps an event type to the people who should hear about it. Call sites say what
// happened; this decides who to tell.
import { getPrisma } from "@/server/db"
import { getRoutedApprovers, getNamedApprovers } from "@/server/approval-authority"
import type { NotifyEventType } from "@/lib/notifications"
import type { NotifyRecipient } from "@/server/notify"

export type AudienceRole =
  | "requester" | "assignees" | "voters" | "approversPending" | "opcoAdmins" | "groupCab"

export type AudienceChange = {
  id: string
  opcoId: string
  infrastructureType: string
  requesterId: string
}

export const AUDIENCE: Record<NotifyEventType, AudienceRole[]> = {
  approval_requested:  ["approversPending"],
  approver_nudge:      ["approversPending"],
  change_approved:     ["requester"],
  change_rejected:     ["requester"],

  change_submitted:    ["requester"],
  change_implemented:  ["requester", "assignees", "voters"],
  change_verified:     ["requester", "opcoAdmins"],
  change_closed:       ["requester", "assignees"],
  change_reopened:     ["requester", "voters"],
  change_cancelled:    ["requester", "assignees", "voters"],
  change_rescheduled:  ["requester", "assignees", "voters"],

  assignee_added:      [],
  assignee_removed:    [],

  emergency_submitted: ["groupCab"],
  sla_escalated:       ["opcoAdmins"],
  retro_approved:      ["requester", "opcoAdmins"],
  retro_rejected:      ["requester", "opcoAdmins"],
  retro_overdue:       ["requester", "groupCab"],
}

/**
 * assignee_added / assignee_removed target one specific person, who is known only to the
 * caller (the diff of the assignee set). They pass recipients explicitly rather than
 * going through the resolver, hence the empty role lists above.
 */

/** Events where the actor is deliberately NOT suppressed — the notification IS the receipt. */
const RECEIPT_TYPES: NotifyEventType[] = ["change_submitted"]

async function idsForRole(role: AudienceRole, change: AudienceChange): Promise<string[]> {
  const db = getPrisma()
  switch (role) {
    case "requester":
      return [change.requesterId]
    case "assignees": {
      const rows = await db.changeAssignee.findMany({
        where: { changeId: change.id }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
    case "voters": {
      const rows = await db.approval.findMany({
        where: { changeId: change.id }, select: { approverId: true },
      })
      return rows.map((r) => r.approverId)
    }
    case "approversPending": {
      const [routed, named, votes] = await Promise.all([
        getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId }),
        getNamedApprovers(change.id),
        db.approval.findMany({ where: { changeId: change.id }, select: { approverId: true } }),
      ])
      const voted = new Set(votes.map((v) => v.approverId))
      return [...routed, ...named].map((u) => u.id).filter((id) => !voted.has(id))
    }
    case "opcoAdmins": {
      const rows = await db.userOpCoAssignment.findMany({
        where: { opcoId: change.opcoId, role: "admin", isActive: true }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
    case "groupCab": {
      const rows = await db.cABMembership.findMany({
        where: { opcoId: null, isActive: true }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
  }
}

export async function resolveAudience(
  type: NotifyEventType,
  change: AudienceChange,
  actorId?: string,
): Promise<NotifyRecipient[]> {
  const roles = AUDIENCE[type] ?? []
  if (roles.length === 0) return []

  const idLists = await Promise.all(roles.map((r) => idsForRole(r, change)))
  const ids = new Set(idLists.flat())
  // The actor already knows what they just did. The exception is a receipt, where telling
  // them is the entire point.
  if (actorId && !RECEIPT_TYPES.includes(type)) ids.delete(actorId)
  if (ids.size === 0) return []

  const db = getPrisma()
  const users = await db.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, email: true, isActive: true },
  })
  return users
    .filter((u) => u.isActive)
    .map((u) => ({ userId: u.id, email: u.email, name: u.name }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/server/audience.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/audience.ts src/test/server/audience.test.ts
git commit -m "feat(notifications): central audience resolver

Maps each event type to role groups (requester, assignees, voters,
approversPending, opcoAdmins, groupCab), resolves and dedupes them, drops
inactive users, and suppresses the actor except on change_submitted, which is
a receipt. assignee_added/removed target one known person and pass recipients
explicitly, so they carry empty role lists."
```

---

### Task 4: Generic `ChangeEventEmail` template

**Files:**
- Create: `src/emails/change-event.tsx`
- Modify: `src/server/email.tsx`
- Test: `src/test/emails/change-event.test.tsx`

**Interfaces:**
- Consumes: `EmailLayout`, `CtaButton`, `Pill` from `@/emails/layout`; `EMAIL_BASE_URL` from `@/emails/config`.
- Produces:
  - `ChangeEventEmail` default export with props `{ headline, intro, pill?, rows, note?, ctaHref, ctaLabel, lang }`
  - `sendChangeEventEmail(opts: { to, subject, headline, intro, pill?, rows, note?, changeId, locale? })` in `src/server/email.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/test/emails/change-event.test.tsx`:

```tsx
import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import * as React from "react"
import ChangeEventEmail from "@/emails/change-event"

const base = {
  headline: "Change implemented",
  intro: "Kofi marked your change as implemented.",
  rows: [["Change", "Router upgrade"], ["OpCo", "Ghana"]] as [string, string][],
  ctaHref: "http://localhost:3000/changes/abc123",
  ctaLabel: "View request",
}

describe("ChangeEventEmail", () => {
  it("renders EN with headline, intro, rows and CTA", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="en" />)
    expect(html).toContain("Change implemented")
    expect(html).toContain("Kofi marked your change as implemented.")
    expect(html).toContain("Router upgrade")
    expect(html).toContain("Ghana")
    expect(html).toContain("/changes/abc123")
  })

  it("renders FR without throwing", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="fr" headline="Changement mis en œuvre" />)
    expect(html).toContain("Changement mis en œuvre")
  })

  it("renders a plain-text variant", async () => {
    const text = await render(<ChangeEventEmail {...base} lang="en" />, { plainText: true })
    expect(text).toContain("Router upgrade")
  })

  it("renders the optional pill and note when supplied", async () => {
    const html = await render(
      <ChangeEventEmail {...base} lang="en" pill={{ tone: "approved", label: "implemented" }} note="Backout not required." />
    )
    expect(html).toContain("implemented")
    expect(html).toContain("Backout not required.")
  })

  it("omits the note block when not supplied", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="en" />)
    expect(html).not.toContain("Backout not required.")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/emails/change-event.test.tsx`
Expected: FAIL — cannot resolve `@/emails/change-event`.

- [ ] **Step 3: Write the template**

Create `src/emails/change-event.tsx`:

```tsx
import { Heading, Text, Section, Row, Column, Hr } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import type { Language } from "@/lib/i18n"

export interface ChangeEventEmailProps {
  headline: string
  intro: string
  pill?: { tone: string; label: string }
  /** Label/value pairs rendered as a detail table. */
  rows: [string, string][]
  note?: string
  ctaHref: string
  ctaLabel: string
  lang: Language
}

/**
 * One parameterized template behind every notification added by the expansion. The five
 * pre-existing transactional emails keep their bespoke templates.
 */
export default function ChangeEventEmail({
  headline, intro, pill, rows, note, ctaHref, ctaLabel, lang,
}: ChangeEventEmailProps) {
  return (
    <EmailLayout lang={lang} previewText={intro}>
      <Heading className="text-xl font-semibold text-slate-900">{headline}</Heading>
      <Text className="text-sm text-slate-700">
        {intro}{" "}
        {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      </Text>

      <Hr className="my-4 border-slate-200" />
      <Section>
        {rows.map(([label, value]) => (
          <Row key={label} className="mb-1">
            <Column className="w-1/3 align-top text-xs font-medium text-slate-500">{label}</Column>
            <Column className="text-sm text-slate-800">{value}</Column>
          </Row>
        ))}
      </Section>

      {note ? (
        <Text className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{note}</Text>
      ) : null}

      <CtaButton href={ctaHref}>{ctaLabel}</CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 4: Add the sender**

Append to `src/server/email.tsx`, and add `import ChangeEventEmail from "@/emails/change-event"` and `import { EMAIL_BASE_URL } from "@/emails/config"` to the imports:

```tsx
export async function sendChangeEventEmail(opts: {
  to: string
  subject: string
  headline: string
  intro: string
  pill?: { tone: string; label: string }
  rows: [string, string][]
  note?: string
  changeId: string
  locale?: Language
}) {
  const fr = opts.locale === "fr"
  const el = (
    <ChangeEventEmail
      headline={opts.headline}
      intro={opts.intro}
      pill={opts.pill}
      rows={opts.rows}
      note={opts.note}
      ctaHref={`${EMAIL_BASE_URL}/changes/${opts.changeId}`}
      ctaLabel={fr ? "Voir la demande" : "View request"}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, opts.subject, html, text)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/test/emails/change-event.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 6: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/emails/change-event.tsx src/server/email.tsx src/test/emails/change-event.test.tsx
git commit -m "feat(email): generic ChangeEventEmail template

One parameterized template — headline, intro, optional status pill, detail
table, optional note, deep-link CTA — behind all 13 new notification types,
built on the existing EmailLayout/CtaButton/Pill primitives. The five bespoke
transactional templates are untouched."
```

---

### Task 5: `notifyChange` facade and ledger writes

**Files:**
- Modify: `src/server/notify.ts`
- Test: `src/test/server/notify.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveAudience` (Task 3), `sendChangeEventEmail` (Task 4), `DEFAULT_CHANNELS` / `notificationContent` (Task 1).
- Produces:
  - `notifyChange(type: NotifyEventType, changeId: string, ctx?: NotifyContext & { actorId?: string; recipients?: NotifyRecipient[] }): Promise<void>`
  - `notifyEvent` keeps its existing signature and behaviour, plus ledger writes.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/server/notify.test.ts` — match the file's existing mock style:

```ts
describe("notifyChange", () => {
  it("resolves the audience and writes an in-app notification", async () => {
    // change lookup + audience resolution are mocked at the module boundary; this asserts
    // notifyChange threads them into a notification row.
    const { notifyChange } = await import("@/server/notify")
    expect(typeof notifyChange).toBe("function")
  })
})
```

Replace that placeholder with the real suite once the mock shape is known. Concretely, create `src/test/server/notify-change.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  changeRequest: { findUnique: vi.fn() },
  notificationPreference: { findMany: vi.fn() },
  notification: { create: vi.fn() },
  notificationDispatch: { create: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
  chatWebhook: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { resolveAudience } = vi.hoisted(() => ({ resolveAudience: vi.fn() }))
vi.mock("@/server/audience", () => ({ resolveAudience }))

const { sendChangeEventEmail } = vi.hoisted(() => ({ sendChangeEventEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/email", () => ({
  sendChangeEventEmail,
  sendApprovalRequestEmail: vi.fn(), sendStatusChangeEmail: vi.fn(),
  sendSlaEscalationEmail: vi.fn(), sendEmergencyAlertEmail: vi.fn(),
}))

import { notifyChange } from "@/server/notify"

const CHANGE = {
  id: "c1", title: "Router upgrade", opcoId: "opco-1", requesterId: "u-req",
  infrastructureType: "Wifi", riskLevel: "low",
  plannedStart: null, plannedEnd: null,
  opco: { name: "Ghana", locale: "en" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findUnique.mockResolvedValue(CHANGE)
  mockDb.notificationPreference.findMany.mockResolvedValue([])
  mockDb.notification.create.mockResolvedValue({})
  mockDb.notificationDispatch.create.mockResolvedValue({})
  mockDb.user.findMany.mockResolvedValue([{ id: "u1", locale: "en" }])
  mockDb.opCo.findUnique.mockResolvedValue({ locale: "en" })
  mockDb.chatWebhook.findMany.mockResolvedValue([])
  resolveAudience.mockResolvedValue([{ userId: "u1", email: "u1@c.com", name: "U One" }])
})

describe("notifyChange", () => {
  it("writes an in-app notification for the resolved audience", async () => {
    await notifyChange("change_implemented", "c1")
    expect(resolveAudience).toHaveBeenCalledWith(
      "change_implemented",
      expect.objectContaining({ id: "c1", opcoId: "opco-1", requesterId: "u-req" }),
      undefined,
    )
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", type: "change_implemented", changeId: "c1" }),
      })
    )
  })

  it("sends the generic email for a new event type", async () => {
    await notifyChange("change_implemented", "c1")
    expect(sendChangeEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u1@c.com", changeId: "c1" })
    )
  })

  it("honours DEFAULT_CHANNELS — no email for an ambient event", async () => {
    await notifyChange("change_closed", "c1")
    expect(mockDb.notification.create).toHaveBeenCalled()
    expect(sendChangeEventEmail).not.toHaveBeenCalled()
  })

  it("a stored preference overrides the default", async () => {
    mockDb.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "change_closed", channel: "email", enabled: true },
    ])
    await notifyChange("change_closed", "c1")
    expect(sendChangeEventEmail).toHaveBeenCalled()
  })

  it("writes a ledger row per recipient", async () => {
    await notifyChange("change_implemented", "c1")
    expect(mockDb.notificationDispatch.create).toHaveBeenCalledWith({
      data: { userId: "u1", changeId: "c1", type: "change_implemented" },
    })
  })

  it("passes actorId through to the resolver", async () => {
    await notifyChange("change_implemented", "c1", { actorId: "u-actor" })
    expect(resolveAudience).toHaveBeenCalledWith("change_implemented", expect.anything(), "u-actor")
  })

  it("uses explicit recipients when supplied, bypassing the resolver", async () => {
    await notifyChange("assignee_added", "c1", {
      recipients: [{ userId: "u9", email: "u9@c.com", name: "U Nine" }],
      role: "approver",
    })
    expect(resolveAudience).not.toHaveBeenCalled()
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u9" }) })
    )
  })

  it("resolves silently when the change no longer exists", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(null)
    await expect(notifyChange("change_closed", "gone")).resolves.toBeUndefined()
    expect(mockDb.notification.create).not.toHaveBeenCalled()
  })

  it("never rejects when a transport throws", async () => {
    sendChangeEventEmail.mockRejectedValueOnce(new Error("resend down"))
    await expect(notifyChange("change_implemented", "c1")).resolves.toBeUndefined()
  })

  it("broadcasts change_implemented to active chat webhooks", async () => {
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: "https://chat.example/hook" }])
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"))
    await notifyChange("change_implemented", "c1")
    expect(spy).toHaveBeenCalledWith("https://chat.example/hook", expect.objectContaining({ method: "POST" }))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/server/notify-change.test.ts`
Expected: FAIL — `notifyChange` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/server/notify.ts`, extend the email dispatcher so new types fall through to the generic template. Replace `emailFor`:

```ts
function emailFor(
  type: NotifyEventType, r: NotifyRecipient,
  change: { id: string; title: string }, ctx: NotifyContext, locale: Language,
  detail?: { subject: string; headline: string; intro: string; rows: [string, string][]; note?: string },
): Promise<unknown> {
  switch (type) {
    case "approval_requested":
      return sendApprovalRequestEmail({ to: r.email, approverName: r.name ?? r.email, changeTitle: change.title, requesterName: ctx.requesterName ?? "", riskLevel: ctx.riskLevel ?? "", changeId: change.id, locale })
    case "change_approved":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "approved", locale })
    case "change_rejected":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "rejected", locale })
    case "sla_escalated":
      return sendSlaEscalationEmail({ to: r.email, changeTitle: change.title, changeId: change.id, level: ctx.level ?? 1, riskLevel: ctx.riskLevel ?? "", locale })
    case "emergency_submitted":
      return sendEmergencyAlertEmail({ to: r.email, changeTitle: change.title, changeId: change.id, requesterName: ctx.requesterName ?? "", locale })
    default: {
      // Every event added by the expansion renders through the one generic template.
      const { title, body } = notificationContent(type, change.title, ctx, locale)
      return sendChangeEventEmail({
        to: r.email,
        subject: detail?.subject ?? `${title}: ${change.title}`,
        headline: detail?.headline ?? title,
        intro: detail?.intro ?? body,
        rows: detail?.rows ?? [],
        note: detail?.note ?? ctx.note,
        changeId: change.id,
        locale,
      })
    }
  }
}
```

Add `sendChangeEventEmail` to the `@/server/email` import.

Add ledger writes inside `notifyEvent`'s recipient loop, after the channel checks:

```ts
    tasks.push(
      db.notificationDispatch.create({ data: { userId: r.userId, changeId: change.id, type } })
    )
```

Append the facade:

```ts
/** Detail rows shown in the generic email. Kept here so copy and data stay together. */
function detailRows(
  change: { title: string; riskLevel: string; plannedStart: Date | null; plannedEnd: Date | null; opco: { name: string } },
  locale: Language,
): [string, string][] {
  const fr = locale === "fr"
  const rows: [string, string][] = [
    [fr ? "Changement" : "Change", change.title],
    ["OpCo", change.opco.name],
    [fr ? "Risque" : "Risk", change.riskLevel],
  ]
  if (change.plannedStart && change.plannedEnd) {
    rows.push([
      fr ? "Fenêtre" : "Window",
      `${change.plannedStart.toISOString().slice(0, 16).replace("T", " ")} – ${change.plannedEnd.toISOString().slice(0, 16).replace("T", " ")}`,
    ])
  }
  return rows
}

/**
 * Event-driven notification facade. Loads the change once, resolves the audience (or uses
 * explicit recipients for the per-person assignment events), and fans out through
 * notifyEvent. Best-effort: never rejects, so a mail or webhook fault cannot fail the
 * domain operation that triggered it.
 */
export async function notifyChange(
  type: NotifyEventType,
  changeId: string,
  ctx: NotifyContext & { actorId?: string; recipients?: NotifyRecipient[] } = {},
): Promise<void> {
  try {
    const db = getPrisma()
    const change = await db.changeRequest.findUnique({
      where: { id: changeId },
      select: {
        id: true, title: true, opcoId: true, requesterId: true,
        infrastructureType: true, riskLevel: true, plannedStart: true, plannedEnd: true,
        opco: { select: { name: true, locale: true } },
      },
    })
    if (!change) return

    const { actorId, recipients: explicit, ...rest } = ctx
    const recipients = explicit ?? await resolveAudience(type, {
      id: change.id, opcoId: change.opcoId,
      infrastructureType: change.infrastructureType, requesterId: change.requesterId,
    }, actorId)
    if (recipients.length === 0) return

    const locale = coerceLocale(change.opco.locale)
    const { title } = notificationContent(type, change.title, rest, locale)

    await notifyEvent({
      type,
      recipients,
      change: { id: change.id, title: change.title, opcoId: change.opcoId },
      context: rest,
      emailDetail: {
        subject: `${title}: ${change.title}`,
        headline: title,
        intro: notificationContent(type, change.title, rest, locale).body,
        rows: detailRows(change, locale),
        note: rest.note,
      },
    })
  } catch {
    // Best-effort by contract — swallow so callers never need their own guard.
  }
}
```

Thread `emailDetail` through `notifyEvent`'s input type and into the `emailFor` call:

```ts
export async function notifyEvent(input: {
  type: NotifyEventType
  recipients: NotifyRecipient[]
  change: { id: string; title: string; opcoId: string }
  context?: NotifyContext
  emailDetail?: { subject: string; headline: string; intro: string; rows: [string, string][]; note?: string }
}): Promise<void> {
```

and:

```ts
      tasks.push(emailFor(type, r, change, ctx, locale, input.emailDetail))
```

Add the imports `resolveAudience` from `@/server/audience` and `DEFAULT_CHANNELS` is already reached through `isChannelEnabled`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/server/notify-change.test.ts src/test/server/notify.test.ts`
Expected: PASS — 10 new plus the pre-existing `notify.test.ts` suite unchanged.

If `notify.test.ts` fails on the new `notificationDispatch.create` call, add `notificationDispatch: { create: vi.fn().mockResolvedValue({}) }` to its `mockDb`. That is a mock gap, not a behaviour change.

- [ ] **Step 5: Remove the placeholder test**

Delete the placeholder `describe("notifyChange", ...)` block added to `src/test/server/notify.test.ts` in Step 1 — `notify-change.test.ts` covers it properly.

- [ ] **Step 6: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/notify.ts src/test/server/notify-change.test.ts src/test/server/notify.test.ts
git commit -m "feat(notifications): notifyChange facade + send ledger

Loads the change once, resolves the audience, applies per-event defaults then
stored preferences, writes a NotificationDispatch row, and fans out. New event
types render through the generic email template; the five pre-existing types
keep their bespoke ones. notifyChange never rejects, so a mail or webhook
fault cannot fail the domain operation that triggered it."
```

---

### Task 6: Wire the call sites

**Files:**
- Modify: `src/server/actions/changes.ts` (`submitChange`, `discardChange`, `updateChangeStatus`, `rescheduleChange`)
- Modify: `src/server/actions/approvals.ts` (retrospective branch)
- Modify: `src/server/actions/pir.ts`
- Modify: `src/server/actions/assignees.ts` (`setChangeAssignees`, `setChangeApprovers`)
- Test: extend `src/test/actions/changes.test.ts`, `src/test/actions/approvals.test.ts`, `src/test/server/pir.test.ts`, `src/test/actions/assignees.test.ts`

**Interfaces:**
- Consumes: `notifyChange` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add to `src/test/actions/changes.test.ts` — first add the mock alongside the existing `@/server/notify` mock:

```ts
vi.mock('@/server/notify', () => ({
  notifyEvent: vi.fn().mockResolvedValue(undefined),
  notifyChange: vi.fn().mockResolvedValue(undefined),
}))
```

and import it: `import { notifyEvent, notifyChange } from '@/server/notify'`. Add `vi.mocked(notifyChange).mockClear()` to `beforeEach`. Then:

```ts
describe('lifecycle notifications', () => {
  it('submitChange notifies the requester with a receipt', async () => {
    await submitChange('cr-1')
    expect(notifyChange).toHaveBeenCalledWith('change_submitted', 'cr-1', expect.objectContaining({ actorId: 'user-1' }))
  })

  it('discardChange notifies change_cancelled', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1', opco: { slug: 'ghana' },
    })
    await discardChange('cr-1')
    expect(notifyChange).toHaveBeenCalledWith('change_cancelled', 'cr-1', expect.objectContaining({ actorId: 'user-1' }))
  })

  it('updateChangeStatus notifies change_implemented', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...approvedChange, approvals: [{ approverId: 'someone-else', decision: 'approve' }],
    })
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    await updateChangeStatus('cr-1', 'implemented')
    expect(notifyChange).toHaveBeenCalledWith('change_implemented', 'cr-1', expect.objectContaining({ actorId: expect.any(String) }))
  })

  it('a throwing notifyChange does not fail the action', async () => {
    vi.mocked(notifyChange).mockRejectedValueOnce(new Error('boom'))
    await expect(submitChange('cr-1')).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/actions/changes.test.ts -t "lifecycle notifications"`
Expected: FAIL — `notifyChange` is never called.

- [ ] **Step 3: Wire `changes.ts`**

Add `notifyChange` to the `@/server/notify` import. Then:

In `submitChange`, after the existing `approval_requested` / `emergency_submitted` calls and before `return updated`:

```ts
  // Receipt to the requester. Deliberately not actor-suppressed — see RECEIPT_TYPES.
  await notifyChange("change_submitted", id, { actorId: user.id }).catch(() => {})
```

In `discardChange`, before `return updated`:

```ts
  await notifyChange("change_cancelled", id, { actorId: user.id }).catch(() => {})
```

In `updateChangeStatus`, before `return updated`:

```ts
  const LIFECYCLE_EVENT: Partial<Record<ChangeStatus, NotifyEventType>> = {
    implemented: "change_implemented",
    closed: "change_closed",
    draft: "change_reopened",
  }
  const lifecycleEvent = LIFECYCLE_EVENT[toStatus]
  if (lifecycleEvent) {
    await notifyChange(lifecycleEvent, changeId, {
      actorId: user.id, actorName: user.name ?? user.email, note,
    }).catch(() => {})
  }
```

Hoist `LIFECYCLE_EVENT` to module scope (next to `VALID_TRANSITIONS`) rather than rebuilding it per call, and import `NotifyEventType` as a type from `@/lib/notifications`.

In `rescheduleChange`, before `return updated`:

```ts
  await notifyChange("change_rescheduled", id, {
    actorId: user.id,
    windowFrom: oldWindow,
    windowTo: `${newStart.toISOString()} – ${newEnd.toISOString()}`,
  }).catch(() => {})
```

- [ ] **Step 4: Wire `approvals.ts`**

Add `notifyChange` to the `@/server/notify` import. In the `isRetrospective` branch, after the audit row and before `return approval`:

```ts
    await notifyChange(decision === "approve" ? "retro_approved" : "retro_rejected", changeId, {
      actorId: user.id, actorName: user.name ?? user.email, note: comment,
    }).catch(() => {})
```

- [ ] **Step 5: Wire `pir.ts`**

`submitPostImplementationReview` returns from inside a `$transaction`. Capture the result, notify **after** the transaction commits, then return:

```ts
  const pir = await db.$transaction(async (tx) => {
    // ... unchanged body ...
    return pir
  })

  await notifyChange("change_verified", changeId, {
    actorId: user.id, actorName: user.name ?? user.email,
    outcome: input.outcome, note: input.summary.trim(),
  }).catch(() => {})

  return pir
```

Add `import { notifyChange } from "@/server/notify"`.

- [ ] **Step 6: Wire `assignees.ts`**

Both setters replace rows wholesale, so the added/removed sets come from diffing. Read the previous approver set before the transaction, and notify after it commits. In `setChangeApprovers`:

```ts
  const previous = await db.changeAssignee.findMany({
    where: { changeId, role: "approver" }, select: { userId: true },
  })
  const before = new Set(previous.map((r) => r.userId))
  const after = new Set(approverIds)

  await db.$transaction(async (tx) => { /* unchanged */ })

  const added = [...after].filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !after.has(id))
  await notifyAssigneeDiff(changeId, added, removed, "approver", me.id)
```

Add a shared helper at the bottom of `assignees.ts`:

```ts
/**
 * assignee_added / assignee_removed target one specific person, so recipients are passed
 * explicitly rather than resolved from a role group.
 */
async function notifyAssigneeDiff(
  changeId: string, added: string[], removed: string[], role: string, actorId: string,
) {
  if (added.length === 0 && removed.length === 0) return
  const db = getPrisma()
  const users = await db.user.findMany({
    where: { id: { in: [...added, ...removed] }, isActive: true },
    select: { id: true, name: true, email: true },
  })
  const recipient = (id: string) => {
    const u = users.find((x) => x.id === id)
    return u ? [{ userId: u.id, email: u.email, name: u.name }] : []
  }
  for (const id of added) {
    if (id === actorId) continue
    const r = recipient(id)
    if (r.length) await notifyChange("assignee_added", changeId, { recipients: r, role }).catch(() => {})
  }
  for (const id of removed) {
    if (id === actorId) continue
    const r = recipient(id)
    if (r.length) await notifyChange("assignee_removed", changeId, { recipients: r, role }).catch(() => {})
  }
}
```

Apply the same diff-and-notify pattern in `setChangeAssignees`, diffing on the full assignee set and passing each entry's own `role`.

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`

Expected: PASS. Suites that assert on `@/server/notify` will need `notifyChange: vi.fn().mockResolvedValue(undefined)` added to their module mock — that is a mock gap, not a behaviour change. Add it wherever a suite fails with `notifyChange is not a function`.

- [ ] **Step 8: Type-check, lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/server/actions src/test
git commit -m "feat(notifications): wire lifecycle, PIR, and assignment call sites

submitChange sends the requester a receipt; discardChange, updateChangeStatus
and rescheduleChange emit cancelled/implemented/closed/reopened/rescheduled;
the PIR emits change_verified after its transaction commits; and both assignee
setters diff the previous set so only genuinely added or removed people are
told. Every call site is .catch()-guarded so a notification fault cannot fail
the domain operation."
```

---

### Task 7: Cron reminders

**Files:**
- Create: `src/server/reminders.ts`
- Modify: `src/app/api/cron/sla/route.ts`
- Test: `src/test/server/reminders.test.ts`

**Interfaces:**
- Consumes: `notifyChange` (Task 5), `SLA_HOURS` from `@/lib/sla`, the `NotificationDispatch` model (Task 2).
- Produces: `runDueReminders(): Promise<{ nudged: number; retroOverdue: number }>`

- [ ] **Step 1: Write the failing tests**

Create `src/test/server/reminders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  changeRequest: { findMany: vi.fn() },
  notificationDispatch: { findFirst: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { notifyChange } = vi.hoisted(() => ({ notifyChange: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyChange }))

const { resolveAudience } = vi.hoisted(() => ({ resolveAudience: vi.fn() }))
vi.mock("@/server/audience", () => ({ resolveAudience }))

import { runDueReminders } from "@/server/reminders"

const HOUR = 60 * 60 * 1000
const now = Date.now()

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findMany.mockResolvedValue([])
  mockDb.notificationDispatch.findFirst.mockResolvedValue(null)
  resolveAudience.mockResolvedValue([{ userId: "a1", email: "a1@c.com", name: "A One" }])
})

describe("approver_nudge", () => {
  // low risk => SLA_HOURS 48; midpoint is 24h after creation.
  const pendingChange = (createdOffsetH: number) => ({
    id: "c1", status: "pending", riskLevel: "low", opcoId: "o1",
    infrastructureType: "Wifi", requesterId: "u-req",
    createdAt: new Date(now - createdOffsetH * HOUR),
    slaDeadline: new Date(now + (48 - createdOffsetH) * HOUR),
    retroApprovalDueAt: null, retroApprovedAt: null, expedited: false,
  })

  it("does not nudge before the SLA midpoint", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(10)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
    expect(notifyChange).not.toHaveBeenCalled()
  })

  it("nudges past the SLA midpoint", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(1)
    expect(notifyChange).toHaveBeenCalledWith("approver_nudge", "c1", expect.objectContaining({
      recipients: [{ userId: "a1", email: "a1@c.com", name: "A One" }],
    }))
  })

  it("does not nudge once the SLA has breached — sla_escalated takes over", async () => {
    const breached = { ...pendingChange(30), slaDeadline: new Date(now - HOUR) }
    mockDb.changeRequest.findMany.mockResolvedValueOnce([breached]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
  })

  it("suppresses a nudge sent within the last 24h", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    mockDb.notificationDispatch.findFirst.mockResolvedValue({ id: "d1" })
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
    expect(mockDb.notificationDispatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "a1", changeId: "c1", type: "approver_nudge" }),
      })
    )
  })

  it("skips a change with no pending approvers", async () => {
    resolveAudience.mockResolvedValue([])
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
  })
})

describe("retro_overdue", () => {
  const expedited = (dueOffsetH: number) => ({
    id: "c2", status: "implemented", riskLevel: "emergency", opcoId: "o1",
    infrastructureType: "Wifi", requesterId: "u-req",
    createdAt: new Date(now - 72 * HOUR), slaDeadline: null,
    expedited: true, retroApprovedAt: null,
    retroApprovalDueAt: new Date(now + dueOffsetH * HOUR),
  })

  it("fires inside the 12h window", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(6)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(1)
    expect(notifyChange).toHaveBeenCalledWith("retro_overdue", "c2", expect.objectContaining({ dueAt: expect.any(String) }))
  })

  it("fires when already past due", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(-5)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(1)
  })

  it("does not fire more than 12h before the deadline", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(30)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(0)
  })

  it("suppresses a reminder sent within the last 12h", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(6)])
    mockDb.notificationDispatch.findFirst.mockResolvedValue({ id: "d1" })
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/server/reminders.test.ts`
Expected: FAIL — cannot resolve `@/server/reminders`.

- [ ] **Step 3: Write the implementation**

Create `src/server/reminders.ts`:

```ts
// src/server/reminders.ts
// Recurring notification sweep, run from /api/cron/sla alongside SLA escalation.
// Idempotency comes from the NotificationDispatch ledger: each reminder type has a
// minimum interval, so a daily cron cannot re-send the same nudge every morning.
import { getPrisma } from "@/server/db"
import { notifyChange } from "@/server/notify"
import { resolveAudience } from "@/server/audience"
import { SLA_HOURS } from "@/lib/sla"
import type { NotifyEventType } from "@/lib/notifications"
import type { RiskLevel } from "@prisma/client"

const HOUR = 60 * 60 * 1000
const NUDGE_INTERVAL_MS = 24 * HOUR
/** How close to the retrospective-approval deadline the first reminder fires. */
const RETRO_WINDOW_MS = 12 * HOUR
const RETRO_INTERVAL_MS = 12 * HOUR

type Db = ReturnType<typeof getPrisma>

async function sentWithin(
  db: Db, userId: string, changeId: string, type: NotifyEventType, withinMs: number,
): Promise<boolean> {
  const row = await db.notificationDispatch.findFirst({
    where: { userId, changeId, type, sentAt: { gte: new Date(Date.now() - withinMs) } },
    select: { id: true },
  })
  return !!row
}

export async function runDueReminders(): Promise<{ nudged: number; retroOverdue: number }> {
  const db = getPrisma()
  const now = Date.now()

  const [pending, expedited] = await Promise.all([
    db.changeRequest.findMany({
      where: { status: "pending" },
      select: {
        id: true, riskLevel: true, opcoId: true, infrastructureType: true,
        requesterId: true, createdAt: true, slaDeadline: true,
      },
    }),
    db.changeRequest.findMany({
      where: { expedited: true, retroApprovedAt: null, retroApprovalDueAt: { not: null } },
      select: {
        id: true, opcoId: true, infrastructureType: true, requesterId: true, retroApprovalDueAt: true,
      },
    }),
  ])

  let nudged = 0
  for (const c of pending) {
    // Nudge only in the back half of the SLA window. Once breached, sla_escalated owns it.
    const windowMs = SLA_HOURS[c.riskLevel as RiskLevel] * HOUR
    const elapsed = now - c.createdAt.getTime()
    if (elapsed < windowMs / 2) continue
    if (c.slaDeadline && now >= c.slaDeadline.getTime()) continue

    const recipients = await resolveAudience("approver_nudge", {
      id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType, requesterId: c.requesterId,
    })
    for (const r of recipients) {
      if (await sentWithin(db, r.userId, c.id, "approver_nudge", NUDGE_INTERVAL_MS)) continue
      await notifyChange("approver_nudge", c.id, { recipients: [r] })
      nudged++
    }
  }

  let retroOverdue = 0
  for (const c of expedited) {
    const due = c.retroApprovalDueAt!.getTime()
    if (due - now > RETRO_WINDOW_MS) continue

    const recipients = await resolveAudience("retro_overdue", {
      id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType, requesterId: c.requesterId,
    })
    for (const r of recipients) {
      if (await sentWithin(db, r.userId, c.id, "retro_overdue", RETRO_INTERVAL_MS)) continue
      await notifyChange("retro_overdue", c.id, {
        recipients: [r], dueAt: c.retroApprovalDueAt!.toISOString().slice(0, 16).replace("T", " "),
      })
      retroOverdue++
    }
  }

  return { nudged, retroOverdue }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/server/reminders.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Fold the sweep into the cron route**

In `src/app/api/cron/sla/route.ts`, replace the handler body:

```ts
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const escalations = await runDueEscalations({})
  // Reminders ride the same daily sweep — no second endpoint, secret, or scheduler entry.
  const reminders = await runDueReminders()
  return NextResponse.json({ escalations, reminders })
}
```

and add `import { runDueReminders } from "@/server/reminders"`.

- [ ] **Step 6: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: clean. If a route test asserts the old response shape, update it to `{ escalations, reminders }`.

- [ ] **Step 7: Commit**

```bash
git add src/server/reminders.ts src/app/api/cron/sla/route.ts src/test/server/reminders.test.ts
git commit -m "feat(notifications): approver-nudge and retro-overdue reminders

Sweep runs inside the existing /api/cron/sla handler, so no new endpoint,
secret, vercel.json entry, or Cloud Scheduler job. Nudges fire in the back
half of the SLA window and stop once breached (sla_escalated takes over);
retro reminders fire within 12h of the deadline or past it. The
NotificationDispatch ledger enforces per-type minimum intervals so a daily
cron cannot re-send the same reminder every morning."
```

---

### Task 8: Grouped preference matrix and correct defaults

**Files:**
- Modify: `src/server/actions/notification-prefs.ts`
- Modify: `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`
- Modify: `src/lib/i18n.ts`
- Test: `src/test/actions/notification-prefs.test.ts` (create if absent)

**Interfaces:**
- Consumes: `NOTIFY_EVENT_TYPES`, `NOTIFY_EVENT_GROUPS`, `DEFAULT_CHANNELS` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/notification-prefs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({ keycloakId: "kc-1", organizations: [], realmRoles: [] }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: "u1" }) },
  notificationPreference: { findMany: vi.fn(), upsert: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { getMyPreferences } from "@/server/actions/notification-prefs"
import { NOTIFY_EVENT_TYPES, DEFAULT_CHANNELS } from "@/lib/notifications"

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: "u1" })
  mockDb.notificationPreference.findMany.mockResolvedValue([])
})

describe("getMyPreferences", () => {
  it("returns a cell per event type per channel", async () => {
    const cells = await getMyPreferences()
    expect(cells).toHaveLength(NOTIFY_EVENT_TYPES.length * 2)
  })

  it("uses DEFAULT_CHANNELS, not a blanket true, when no row exists", async () => {
    const cells = await getMyPreferences()
    const closedEmail = cells.find((c) => c.eventType === "change_closed" && c.channel === "email")
    expect(closedEmail?.enabled).toBe(DEFAULT_CHANNELS.change_closed.email)
    expect(closedEmail?.enabled).toBe(false)
  })

  it("a stored row overrides the default", async () => {
    mockDb.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "change_closed", channel: "email", enabled: true },
    ])
    const cells = await getMyPreferences()
    const closedEmail = cells.find((c) => c.eventType === "change_closed" && c.channel === "email")
    expect(closedEmail?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/actions/notification-prefs.test.ts`
Expected: FAIL — `change_closed`/`email` comes back `true` from the blanket fallback.

- [ ] **Step 3: Fix the server default**

In `src/server/actions/notification-prefs.ts`, add `DEFAULT_CHANNELS` to the `@/lib/notifications` import and replace the fallback line:

```ts
      cells.push({
        eventType, channel,
        enabled: stored.has(key) ? stored.get(key)! : DEFAULT_CHANNELS[eventType][channel],
      })
```

- [ ] **Step 4: Fix the client default and group the matrix**

In `notifications-prefs-client.tsx`, swap the import of `NOTIFY_EVENT_TYPES` for `NOTIFY_EVENT_GROUPS` and `DEFAULT_CHANNELS`, then replace the `<tbody>` so each group emits a header row followed by its types:

```tsx
            <tbody>
              {NOTIFY_EVENT_GROUPS.map((group) => (
                <React.Fragment key={group.key}>
                  <tr className="border-b border-border/70 bg-muted/40">
                    <th colSpan={3} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(language, `notifGroup.${group.key}`)}
                    </th>
                  </tr>
                  {group.types.map((evt) => (
                    <tr key={evt} className="border-b border-border/40">
                      <td className="px-4 py-2" data-label={t(language, "notifPrefs.event")}>{t(language, `notifEvent.${evt}`)}</td>
                      {CHANNELS.map((ch) => (
                        <td key={ch} className="px-4 py-2 text-center" data-label={t(language, ch === "email" ? "notifPrefs.email" : "notifPrefs.inApp")}>
                          <input
                            type="checkbox"
                            checked={cells.get(`${evt}:${ch}`) ?? DEFAULT_CHANNELS[evt][ch]}
                            onChange={() => toggle(evt, ch)}
                            aria-label={`${evt} ${ch}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
```

Add `import * as React from "react"` if the file does not already import React.

- [ ] **Step 5: Add the i18n strings**

In `src/lib/i18n.ts`, add to the **EN** map beside the existing `notifEvent.*` keys:

```ts
    "notifGroup.approvals": "Approvals",
    "notifGroup.lifecycle": "Lifecycle",
    "notifGroup.assignment": "Assignment",
    "notifGroup.emergency": "Emergency & SLA",
    "notifEvent.change_submitted": "Request submitted",
    "notifEvent.change_implemented": "Change implemented",
    "notifEvent.change_verified": "Change verified",
    "notifEvent.change_closed": "Change closed",
    "notifEvent.change_reopened": "Change reopened",
    "notifEvent.change_cancelled": "Change cancelled",
    "notifEvent.change_rescheduled": "Change rescheduled",
    "notifEvent.assignee_added": "Assigned to a change",
    "notifEvent.assignee_removed": "Assignment removed",
    "notifEvent.retro_approved": "Retrospective approval recorded",
    "notifEvent.retro_rejected": "Retrospective approval rejected",
    "notifEvent.retro_overdue": "Retrospective approval overdue",
    "notifEvent.approver_nudge": "Approval reminder",
```

And the **FR** map:

```ts
    "notifGroup.approvals": "Approbations",
    "notifGroup.lifecycle": "Cycle de vie",
    "notifGroup.assignment": "Affectation",
    "notifGroup.emergency": "Urgence et SLA",
    "notifEvent.change_submitted": "Demande soumise",
    "notifEvent.change_implemented": "Changement mis en œuvre",
    "notifEvent.change_verified": "Changement vérifié",
    "notifEvent.change_closed": "Changement clôturé",
    "notifEvent.change_reopened": "Changement rouvert",
    "notifEvent.change_cancelled": "Changement annulé",
    "notifEvent.change_rescheduled": "Changement replanifié",
    "notifEvent.assignee_added": "Affecté à un changement",
    "notifEvent.assignee_removed": "Affectation retirée",
    "notifEvent.retro_approved": "Approbation rétrospective enregistrée",
    "notifEvent.retro_rejected": "Approbation rétrospective refusée",
    "notifEvent.retro_overdue": "Approbation rétrospective en retard",
    "notifEvent.approver_nudge": "Rappel d'approbation",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/test/actions/notification-prefs.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7: Type-check, lint, full suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/actions/notification-prefs.ts src/app/\(dashboard\)/settings/notifications src/lib/i18n.ts src/test/actions/notification-prefs.test.ts
git commit -m "feat(notifications): grouped preference matrix with per-event defaults

Both getMyPreferences and the client checkbox hardcoded a blanket true
fallback; both now consult DEFAULT_CHANNELS, so ambient events default to
in-app only. The 18 x 2 matrix is split into four labelled sections, with
EN/FR labels for every new event type."
```

---

### Task 9: Repoint existing email CTAs and final verification

**Files:**
- Modify: `src/emails/approval-request.tsx`, `src/emails/status-change.tsx`, `src/emails/sla-escalation.tsx`, `src/emails/emergency-alert.tsx`
- Modify: `src/server/email.tsx` (thread `changeId` where a template needs it)
- Test: `src/test/emails/render.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Audit the current links**

Run: `grep -rn "EMAIL_BASE_URL" src/emails/`

Expected: several templates build `${EMAIL_BASE_URL}/changes` — the bare list route, which now redirects. Each of these already receives, or can receive, the change id.

- [ ] **Step 2: Repoint each CTA**

For every template whose CTA targets `${EMAIL_BASE_URL}/changes`, change it to `${EMAIL_BASE_URL}/changes/${changeId}` and add a `changeId: string` prop where absent. `status-change.tsx` is the one that needs a new prop; `sla-escalation.tsx` and `emergency-alert.tsx` already take `changeId`.

In `src/server/email.tsx`, `sendStatusChangeEmail` gains `changeId: string` in its options and passes it through. Update its two call sites in `src/server/notify.ts` (`change_approved`, `change_rejected`) to pass `changeId: change.id`.

Leave `invitation.tsx` and `access-request.tsx` alone — neither is about a specific change.

- [ ] **Step 3: Add the assertion**

Extend `src/test/emails/render.test.ts` with a check that every change-scoped template deep-links:

```ts
it("change-scoped emails deep-link to the change detail route", async () => {
  const html = await render(
    <StatusChangeEmail name="Ada" changeTitle="Router upgrade" status="approved" tone="approved" changeId="abc123" lang="en" />
  )
  expect(html).toContain("/changes/abc123")
  expect(html).not.toMatch(/\/changes"/)
})
```

- [ ] **Step 4: Run the email suites**

Run: `pnpm vitest run src/test/emails/`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: all tests pass, no type or lint errors, build succeeds.

- [ ] **Step 6: Confirm no event type is unreachable**

Run: `grep -rn "notifyChange(" src/server | grep -o '"[a-z_]*"' | sort -u`

Expected: every one of the 13 new types appears except those fired only by the reminder sweep — confirm `approver_nudge` and `retro_overdue` appear in `src/server/reminders.ts`, and `assignee_added` / `assignee_removed` in `src/server/actions/assignees.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/emails src/server/email.tsx src/server/notify.ts src/test/emails
git commit -m "fix(email): deep-link transactional emails to the change detail page

The existing templates pointed at the bare /changes list, which now redirects.
Every change-scoped email links to /changes/<id> instead; sendStatusChangeEmail
gains the changeId it needs to do so."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| 13 new event types, 18 total | 1 |
| `DEFAULT_CHANNELS`, per-event defaults | 1, 8 |
| `isChannelEnabled` fallback change | 1 |
| Chat broadcast grows by exactly two | 1 |
| EN + FR copy for all new types | 1 (notification/chat copy), 8 (matrix labels) |
| `NotificationDispatch` model + migration | 2 |
| Central audience resolver, role groups | 3 |
| Actor suppression + `change_submitted` receipt exception | 3 |
| Generic `ChangeEventEmail` | 4 |
| `notifyChange` facade | 5 |
| Ledger written after fan-out | 5 |
| `notifyEvent` preserved for the 5 existing types | 5 |
| Call sites: submitted, implemented, closed, reopened, cancelled, rescheduled | 6 |
| Call site: verified (after `$transaction` commits) | 6 |
| Call sites: retro_approved / retro_rejected | 6 |
| Call sites: assignee_added / assignee_removed via diff | 6 |
| `approver_nudge` + `retro_overdue` sweep, intervals | 7 |
| Sweep folded into `/api/cron/sla`, response shape | 7 |
| Grouped preference matrix, 4 sections | 8 |
| Deep links to `/changes/<id>` | 4 (new), 9 (existing) |
| Best-effort, never fails a domain operation | 5 (facade swallows), 6 (call sites `.catch`) |

Every spec requirement maps to at least one task.

**Type consistency:** `NotifyEventType` is the single union used by `DEFAULT_CHANNELS`, `AUDIENCE`, `notificationContent`, `chatMessageText`, `notifyEvent`, `notifyChange`, and `sentWithin`. `NotifyRecipient` (`{ userId, email, name }`) is produced by `resolveAudience` and consumed by `notifyEvent` / `notifyChange` / `runDueReminders` unchanged. `AudienceChange` (`{ id, opcoId, infrastructureType, requesterId }`) is the resolver's input in both `notify.ts` and `reminders.ts`. `notifyChange`'s third parameter is `NotifyContext & { actorId?, recipients? }` everywhere.

**Two things worth flagging before execution:**

1. **Task 5's `notifyChange` swallows all errors *and* call sites add `.catch(() => {})`.** That is deliberate belt-and-braces: the facade's guarantee is the contract, and the call-site guard documents the intent locally. It does mean a genuine bug inside `notifyChange` is invisible in production — acceptable for notifications, but the `catch` block should not grow logic.

2. **`assignee_added` / `assignee_removed` carry empty `AUDIENCE` entries** because they target one specific person known only to the caller (the diff of the assignee set). Task 3's tests handle this explicitly: the completeness assertion skips those two rather than being weakened for all types, and a separate test pins that they resolve to nobody on their own. Their delivery is covered by Task 6's assignee-diff tests.

3. **Task 2's migration is hand-authored.** `prisma migrate dev` needs a live database plus a shadow database, which is not assumed here. The SQL matches what Prisma emits for the model, and `prisma validate` plus `prisma generate` confirm the schema is coherent — but the migration is not *applied* anywhere during this plan. It will run via `prisma migrate deploy` in CI/prod. If a local Postgres is available, `pnpm prisma migrate deploy` against it is worth running as an extra check.
