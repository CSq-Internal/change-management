# v1.0 Bundle 3 — Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app notifications (model + feed + header bell + wired sidebar counters), a per-user event×channel preference matrix, and admin-configured Google Chat webhooks — all flowing through one dispatch layer that the existing email call-sites are refactored to use.

**Architecture:** Pure helpers in `src/lib/notifications.ts` (copy + preference lookup) feed an orchestrator `src/server/notify.ts` (`notifyEvent`) that, per recipient, creates a `Notification` and/or sends the existing email based on the preference matrix, then broadcasts team-wide events to Google Chat webhooks. The 4 existing email touch-points (submit, approve/reject, SLA escalation, emergency) are refactored to call `notifyEvent`. Three new models: `Notification`, `NotificationPreference`, `ChatWebhook`. Follows existing patterns: `opcoFilter` scoping, `recordAdminAction` audit, custom modal dialogs, native `<select>`, inline badges.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Prisma v7, Vitest (jsdom + db-mocked), Playwright MCP for smoke.

---

## File Structure

**Create:** `src/lib/notifications.ts` (+test), `src/server/notify.ts` (+test), `src/server/actions/notifications.ts` (+test), `src/server/actions/notification-prefs.ts`, `src/server/actions/chat-webhooks.ts` (+test), `src/app/(dashboard)/notifications/history/history-client.tsx`, `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`, `src/app/(dashboard)/settings/integrations/integrations-client.tsx`, `prisma/migrations/20260608120000_notifications/migration.sql`.

**Modify:** `prisma/schema.prisma`, `src/server/actions/changes.ts`, `src/server/actions/approvals.ts`, `src/server/sla.ts`, `src/components/app-shell.tsx`, `src/app/(dashboard)/notifications/history/page.tsx`, `src/app/(dashboard)/settings/notifications/page.tsx`, `src/app/(dashboard)/settings/integrations/page.tsx`, `src/lib/i18n.ts`.

---

## Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/20260608120000_notifications/migration.sql`

- [ ] **Step 1: Add the enum + 3 models**

In `prisma/schema.prisma` add:

```prisma
enum NotificationChannel {
  email
  in_app
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation("UserNotifications", fields: [userId], references: [id])
  type      String
  title     String
  body      String
  changeId  String?
  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, readAt])
  @@index([userId, createdAt])
}

model NotificationPreference {
  id        String              @id @default(cuid())
  userId    String
  user      User                @relation("UserNotifPrefs", fields: [userId], references: [id])
  eventType String
  channel   NotificationChannel
  enabled   Boolean             @default(true)

  @@unique([userId, eventType, channel])
  @@index([userId])
}

model ChatWebhook {
  id          String   @id @default(cuid())
  opcoId      String?
  opco        OpCo?    @relation(fields: [opcoId], references: [id])
  url         String
  isActive    Boolean  @default(true)
  createdById String
  createdBy   User     @relation("ChatWebhookAuthor", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())

  @@index([opcoId])
}
```

Add back-relations: in `model User` add `notifications Notification[] @relation("UserNotifications")`, `notifPrefs NotificationPreference[] @relation("UserNotifPrefs")`, `chatWebhooks ChatWebhook[] @relation("ChatWebhookAuthor")`. In `model OpCo` add `chatWebhooks ChatWebhook[]`.

- [ ] **Step 2: Migration SQL**

Create `prisma/migrations/20260608120000_notifications/migration.sql`:

```sql
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'in_app');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_channel_key" ON "NotificationPreference"("userId", "eventType", "channel");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

CREATE TABLE "ChatWebhook" (
    "id" TEXT NOT NULL,
    "opcoId" TEXT,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatWebhook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatWebhook_opcoId_idx" ON "ChatWebhook"("opcoId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatWebhook" ADD CONSTRAINT "ChatWebhook_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatWebhook" ADD CONSTRAINT "ChatWebhook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate + type-check**

Run: `pnpm prisma generate && pnpm tsc --noEmit`
Expected: PASS. (Do NOT `migrate deploy` — applied live at smoke.)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260608120000_notifications/migration.sql
git commit -m "feat(notify): add Notification, NotificationPreference, ChatWebhook models"
```

---

## Task 2: Pure helpers (TDD)

**Files:** `src/lib/notifications.ts`, `src/test/lib/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/notifications.test.ts`:

```ts
// src/test/lib/notifications.test.ts
import { describe, it, expect } from 'vitest'
import {
  notificationContent, isChannelEnabled, chatMessageText,
  NOTIFY_EVENT_TYPES, CHAT_BROADCAST_TYPES,
} from '@/lib/notifications'

describe('notificationContent', () => {
  it('builds copy for each event type', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}).title).toMatch(/approved/i)
    expect(notificationContent('change_rejected', 'Core upgrade', {}).title).toMatch(/rejected/i)
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }).body).toMatch(/Core upgrade/)
    expect(notificationContent('emergency_submitted', 'Core upgrade', { requesterName: 'Ada' }).body).toMatch(/Ada/)
    expect(notificationContent('approval_requested', 'Core upgrade', {}).body).toMatch(/approval/i)
  })
})

describe('isChannelEnabled', () => {
  it('defaults to on when no preference row exists', () => {
    expect(isChannelEnabled(new Map(), 'u1', 'change_approved', 'email')).toBe(true)
  })
  it('respects an explicit off', () => {
    const prefs = new Map([['u1:change_approved:email', false]])
    expect(isChannelEnabled(prefs, 'u1', 'change_approved', 'email')).toBe(false)
    expect(isChannelEnabled(prefs, 'u1', 'change_approved', 'in_app')).toBe(true)
  })
})

describe('chatMessageText', () => {
  it('produces a one-line message mentioning the change', () => {
    expect(chatMessageText('emergency_submitted', 'Core upgrade', {})).toMatch(/Core upgrade/)
  })
})

describe('constants', () => {
  it('has 5 event types and 4 chat broadcast types', () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(5)
    expect(CHAT_BROADCAST_TYPES).toHaveLength(4)
    expect(CHAT_BROADCAST_TYPES).not.toContain('approval_requested')
  })
})
```

