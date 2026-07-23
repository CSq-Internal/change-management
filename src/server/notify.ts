// src/server/notify.ts
import { getPrisma } from "@/server/db"
import {
  notificationContent, chatMessageText, isChannelEnabled,
  CHAT_BROADCAST_TYPES, type NotifyEventType, type NotifyContext,
} from "@/lib/notifications"
import {
  sendApprovalRequestEmail, sendStatusChangeEmail, sendSlaEscalationEmail, sendEmergencyAlertEmail,
} from "@/server/email"
import { coerceLocale, type Language } from "@/lib/i18n"

type Db = ReturnType<typeof getPrisma>
export type NotifyRecipient = { userId: string; email: string; name: string | null }

async function loadPrefs(db: Db, userIds: string[], type: NotifyEventType): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map()
  const rows = await db.notificationPreference.findMany({ where: { userId: { in: userIds }, eventType: type } })
  const m = new Map<string, boolean>()
  for (const r of rows) m.set(`${r.userId}:${r.eventType}:${r.channel}`, r.enabled)
  return m
}

function emailFor(type: NotifyEventType, r: NotifyRecipient, change: { id: string; title: string }, ctx: NotifyContext, locale: Language): Promise<unknown> {
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
    default:
      // The expanded event types render through a generic template, wired up when
      // notifyChange lands. Nothing dispatches them yet, so there is nothing to send.
      return Promise.resolve()
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

  const recipientIds = recipients.map((r) => r.userId)
  const [users, opco] = await Promise.all([
    recipientIds.length
      ? db.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, locale: true } })
      : Promise.resolve([] as { id: string; locale: string | null }[]),
    db.opCo.findUnique({ where: { id: change.opcoId }, select: { locale: true } }),
  ])
  const userLocale = new Map(users.map((u) => [u.id, u.locale]))
  const opcoLocale = coerceLocale(opco?.locale)

  const tasks: Promise<unknown>[] = []
  for (const r of recipients) {
    const locale = coerceLocale(userLocale.get(r.userId) ?? opco?.locale)
    if (isChannelEnabled(prefs, r.userId, type, "in_app")) {
      const { title, body } = notificationContent(type, change.title, ctx, locale)
      tasks.push(db.notification.create({ data: { userId: r.userId, type, title, body, changeId: change.id } }))
    }
    if (isChannelEnabled(prefs, r.userId, type, "email")) {
      tasks.push(emailFor(type, r, change, ctx, locale))
    }
  }

  if (CHAT_BROADCAST_TYPES.includes(type)) {
    const hooks = await db.chatWebhook.findMany({ where: { isActive: true, OR: [{ opcoId: change.opcoId }, { opcoId: null }] } })
    const text = chatMessageText(type, change.title, ctx, opcoLocale)
    for (const h of hooks) tasks.push(postToChat(h.url, text))
  }

  await Promise.allSettled(tasks)
}

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
