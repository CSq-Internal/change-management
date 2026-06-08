# v1.0 Completion — Bundle 3: Notifications — Design

**Date:** 2026-06-08
**Branch:** `feat/v1-notifications` (off `dev`)
**Source:** PRD v1.0 gap analysis — in-app notifications, per-user preferences, and Google Chat webhooks; also wires the stuck sidebar counters and broadens toast coverage.

## Goal

1. **In-app notifications** — a per-user `Notification` feed (real `/notifications/history`), a header bell with an unread badge, and the now-broken sidebar counters (Requests/Approvals) wired to real data.
2. **Per-user preference matrix** — every notification event type toggled per channel (email / in-app); real `/settings/notifications`.
3. **Google Chat webhooks** — admin-configured per-OpCo + group webhooks (on `/settings/integrations`) that broadcast team-wide events.
4. **Toast coverage** — every key lifecycle action surfaces a success/error toast.

All channels flow through one **dispatch layer** so preferences are enforced in a single place.

## Locked decisions (confirmed 2026-06-08)

- **Preference granularity:** full **event-type × channel** matrix.
- **Google Chat scope:** per-OpCo + group webhooks; broadcast team-wide events; configured on the existing `/settings/integrations` page.
- **Digest emails:** out of scope (no aggregation scheduler in v1).
- **No realtime:** counts and feed refresh on navigation (no websockets).
- **Event types (5):** `approval_requested`, `change_approved`, `change_rejected`, `sla_escalated`, `emergency_submitted`.
- **Channels (per-user prefs):** `email`, `in_app`. (Chat is a broadcast channel, not a per-user preference.)
- **Chat broadcast events (4):** `emergency_submitted`, `sla_escalated`, `change_approved`, `change_rejected` (not the per-approver `approval_requested`).
- **Default preference:** a missing preference row means the channel is **on**.

---

## Central dispatch layer

### Pure helpers — `src/lib/notifications.ts` (unit-tested)

```ts
export type NotifyEventType =
  | "approval_requested" | "change_approved" | "change_rejected"
  | "sla_escalated" | "emergency_submitted"

export type NotifyChannel = "email" | "in_app"

export const NOTIFY_EVENT_TYPES: NotifyEventType[] = [
  "approval_requested", "change_approved", "change_rejected", "sla_escalated", "emergency_submitted",
]
export const CHAT_BROADCAST_TYPES: NotifyEventType[] = [
  "emergency_submitted", "sla_escalated", "change_approved", "change_rejected",
]

export type NotifyContext = { requesterName?: string; newStatus?: string; level?: number; riskLevel?: string }

// In-app + chat copy (emails keep their existing templates).
export function notificationContent(type: NotifyEventType, changeTitle: string, ctx: NotifyContext): { title: string; body: string }

// Preference lookup with default-on. prefs keyed `${userId}:${type}:${channel}`.
export function isChannelEnabled(prefs: Map<string, boolean>, userId: string, type: NotifyEventType, channel: NotifyChannel): boolean

// One-line Google Chat message text for a broadcast event.
export function chatMessageText(type: NotifyEventType, changeTitle: string, ctx: NotifyContext): string
```

### Orchestration — `src/server/notify.ts` (db-mocked test)

```ts
export type NotifyRecipient = { userId: string; email: string; name: string | null }

export async function notifyEvent(input: {
  type: NotifyEventType
  recipients: NotifyRecipient[]
  change: { id: string; title: string; opcoId: string }
  context?: NotifyContext
}): Promise<void>
```

- Load preference rows for `recipients[].userId` × the event type in one query → `Map`.
- Per recipient: `isChannelEnabled(...,"in_app")` → create a `Notification`; `isChannelEnabled(...,"email")` → call the matching existing `send*Email`.
- If `CHAT_BROADCAST_TYPES.includes(type)`: load active `ChatWebhook`s where `opcoId = change.opcoId OR opcoId IS NULL`, and `postToChat(url, chatMessageText(...))` to each.
- Everything best-effort (`Promise.allSettled`); never throws into the caller. The existing `.catch(()=>{})` call sites become `await notifyEvent(...).catch(()=>{})` (or fire-and-forget where they already are).
- `postToChat(url, text)` = `fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text }) })`, best-effort.

### Email-template mapping (unchanged templates, called by `notifyEvent`)

- `approval_requested` → `sendApprovalRequestEmail`
- `change_approved` / `change_rejected` → `sendStatusChangeEmail` (newStatus from `ctx`)
- `sla_escalated` → `sendSlaEscalationEmail` (level from `ctx`)
- `emergency_submitted` → `sendEmergencyAlertEmail` (requesterName from `ctx`)

---

## Schema (`prisma/schema.prisma`, + migration)

```prisma
enum NotificationChannel {
  email
  in_app
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation("UserNotifications", fields: [userId], references: [id])
  type      String                     // a NotifyEventType
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
  opcoId      String?                    // null = group space
  opco        OpCo?    @relation(fields: [opcoId], references: [id])
  url         String
  isActive    Boolean  @default(true)
  createdById String
  createdBy   User     @relation("ChatWebhookAuthor", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())

  @@index([opcoId])
}
```

Back-relations: `User` gets `notifications`, `notifPrefs`, `chatWebhooks`; `OpCo` gets `chatWebhooks ChatWebhook[]`.

---

## Part A — In-app notifications, counters, toasts