- [ ] **Step 2: Run → FAIL** (`pnpm test src/test/lib/notifications.test.ts`).

- [ ] **Step 3: Implement** — create `src/lib/notifications.ts`:

```ts
// src/lib/notifications.ts
// Pure notification copy + preference lookup. No DB. Unit-tested.

export type NotifyEventType =
  | "approval_requested" | "change_approved" | "change_rejected"
  | "sla_escalated" | "emergency_submitted"

export type NotifyChannel = "email" | "in_app"

export type NotifyContext = { requesterName?: string; newStatus?: string; level?: number; riskLevel?: string }

export const NOTIFY_EVENT_TYPES: NotifyEventType[] = [
  "approval_requested", "change_approved", "change_rejected", "sla_escalated", "emergency_submitted",
]

export const CHAT_BROADCAST_TYPES: NotifyEventType[] = [
  "emergency_submitted", "sla_escalated", "change_approved", "change_rejected",
]

export function notificationContent(
  type: NotifyEventType, changeTitle: string, ctx: NotifyContext
): { title: string; body: string } {
  switch (type) {
    case "approval_requested":
      return { title: "Approval requested", body: `"${changeTitle}" needs your approval.` }
    case "change_approved":
      return { title: "Change approved", body: `"${changeTitle}" was approved.` }
    case "change_rejected":
      return { title: "Change rejected", body: `"${changeTitle}" was rejected.` }
    case "sla_escalated":
      return { title: "SLA breached", body: `"${changeTitle}" breached its SLA (level ${ctx.level ?? 1}).` }
    case "emergency_submitted":
      return { title: "Emergency change", body: `${ctx.requesterName ?? "Someone"} submitted emergency change "${changeTitle}".` }
  }
}

export function isChannelEnabled(
  prefs: Map<string, boolean>, userId: string, type: NotifyEventType, channel: NotifyChannel
): boolean {
  const key = `${userId}:${type}:${channel}`
  return prefs.has(key) ? prefs.get(key)! : true
}

export function chatMessageText(type: NotifyEventType, changeTitle: string, ctx: NotifyContext): string {
  switch (type) {
    case "emergency_submitted": return `🚨 Emergency change submitted: "${changeTitle}"`
    case "sla_escalated": return `⏰ SLA breached (level ${ctx.level ?? 1}): "${changeTitle}"`
    case "change_approved": return `✅ Change approved: "${changeTitle}"`
    case "change_rejected": return `❌ Change rejected: "${changeTitle}"`
    case "approval_requested": return `📋 Approval requested: "${changeTitle}"`
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/lib/notifications.ts src/test/lib/notifications.test.ts
git commit -m "feat(notify): add pure notification copy + preference helpers"
```

---

## Task 3: Dispatch orchestrator (TDD, db-mocked)

**Files:** `src/server/notify.ts`, `src/test/server/notify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/notify.test.ts`:

```ts
// src/test/server/notify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
  notification: { create: vi.fn().mockResolvedValue({}) },
  chatWebhook: { findMany: vi.fn().mockResolvedValue([]) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

const email = {
  sendApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined),
  sendSlaEscalationEmail: vi.fn().mockResolvedValue(undefined),
  sendEmergencyAlertEmail: vi.fn().mockResolvedValue(undefined),
}
vi.mock('@/server/email', () => email)

import { notifyEvent } from '@/server/notify'

const change = { id: 'c1', title: 'Core upgrade', opcoId: 'opco-1' }
const ada = { userId: 'u1', email: 'ada@x.com', name: 'Ada' }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.notificationPreference.findMany.mockResolvedValue([])
  mockDb.chatWebhook.findMany.mockResolvedValue([])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('notifyEvent', () => {
  it('creates an in-app notification and sends an email by default (no prefs)', async () => {
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'change_approved', changeId: 'c1' }) })
    )
    expect(email.sendStatusChangeEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@x.com', newStatus: 'approved' }))
  })

  it('skips the in_app channel when muted', async () => {
    mockDb.notificationPreference.findMany.mockResolvedValue([
      { userId: 'u1', eventType: 'change_approved', channel: 'in_app', enabled: false },
    ])
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).not.toHaveBeenCalled()
    expect(email.sendStatusChangeEmail).toHaveBeenCalled() // email still on
  })

  it('posts to chat webhooks for a broadcast event', async () => {
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: 'https://chat.googleapis.com/x', opcoId: 'opco-1' }])
    await notifyEvent({ type: 'emergency_submitted', recipients: [ada], change, context: { requesterName: 'Ada' } })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://chat.googleapis.com/x', expect.objectContaining({ method: 'POST' }))
  })

  it('does NOT query chat webhooks for a non-broadcast event', async () => {
    await notifyEvent({ type: 'approval_requested', recipients: [ada], change })
    expect(mockDb.chatWebhook.findMany).not.toHaveBeenCalled()
  })

  it('is best-effort: a throwing email does not break others', async () => {
    email.sendStatusChangeEmail.mockRejectedValueOnce(new Error('smtp down'))
    await expect(notifyEvent({ type: 'change_approved', recipients: [ada], change })).resolves.toBeUndefined()
    expect(mockDb.notification.create).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/notify.ts`:

```ts
// src/server/notify.ts
import { getPrisma } from "@/server/db"
import {
  notificationContent, chatMessageText, isChannelEnabled,
  CHAT_BROADCAST_TYPES, type NotifyEventType, type NotifyContext,
} from "@/lib/notifications"
import {
  sendApprovalRequestEmail, sendStatusChangeEmail, sendSlaEscalationEmail, sendEmergencyAlertEmail,
} from "@/server/email"

type Db = ReturnType<typeof getPrisma>
export type NotifyRecipient = { userId: string; email: string; name: string | null }

async function loadPrefs(db: Db, userIds: string[], type: NotifyEventType): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map()
  const rows = await db.notificationPreference.findMany({ where: { userId: { in: userIds }, eventType: type } })
  const m = new Map<string, boolean>()
  for (const r of rows) m.set(`${r.userId}:${r.eventType}:${r.channel}`, r.enabled)
  return m
}

function emailFor(type: NotifyEventType, r: NotifyRecipient, change: { id: string; title: string }, ctx: NotifyContext): Promise<unknown> {
  switch (type) {
    case "approval_requested":
      return sendApprovalRequestEmail({ to: r.email, approverName: r.name ?? r.email, changeTitle: change.title, requesterName: ctx.requesterName ?? "", riskLevel: ctx.riskLevel ?? "", changeId: change.id })
    case "change_approved":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "approved" })
    case "change_rejected":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "rejected" })
    case "sla_escalated":
      return sendSlaEscalationEmail({ to: r.email, changeTitle: change.title, changeId: change.id, level: ctx.level ?? 1, riskLevel: ctx.riskLevel ?? "" })
    case "emergency_submitted":
      return sendEmergencyAlertEmail({ to: r.email, changeTitle: change.title, changeId: change.id, requesterName: ctx.requesterName ?? "" })
  }
}

export async function postToChat(url: string, text: string): Promise<void> {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
}

export async function notifyEvent(input: {
  type: NotifyEventType
  recipients: NotifyRecipient[]
  change: { id: string; title: string; opcoId: string }
  context?: NotifyContext
}): Promise<void> {
  const { type, recipients, change } = input
  const ctx = input.context ?? {}
  const db = getPrisma()
  const prefs = await loadPrefs(db, recipients.map((r) => r.userId), type)

  const tasks: Promise<unknown>[] = []
  for (const r of recipients) {
    if (isChannelEnabled(prefs, r.userId, type, "in_app")) {
      const { title, body } = notificationContent(type, change.title, ctx)
      tasks.push(db.notification.create({ data: { userId: r.userId, type, title, body, changeId: change.id } }))
    }
    if (isChannelEnabled(prefs, r.userId, type, "email")) {
      tasks.push(emailFor(type, r, change, ctx))
    }
  }

  if (CHAT_BROADCAST_TYPES.includes(type)) {
    const hooks = await db.chatWebhook.findMany({ where: { isActive: true, OR: [{ opcoId: change.opcoId }, { opcoId: null }] } })
    const text = chatMessageText(type, change.title, ctx)
    for (const h of hooks) tasks.push(postToChat(h.url, text))
  }

  await Promise.allSettled(tasks)
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/notify.ts src/test/server/notify.test.ts
git commit -m "feat(notify): add notifyEvent dispatch orchestrator"
```

---

## Task 4: Refactor `submitChange` to `notifyEvent`

**Files:** `src/server/actions/changes.ts`

- [ ] **Step 1: Replace the two email loops**

In `src/server/actions/changes.ts`, add import: `import { notifyEvent } from "@/server/notify"`.

Find the block after the `"submitted"` audit write (the `getRoutedApprovers` loop + the `if (change.isEmergency)` block, ~lines 199–225). Replace both with:

```ts
  // Notify the routed CAB's members (group CAB for Equiano, OpCo CAB otherwise) + active delegates.
  const approvers = await getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId })
  await notifyEvent({
    type: "approval_requested",
    recipients: approvers.map((u) => ({ userId: u.id, email: u.email, name: u.name })),
    change: { id: change.id, title: change.title, opcoId: change.opcoId },
    context: { requesterName: user.name ?? user.email, riskLevel: change.riskLevel },
  }).catch(() => {})

  if (change.isEmergency) {
    const cab = await db.cABMembership.findMany({
      where: { opcoId: null, isActive: true },
      select: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    })
    await notifyEvent({
      type: "emergency_submitted",
      recipients: cab.filter((m) => m.user.isActive).map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name })),
      change: { id: change.id, title: change.title, opcoId: change.opcoId },
      context: { requesterName: user.name ?? user.email },
    }).catch(() => {})
  }
```

Remove the now-unused `sendApprovalRequestEmail`/`sendEmergencyAlertEmail` imports **only if** they are no longer referenced anywhere else in the file (grep first; they likely aren't).

- [ ] **Step 2: Type-check + existing tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/actions/changes.test.ts`
Expected: PASS. If `changes.test.ts` mocked `@/server/email` for these sends, add a `vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))` to that test file and drop now-unused email-mock assertions for submit (keep the SoD/quorum/etc. tests intact). Run again → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "refactor(notify): route submitChange notifications through notifyEvent"
```

---

## Task 5: Refactor `submitApproval` to `notifyEvent`

**Files:** `src/server/actions/approvals.ts`

- [ ] **Step 1: Replace the two `sendStatusChangeEmail` calls**

In `src/server/actions/approvals.ts`, add `import { notifyEvent } from "@/server/notify"`.

In the `decision === "approve" && quorumMet` block, replace the `sendStatusChangeEmail` call (with its `if (requester)` guard) with:

```ts
    const requester = await db.user.findUnique({ where: { id: change.requesterId }, select: { id: true, email: true, name: true } })
    if (requester) {
      await notifyEvent({
        type: "change_approved",
        recipients: [{ userId: requester.id, email: requester.email, name: requester.name }],
        change: { id: changeId, title: change.title, opcoId: change.opcoId },
        context: { newStatus: "approved" },
      }).catch(() => {})
    }
```

