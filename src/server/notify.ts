// src/server/notify.ts
import { getPrisma } from "@/server/db"
import {
  notificationContent, chatMessageText, isChannelEnabled,
  CHAT_BROADCAST_TYPES, type NotifyEventType, type NotifyContext,
} from "@/lib/notifications"
import {
  sendApprovalRequestEmail, sendStatusChangeEmail, sendSlaEscalationEmail, sendEmergencyAlertEmail,
  sendChangeEventEmail,
} from "@/server/email"
import { resolveAudience } from "@/server/audience"
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

/** Extra content the generic template needs; supplied by notifyChange, absent otherwise. */
type EmailDetail = {
  subject: string
  headline: string
  intro: string
  rows: [string, string][]
  note?: string
}

function emailFor(
  type: NotifyEventType, r: NotifyRecipient, change: { id: string; title: string },
  ctx: NotifyContext, locale: Language, detail?: EmailDetail,
): Promise<unknown> {
  switch (type) {
    case "approval_requested":
      return sendApprovalRequestEmail({ to: r.email, approverName: r.name ?? r.email, changeTitle: change.title, requesterName: ctx.requesterName ?? "", riskLevel: ctx.riskLevel ?? "", changeId: change.id, locale })
    case "change_approved":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "approved", changeId: change.id, locale })
    case "change_rejected":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "rejected", changeId: change.id, locale })
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

export async function postToChat(url: string, text: string): Promise<void> {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
}

export async function notifyEvent(input: {
  type: NotifyEventType
  recipients: NotifyRecipient[]
  change: { id: string; title: string; opcoId: string }
  context?: NotifyContext
  emailDetail?: EmailDetail
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
      tasks.push(emailFor(type, r, change, ctx, locale, input.emailDetail))
    }
    // Ledger row per recipient regardless of channel — it records that this person was
    // notified about this event, which is what the reminder sweep needs to know.
    tasks.push(db.notificationDispatch.create({ data: { userId: r.userId, changeId: change.id, type } }))
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

/** Detail rows shown in the generic email. Kept here so copy and data stay together. */
function detailRows(
  change: {
    title: string; riskLevel: string
    plannedStart: Date | null; plannedEnd: Date | null
    opco: { name: string }
  },
  locale: Language,
): [string, string][] {
  const fr = locale === "fr"
  const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ")
  const rows: [string, string][] = [
    [fr ? "Changement" : "Change", change.title],
    ["OpCo", change.opco.name],
    [fr ? "Risque" : "Risk", change.riskLevel],
  ]
  if (change.plannedStart && change.plannedEnd) {
    rows.push([fr ? "Fenêtre" : "Window", `${stamp(change.plannedStart)} – ${stamp(change.plannedEnd)}`])
  }
  return rows
}

/**
 * Event-driven notification facade. Loads the change once, resolves the audience (or uses
 * explicit recipients for the per-person assignment events), and fans out through
 * notifyEvent.
 *
 * Best-effort by contract: it never rejects, so a mail or webhook fault cannot fail the
 * domain operation that triggered it. Call sites still add `.catch(() => {})` — the guard
 * documents the intent locally. Keep this catch block empty; a swallowed bug is the price
 * of that guarantee and should not be compounded by logic hiding in here.
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

    // Subject and headline use the OpCo locale; per-recipient locale still applies to the
    // body inside notifyEvent, which re-derives copy for each user.
    const locale = coerceLocale(change.opco.locale)
    const { title, body } = notificationContent(type, change.title, rest, locale)

    await notifyEvent({
      type,
      recipients,
      change: { id: change.id, title: change.title, opcoId: change.opcoId },
      context: rest,
      emailDetail: {
        subject: `${title}: ${change.title}`,
        headline: title,
        intro: body,
        rows: detailRows(change, locale),
        note: rest.note,
      },
    })
  } catch {
    // Best-effort by contract — see the doc comment above.
  }
}