**Notification actions (`src/server/actions/notifications.ts`):**
- `listMyNotifications()` — current user's notifications, newest first, `take: 50`.
- `markNotificationRead(id)` — set `readAt = now` (only own).
- `markAllNotificationsRead()` — set `readAt = now` for all own unread.
- `getNavCounts()` — `{ pendingApprovals, myRequests, unreadNotifications }` scoped to the current user: `pendingApprovals = listApprovableChanges(...).length`; `myRequests = count(changeRequest where requesterId = me)`; `unreadNotifications = count(notification where userId = me, readAt = null)`.

**Header bell (`src/components/app-shell.tsx`):** a Bell button linking to `/notifications/history` with an unread-count badge. On mount and on `pathname` change, call `getNavCounts()` and store the three counts in component state; replace the hardcoded `myRequests`/`pendingApprovals` arrays (lines 123–125) with the real counts.

**Feed page (`/notifications/history`):** server component loads `listMyNotifications()`; client renders the list (unread = highlighted), each row links to its change (and marks itself read), plus a "Mark all read" button. Replaces the static stub.

**Toast coverage:** audit these client actions and ensure each `await`s the server action and toasts success/error: submit, approve, reject, implement, verify/PIR, reschedule (done), risk create/edit (done), blackout create. Fill any gaps (most already toast).

---

## Part B — Preference matrix

**Actions (`src/server/actions/notification-prefs.ts`):**
- `getMyPreferences()` — returns the full matrix for the current user: for each `(eventType × channel)`, the stored `enabled` or `true` (default-on).
- `setMyPreference(eventType, channel, enabled)` — upsert on `(userId, eventType, channel)`.

**`/settings/notifications`:** real grid — rows = the 5 event types (labelled), columns = Email / In-app, a checkbox per cell. Toggling calls `setMyPreference` and reflects state. The old email-on/off + digest cards are replaced.

---

## Part C — Google Chat webhooks

**Actions (`src/server/actions/chat-webhooks.ts`):**
- `listChatWebhooks()` — scoped: group_admin sees all + the group webhook; OpCo admins see their OpCos'.
- `upsertChatWebhook({ opcoSlug, url })` — `opcoSlug = null` → group (requires `group_admin`); otherwise requires OpCo admin. One webhook per scope (unique-ish: upsert by scope). Validate `url` starts with `https://chat.googleapis.com/`.
- `setChatWebhookActive(id, isActive)` / `deleteChatWebhook(id)` — same permission as the webhook's scope.
- All audited to `AdminAuditLog` (`chat_webhook_set` / `chat_webhook_removed`).

**`/settings/integrations`:** wire the existing stub — list configured webhooks for the admin's manageable scopes, with add/edit (url), activate toggle, and delete. Admin-gated.

---

## Files

**Create:**
- `src/lib/notifications.ts` + `src/test/lib/notifications.test.ts`
- `src/server/notify.ts` + `src/test/server/notify.test.ts`
- `src/server/actions/notifications.ts` + `src/test/actions/notifications.test.ts`
- `src/server/actions/notification-prefs.ts`
- `src/server/actions/chat-webhooks.ts` + `src/test/actions/chat-webhooks.test.ts`
- `src/app/(dashboard)/notifications/history/history-client.tsx`
- `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`
- `src/app/(dashboard)/settings/integrations/integrations-client.tsx`
- `prisma/migrations/<ts>_notifications/migration.sql`

**Modify:**
- `prisma/schema.prisma` — `NotificationChannel`, `Notification`, `NotificationPreference`, `ChatWebhook` + back-relations.
- `src/server/actions/changes.ts` — `submitChange` uses `notifyEvent` (approval_requested + emergency_submitted).
- `src/server/actions/approvals.ts` — `submitApproval` uses `notifyEvent` (change_approved / change_rejected).
- `src/server/sla.ts` — `runDueEscalations` uses `notifyEvent` (sla_escalated); recipient helpers return `{ userId, email, name }`.
- `src/components/app-shell.tsx` — real nav counts + bell badge.
- `src/app/(dashboard)/notifications/history/page.tsx` — server component.
- `src/app/(dashboard)/settings/notifications/page.tsx` — server shell for the matrix.
- `src/app/(dashboard)/settings/integrations/page.tsx` — server shell for webhooks.
- `src/lib/i18n.ts` — strings (en + fr).

## Testing

- **Unit (`src/lib/notifications.ts`):** `notificationContent` per type; `isChannelEnabled` default-on + explicit-off; `chatMessageText`.
- **`notify.ts` (db-mocked):** creates `Notification` only for in-app-enabled recipients; calls the right email fn only for email-enabled; posts to chat webhooks for broadcast types and not for `approval_requested`; best-effort (a throwing email/webhook doesn't break others).
- **Actions (db-mocked):** `getNavCounts` scope; `markAllNotificationsRead`; `setMyPreference` upsert; chat-webhook CRUD permission (group vs OpCo) + URL validation + AdminAuditLog.
- **Playwright smoke:** submit a change → routed approver's bell badge + Approvals counter increment, notification visible in the feed; approve → requester gets a `change_approved` notification; mute `change_approved`/in_app in settings and confirm no in-app row on the next approval; add a Chat webhook (dummy `https://chat.googleapis.com/...` URL) and confirm a post is attempted + audited.

## Out of scope (this bundle)

Digest emails; SMS/Discord/PagerDuty/etc. (the Alert Manager stub stays a placeholder); realtime push/websockets; notification retention/cleanup jobs.