In the `decision === "reject"` block, the same but `type: "change_rejected"` and `newStatus: "rejected"`. (`change.opcoId` must be selected on the `change` lookup near the top of `submitApproval` — if it isn't, add `opcoId: true` to that `select`/`include`.)

Remove the `sendStatusChangeEmail` import if no longer used.

- [ ] **Step 2: Type-check + tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/actions/approvals.test.ts`
Expected: PASS. If that test mocks `@/server/email`, add `vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))`. Keep the SoD/quorum/retrospective assertions. Run → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/approvals.ts src/test/actions/approvals.test.ts
git commit -m "refactor(notify): route approval decisions through notifyEvent"
```

---

## Task 6: Refactor SLA escalation to `notifyEvent`

**Files:** `src/server/sla.ts`, `src/test/server/sla.test.ts`

- [ ] **Step 1: Change recipient helpers to return `{ userId, email, name }`**

In `src/server/sla.ts`, replace `opcoAdminEmails` and `groupCabEmails`:

```ts
import { notifyEvent, type NotifyRecipient } from "@/server/notify"

async function opcoAdminRecipients(db: Db, opcoId: string): Promise<NotifyRecipient[]> {
  const rows = await db.userOpCoAssignment.findMany({
    where: { opcoId, role: "admin", isActive: true },
    select: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => ({ userId: r.user.id, email: r.user.email, name: r.user.name }))
}
async function groupCabRecipients(db: Db): Promise<NotifyRecipient[]> {
  const rows = await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    select: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => ({ userId: r.user.id, email: r.user.email, name: r.user.name }))
}
```

In the level loop, replace the `sendSlaEscalationEmail` `Promise.allSettled` with:

```ts
      const recipients = level === 1 ? await opcoAdminRecipients(db, c.opcoId) : await groupCabRecipients(db)
      await notifyEvent({
        type: "sla_escalated",
        recipients,
        change: { id: c.id, title: c.title, opcoId: c.opcoId },
        context: { level, riskLevel: c.riskLevel },
      }).catch(() => {})
```

Remove the now-unused `sendSlaEscalationEmail` import.

- [ ] **Step 2: Update the SLA test**

In `src/test/server/sla.test.ts`: the test currently mocks `@/server/email`'s `sendSlaEscalationEmail` and asserts on it. Replace that mock with `vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))` and rewrite the recipient/idempotency assertions to check `notifyEvent` was called with the expected `type: 'sla_escalated'` and recipients (assert on `vi.mocked(notifyEvent).mock.calls`). Keep the idempotency + level-crossing + scope tests. The `userOpCoAssignment.findMany` / `cABMembership.findMany` mocks must now return `[{ user: { id, email, isActive: true } }]` shapes.

```ts
// replace the email mock with:
vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))
import { notifyEvent } from '@/server/notify'
// ...in the level-1 test, after running:
expect(vi.mocked(notifyEvent)).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'sla_escalated', context: expect.objectContaining({ level: 1 }) })
)
```

- [ ] **Step 3: Run + commit**

Run: `pnpm tsc --noEmit && pnpm test src/test/server/sla.test.ts`
Expected: PASS.

```bash
git add src/server/sla.ts src/test/server/sla.test.ts
git commit -m "refactor(notify): route SLA escalation through notifyEvent"
```

---

## Task 7: Notification actions (TDD, db-mocked)

**Files:** `src/server/actions/notifications.ts`, `src/test/actions/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/actions/notifications.test.ts`:

```ts
// src/test/actions/notifications.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-me', email: 'me@x.com', name: 'Me',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }) },
  notification: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    count: vi.fn().mockResolvedValue(2),
  },
  changeRequest: { count: vi.fn().mockResolvedValue(5) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/approval-authority', () => ({
  listApprovableChanges: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
}))

import { getNavCounts, markAllNotificationsRead } from '@/server/actions/notifications'

beforeEach(() => { vi.clearAllMocks(); mockDb.user.findUnique.mockResolvedValue({ id: 'user-me' }) })

describe('getNavCounts', () => {
  it('returns pendingApprovals, myRequests and unreadNotifications', async () => {
    mockDb.changeRequest.count.mockResolvedValue(5)
    mockDb.notification.count.mockResolvedValue(2)
    const counts = await getNavCounts()
    expect(counts).toEqual({ pendingApprovals: 2, myRequests: 5, unreadNotifications: 2 })
  })
})

describe('markAllNotificationsRead', () => {
  it('marks all unread for the current user', async () => {
    await markAllNotificationsRead()
    expect(mockDb.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-me', readAt: null } })
    )
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/actions/notifications.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { listApprovableChanges } from "@/server/approval-authority"

async function meId(): Promise<string> {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) throw new Error("User not found")
  return u.id
}

export async function listMyNotifications() {
  const userId = await meId()
  const db = getPrisma()
  return db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 })
}

export async function markNotificationRead(id: string) {
  const userId = await meId()
  const db = getPrisma()
  await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } })
}

export async function markAllNotificationsRead() {
  const userId = await meId()
  const db = getPrisma()
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })
}

export async function getNavCounts() {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) return { pendingApprovals: 0, myRequests: 0, unreadNotifications: 0 }
  const [approvable, myRequests, unreadNotifications] = await Promise.all([
    listApprovableChanges({ userId: u.id, realmRoles: session.realmRoles }),
    db.changeRequest.count({ where: { requesterId: u.id } }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ])
  return { pendingApprovals: approvable.length, myRequests, unreadNotifications }
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/actions/notifications.ts src/test/actions/notifications.test.ts
git commit -m "feat(notify): notification feed + nav-count actions"
```

---

## Task 8: Wire AppShell counters + bell badge

**Files:** `src/components/app-shell.tsx`

- [ ] **Step 1: Fetch real counts**

In `src/components/app-shell.tsx`: add imports `import { usePathname } from "next/navigation"` (if not present) and `import { getNavCounts } from "@/server/actions/notifications"`. Near the other hooks, add:

