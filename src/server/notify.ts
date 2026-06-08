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