```ts
  const pathname = usePathname() // if already declared above, reuse it; don't redeclare
  const [navCounts, setNavCounts] = useState({ pendingApprovals: 0, myRequests: 0, unreadNotifications: 0 })
  useEffect(() => {
    if (!currentUser) return
    getNavCounts().then(setNavCounts).catch(() => {})
  }, [currentUser, pathname])
```

Replace the hardcoded arrays (lines 122–125) — delete `myRequests`/`pendingApprovals` `unknown[]` declarations — and update the badge render sites: `{myRequests.length}` → `{navCounts.myRequests}`, `{pendingApprovals.length}` → `{navCounts.pendingApprovals}`.

- [ ] **Step 2: Add the header bell**

In the header button row (next to the Log out button, ~line 399), add before it:

```tsx
                {currentUser && (
                  <Link
                    href="/notifications/history"
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    aria-label={translate("nav.notificationHistory")}
                  >
                    <Bell className="h-4 w-4" />
                    {navCounts.unreadNotifications > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                        {navCounts.unreadNotifications}
                      </span>
                    )}
                  </Link>
                )}
```

(`Bell` and `Link` are already imported in this file.)

- [ ] **Step 3: Type-check + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS. (If `usePathname`/`pathname` already exists in the component, reuse it instead of redeclaring.)

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(notify): wire sidebar counters + header bell badge"
```

---

## Task 9: Notification feed page

**Files:** `src/app/(dashboard)/notifications/history/page.tsx`, `src/app/(dashboard)/notifications/history/history-client.tsx`, `src/lib/i18n.ts`

- [ ] **Step 1: i18n** — in `src/lib/i18n.ts` add to EN map:

```ts
    "notif.subtitle": "Your notifications.",
    "notif.markAll": "Mark all read",
    "notif.empty": "No notifications yet.",
```

and FR:

```ts
    "notif.subtitle": "Vos notifications.",
    "notif.markAll": "Tout marquer comme lu",
    "notif.empty": "Aucune notification.",
```

- [ ] **Step 2: Server page** — overwrite `src/app/(dashboard)/notifications/history/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMyNotifications } from "@/server/actions/notifications"
import HistoryClient, { type NotifRow } from "./history-client"

export default async function NotificationHistoryPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const notifications = await listMyNotifications()
  const rows: NotifRow[] = notifications.map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body,
    changeId: n.changeId ?? null, read: n.readAt != null, createdAt: n.createdAt.toISOString(),
  }))
  return <HistoryClient rows={rows} />
}
```

- [ ] **Step 3: Client** — create `src/app/(dashboard)/notifications/history/history-client.tsx`:

```tsx
"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { markNotificationRead, markAllNotificationsRead } from "@/server/actions/notifications"

export type NotifRow = {
  id: string; type: string; title: string; body: string
  changeId: string | null; read: boolean; createdAt: string
}

export default function HistoryClient({ rows }: { rows: NotifRow[] }) {
  const { language } = useStore()
  const router = useRouter()
  const [, startTransition] = useTransition()

  const open = (n: NotifRow) => {
    startTransition(async () => {
      if (!n.read) await markNotificationRead(n.id).catch(() => {})
      if (n.changeId) router.push(`/changes/${n.changeId}`)
      else router.refresh()
    })
  }
  const markAll = () => startTransition(async () => { await markAllNotificationsRead().catch(() => {}); router.refresh() })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "nav.notificationHistory")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "notif.subtitle")}</p>
        </div>
        {rows.some((r) => !r.read) && <Button variant="outline" onClick={markAll}>{t(language, "notif.markAll")}</Button>}
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "notif.empty")}</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {rows.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-muted/50 ${n.read ? "" : "bg-muted/30"}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {!n.read && <span className="h-2 w-2 rounded-full bg-rose-600" />}
                      {n.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{n.body}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Type-check + lint + commit**

Run: `pnpm tsc --noEmit && pnpm lint` → PASS.

```bash
git add "src/app/(dashboard)/notifications/history/page.tsx" "src/app/(dashboard)/notifications/history/history-client.tsx" src/lib/i18n.ts
git commit -m "feat(notify): real notification feed page"
```

---

## Task 10: Preference matrix actions (TDD)

**Files:** `src/server/actions/notification-prefs.ts`, `src/test/actions/notification-prefs.test.ts`

- [ ] **Step 1: Failing test** — create `src/test/actions/notification-prefs.test.ts`:

```ts
// src/test/actions/notification-prefs.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({ keycloakId: 'kc-me', organizations: [], realmRoles: [] }),
}))
const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }) },
  notificationPreference: {
    findMany: vi.fn().mockResolvedValue([{ eventType: 'change_approved', channel: 'email', enabled: false }]),
    upsert: vi.fn().mockResolvedValue({}),
  },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { getMyPreferences, setMyPreference } from '@/server/actions/notification-prefs'

beforeEach(() => { vi.clearAllMocks(); mockDb.user.findUnique.mockResolvedValue({ id: 'user-me' }) })

describe('getMyPreferences', () => {
  it('returns the full matrix with defaults on and stored overrides applied', async () => {
    const prefs = await getMyPreferences()
    // 5 event types × 2 channels = 10 cells
    expect(prefs).toHaveLength(10)
    const approvedEmail = prefs.find((p) => p.eventType === 'change_approved' && p.channel === 'email')
    expect(approvedEmail!.enabled).toBe(false) // stored override
    const approvedInApp = prefs.find((p) => p.eventType === 'change_approved' && p.channel === 'in_app')
    expect(approvedInApp!.enabled).toBe(true) // default
  })
})

describe('setMyPreference', () => {
  it('upserts a preference for the current user', async () => {
    await setMyPreference('sla_escalated', 'email', false)
    expect(mockDb.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_eventType_channel: { userId: 'user-me', eventType: 'sla_escalated', channel: 'email' } },
      })
    )
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/actions/notification-prefs.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { NOTIFY_EVENT_TYPES, type NotifyEventType, type NotifyChannel } from "@/lib/notifications"

const CHANNELS: NotifyChannel[] = ["email", "in_app"]

async function meId(): Promise<string> {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) throw new Error("User not found")
  return u.id
}

export type PrefCell = { eventType: NotifyEventType; channel: NotifyChannel; enabled: boolean }

export async function getMyPreferences(): Promise<PrefCell[]> {
  const userId = await meId()
  const db = getPrisma()
  const rows = await db.notificationPreference.findMany({ where: { userId } })
  const stored = new Map(rows.map((r) => [`${r.eventType}:${r.channel}`, r.enabled]))
  const cells: PrefCell[] = []
  for (const eventType of NOTIFY_EVENT_TYPES) {
    for (const channel of CHANNELS) {
      const key = `${eventType}:${channel}`
      cells.push({ eventType, channel, enabled: stored.has(key) ? stored.get(key)! : true })
    }
  }
  return cells
}

export async function setMyPreference(eventType: NotifyEventType, channel: NotifyChannel, enabled: boolean) {
  const userId = await meId()
  const db = getPrisma()
  await db.notificationPreference.upsert({
    where: { userId_eventType_channel: { userId, eventType, channel } },
    create: { userId, eventType, channel, enabled },
    update: { enabled },
  })
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/actions/notification-prefs.ts src/test/actions/notification-prefs.test.ts
git commit -m "feat(notify): notification preference matrix actions"
```

---

## Task 11: Preferences settings page

**Files:** `src/app/(dashboard)/settings/notifications/page.tsx`, `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`, `src/lib/i18n.ts`

- [ ] **Step 1: i18n** — in `src/lib/i18n.ts` add to EN:

```ts
    "notifPrefs.subtitle": "Choose how you are notified for each event.",
    "notifPrefs.event": "Event",
    "notifPrefs.email": "Email",
    "notifPrefs.inApp": "In-app",
    "notifPrefs.saved": "Preference updated",
    "notifPrefs.failed": "Could not update preference",
    "notifEvent.approval_requested": "Approval requested",
    "notifEvent.change_approved": "Change approved",
    "notifEvent.change_rejected": "Change rejected",
    "notifEvent.sla_escalated": "SLA breached",
    "notifEvent.emergency_submitted": "Emergency change",
```

and the FR equivalents (translate the labels; keep the `notifEvent.*` keys identical):

```ts
    "notifPrefs.subtitle": "Choisissez comment vous êtes notifié pour chaque événement.",
    "notifPrefs.event": "Événement",
    "notifPrefs.email": "E-mail",
    "notifPrefs.inApp": "Dans l'app",
    "notifPrefs.saved": "Préférence mise à jour",
    "notifPrefs.failed": "Échec de la mise à jour",
    "notifEvent.approval_requested": "Approbation demandée",
    "notifEvent.change_approved": "Changement approuvé",
    "notifEvent.change_rejected": "Changement rejeté",
    "notifEvent.sla_escalated": "SLA dépassé",
    "notifEvent.emergency_submitted": "Changement d'urgence",
```

- [ ] **Step 2: Server page** — overwrite `src/app/(dashboard)/settings/notifications/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getMyPreferences } from "@/server/actions/notification-prefs"
import NotificationsPrefsClient from "./notifications-prefs-client"

export default async function NotificationSettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const prefs = await getMyPreferences()
  return <NotificationsPrefsClient prefs={prefs} />
}
```

- [ ] **Step 3: Client** — create `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { NOTIFY_EVENT_TYPES, type NotifyChannel } from "@/lib/notifications"
import { setMyPreference, type PrefCell } from "@/server/actions/notification-prefs"

const CHANNELS: NotifyChannel[] = ["email", "in_app"]

export default function NotificationsPrefsClient({ prefs }: { prefs: PrefCell[] }) {
  const { language } = useStore()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [cells, setCells] = useState(() => new Map(prefs.map((p) => [`${p.eventType}:${p.channel}`, p.enabled])))

  const toggle = (eventType: string, channel: NotifyChannel) => {
    const key = `${eventType}:${channel}`
    const next = !cells.get(key)
    setCells((m) => new Map(m).set(key, next))
    startTransition(async () => {
      try {
        await setMyPreference(eventType as PrefCell["eventType"], channel, next)
        toast({ title: t(language, "notifPrefs.saved"), variant: "success" })
      } catch (err) {
        setCells((m) => new Map(m).set(key, !next)) // revert
        toast({ title: t(language, "notifPrefs.failed"), description: err instanceof Error ? err.message : "", variant: "error" })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.notifications.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "notifPrefs.subtitle")}</p>
      </div>
      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t(language, "notifPrefs.event")}</th>
                <th className="px-4 py-2 font-medium text-center">{t(language, "notifPrefs.email")}</th>
                <th className="px-4 py-2 font-medium text-center">{t(language, "notifPrefs.inApp")}</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_EVENT_TYPES.map((evt) => (
                <tr key={evt} className="border-b border-border/40">
                  <td className="px-4 py-2">{t(language, `notifEvent.${evt}`)}</td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={cells.get(`${evt}:${ch}`) ?? true}
                        onChange={() => toggle(evt, ch)}
                        aria-label={`${evt} ${ch}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Type-check + lint + commit**

Run: `pnpm tsc --noEmit && pnpm lint` → PASS.

```bash
git add "src/app/(dashboard)/settings/notifications/page.tsx" "src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx" src/lib/i18n.ts
git commit -m "feat(notify): preference matrix settings page"
```

---

## Task 12: Chat webhook actions (TDD)

**Files:** `src/server/actions/chat-webhooks.ts`, `src/test/actions/chat-webhooks.test.ts`

- [ ] **Step 1: Failing test** — create `src/test/actions/chat-webhooks.test.ts`:

```ts
// src/test/actions/chat-webhooks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin', organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  chatWebhook: { create: vi.fn(async () => ({ id: 'w1' })), update: vi.fn(async () => ({ id: 'w1' })), findFirst: vi.fn(async () => null) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  chatWebhook: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { upsertChatWebhook } from '@/server/actions/chat-webhooks'

beforeEach(() => { vi.clearAllMocks(); mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }); mockDb.chatWebhook.findFirst.mockResolvedValue(null) })

describe('upsertChatWebhook', () => {
  it('creates an OpCo webhook for an OpCo admin + audits it', async () => {
    await upsertChatWebhook({ opcoSlug: 'ghana', url: 'https://chat.googleapis.com/v1/spaces/x' })
    expect(tx.chatWebhook.create).toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'chat_webhook_set' }) })
    )
  })

  it('rejects a non-Google-Chat URL', async () => {
    await expect(upsertChatWebhook({ opcoSlug: 'ghana', url: 'https://evil.example/x' })).rejects.toThrow(/chat\.googleapis\.com/)
  })

  it('forbids an OpCo admin configuring the group webhook', async () => {
    await expect(upsertChatWebhook({ opcoSlug: null, url: 'https://chat.googleapis.com/x' })).rejects.toThrow(/Forbidden/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create `src/server/actions/chat-webhooks.ts`:

```ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const ok = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!ok) throw new Error("Forbidden: not authorized to manage this Chat webhook")
  return session
}

export async function listChatWebhooks() {
  const session = await getAppSession()
  const db = getPrisma()
  const slugs = session.organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
  const where = isGroupAdmin(session.realmRoles)
    ? {}
    : { OR: [{ opco: { slug: { in: slugs } } }] }
  return db.chatWebhook.findMany({ where, include: { opco: { select: { name: true, slug: true } } }, orderBy: { createdAt: "desc" } })
}

export async function upsertChatWebhook(input: { opcoSlug: string | null; url: string }) {
  if (!/^https:\/\/chat\.googleapis\.com\//.test(input.url))
    throw new Error("URL must be a Google Chat webhook (https://chat.googleapis.com/...)")
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")
  const opcoId = opco?.id ?? null

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
    if (!actor) throw new Error("User not found")
    const existing = await tx.chatWebhook.findFirst({ where: { opcoId } })
    const hook = existing
      ? await tx.chatWebhook.update({ where: { id: existing.id }, data: { url: input.url, isActive: true } })
      : await tx.chatWebhook.create({ data: { opcoId, url: input.url, createdById: actor.id } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "chat_webhook_set",
      opcoId, summary: `Set Google Chat webhook for ${input.opcoSlug ?? "group"}`,
    })
    return hook
  })
}

export async function setChatWebhookActive(id: string, isActive: boolean) {
  const db = getPrisma()
  const hook = await db.chatWebhook.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!hook) throw new Error("Webhook not found")
  await assertCanManage(hook.opco?.slug ?? null)
  await db.chatWebhook.update({ where: { id }, data: { isActive } })
}

export async function deleteChatWebhook(id: string) {
  const db = getPrisma()
  const hook = await db.chatWebhook.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!hook) throw new Error("Webhook not found")
  const session = await assertCanManage(hook.opco?.slug ?? null)
  await db.$transaction(async (tx) => {
    await tx.chatWebhook.delete({ where: { id } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "chat_webhook_removed",
      opcoId: hook.opcoId, summary: `Removed Google Chat webhook for ${hook.opco?.slug ?? "group"}`,
    })
  })
}
```

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add src/server/actions/chat-webhooks.ts src/test/actions/chat-webhooks.test.ts
git commit -m "feat(notify): Google Chat webhook CRUD actions"
```

---

## Task 13: Integrations settings page (Chat webhooks)

**Files:** `src/app/(dashboard)/settings/integrations/page.tsx`, `src/app/(dashboard)/settings/integrations/integrations-client.tsx`, `src/lib/i18n.ts`

- [ ] **Step 1: i18n** — in `src/lib/i18n.ts` add to EN:

```ts
    "chat.title": "Google Chat webhooks",
    "chat.subtitle": "Broadcast team-wide change events to Google Chat spaces.",
    "chat.scope": "Scope",
    "chat.url": "Webhook URL",
    "chat.active": "Active",
    "chat.save": "Save webhook",
    "chat.remove": "Remove",
    "chat.group": "Group",
    "chat.saved": "Webhook saved",
    "chat.removed": "Webhook removed",
    "chat.failed": "Could not save webhook",
    "chat.empty": "No webhooks configured.",
```

and FR:

```ts
    "chat.title": "Webhooks Google Chat",
    "chat.subtitle": "Diffuser les événements de changement aux espaces Google Chat.",
    "chat.scope": "Portée",
    "chat.url": "URL du webhook",
    "chat.active": "Actif",
    "chat.save": "Enregistrer",
    "chat.remove": "Supprimer",
    "chat.group": "Groupe",
    "chat.saved": "Webhook enregistré",
    "chat.removed": "Webhook supprimé",
    "chat.failed": "Échec de l'enregistrement",
    "chat.empty": "Aucun webhook configuré.",
```

- [ ] **Step 2: Server page** — overwrite `src/app/(dashboard)/settings/integrations/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listChatWebhooks } from "@/server/actions/chat-webhooks"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import IntegrationsClient, { type WebhookRow } from "./integrations-client"

export default async function IntegrationsSettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const canManage = canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
  const webhooks = canManage ? await listChatWebhooks() : []
  const rows: WebhookRow[] = webhooks.map((w) => ({
    id: w.id, opcoSlug: w.opco?.slug ?? null, opcoName: w.opco?.name ?? null,
    url: w.url, isActive: w.isActive,
  }))
  const scopes = [
    ...(isGroupAdmin(session.user.realmRoles) ? [{ slug: "", name: "Group" }] : []),
    ...session.user.organizations.filter((o) => o.roles.includes("admin")).map((o) => ({ slug: o.alias, name: o.name })),
  ]
  return <IntegrationsClient rows={rows} canManage={canManage} scopes={scopes} />
}
```

- [ ] **Step 3: Client** — create `src/app/(dashboard)/settings/integrations/integrations-client.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { upsertChatWebhook, setChatWebhookActive, deleteChatWebhook } from "@/server/actions/chat-webhooks"

export type WebhookRow = { id: string; opcoSlug: string | null; opcoName: string | null; url: string; isActive: boolean }

export default function IntegrationsClient({
  rows, canManage, scopes,
}: { rows: WebhookRow[]; canManage: boolean; scopes: { slug: string; name: string }[] }) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [scope, setScope] = useState(scopes[0]?.slug ?? "")
  const [url, setUrl] = useState("")

  const run = (fn: () => Promise<unknown>, okKey: string) =>
    startTransition(async () => {
      try { await fn(); toast({ title: t(language, okKey), variant: "success" }); router.refresh() }
      catch (err) { toast({ title: t(language, "chat.failed"), description: err instanceof Error ? err.message : "", variant: "error" }) }
    })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "chat.subtitle")}</p>
      </div>

      {canManage && scopes.length > 0 && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader><CardTitle className="text-base">{t(language, "chat.title")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="text-xs">{t(language, "chat.scope")}
              <select className="mt-1 block w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={scope} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (<option key={s.slug} value={s.slug}>{s.name}</option>))}
              </select>
            </label>
            <div className="flex-1 min-w-64">
              <label className="text-xs">{t(language, "chat.url")}</label>
              <Input placeholder="https://chat.googleapis.com/..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <Button onClick={() => run(() => upsertChatWebhook({ opcoSlug: scope || null, url }), "chat.saved")}>{t(language, "chat.save")}</Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "chat.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t(language, "chat.scope")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "chat.url")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "chat.active")}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-border/40">
                    <td className="px-4 py-2">{w.opcoName ?? t(language, "chat.group")}</td>
                    <td className="px-4 py-2 truncate max-w-xs">{w.url}</td>
                    <td className="px-4 py-2">{w.isActive ? "✓" : "—"}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-right space-x-3">
                        <button className="text-xs text-primary hover:underline" onClick={() => run(() => setChatWebhookActive(w.id, !w.isActive), "chat.saved")}>{w.isActive ? t(language, "chat.active") + " ✕" : t(language, "chat.active")}</button>
                        <button className="text-xs text-rose-600 hover:underline" onClick={() => run(() => deleteChatWebhook(w.id), "chat.removed")}>{t(language, "chat.remove")}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Type-check + lint + commit**

Run: `pnpm tsc --noEmit && pnpm lint` → PASS. (Verify `Input` import path `@/components/ui/input`.)

```bash
git add "src/app/(dashboard)/settings/integrations/page.tsx" "src/app/(dashboard)/settings/integrations/integrations-client.tsx" src/lib/i18n.ts
git commit -m "feat(notify): Google Chat webhook config on integrations page"
```

---

## Task 14: Full verification + live migration + Playwright smoke

**Files:** none (verification)

- [ ] **Step 1: Full gate** — `pnpm tsc --noEmit && pnpm lint && pnpm test`. tsc clean, lint 0 errors, all suites pass (existing + new `notifications`, `notify`, `notification-prefs`, `chat-webhooks` + the updated `changes`/`approvals`/`sla` tests). Fix regressions.

- [ ] **Step 2: Build** — `pnpm build` succeeds; `/notifications/history`, `/settings/notifications`, `/settings/integrations` build.

- [ ] **Step 3: Apply migration live + restart dev**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/csquared_cms' pnpm prisma migrate deploy
```
Restart `pnpm dev` (cached Prisma client must pick up the new models).

- [ ] **Step 4: Playwright smoke** (`devops@csquared.com` / `Admin2025$`):
  - Submit a change → confirm the routed approver's **Approvals counter** increments and a notification appears in `/notifications/history` + the **bell badge** shows a count.
  - Approve a change → its requester gets a `change_approved` notification; "Mark all read" clears the badge.
  - In `/settings/notifications`, untick `change_approved` / In-app, approve another change, confirm no new in-app row for that event.
  - In `/settings/integrations`, add a webhook with a dummy `https://chat.googleapis.com/...` URL; trigger a broadcast event (e.g. emergency submit) and confirm via DB/network that a POST was attempted and an `AdminAuditLog` `chat_webhook_set` row exists.

- [ ] **Step 5: Final commit (only if smoke required fixes)**

```bash
git add -A && git commit -m "fix(bundle3): smoke-test adjustments"
```

---

## Self-Review notes (spec coverage)

- **Dispatch layer:** Tasks 2–3 (pure helpers + `notifyEvent`), Tasks 4–6 (refactor all 4 call sites; SLA helpers now yield `userId`). ✅
- **Part A:** Task 1 (model), Task 7 (feed + nav-count actions), Task 8 (counters + bell), Task 9 (feed page). Toast audit folded into Task 14 (most actions already toast). ✅
- **Part B:** Task 10 (matrix actions, default-on), Task 11 (settings grid). ✅
- **Part C:** Task 1 (model), Task 12 (CRUD + URL validation + AdminAuditLog), Task 13 (integrations page). ✅
- **i18n (en+fr):** Tasks 9, 11, 13. ✅
- **Decisions honored:** 5 event types, 4 chat-broadcast types, default-on prefs, no realtime, bell links to feed, URL validated to `chat.googleapis.com`.
