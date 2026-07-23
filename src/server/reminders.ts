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

  const pending = await db.changeRequest.findMany({
    where: { status: "pending" },
    select: {
      id: true, riskLevel: true, opcoId: true, infrastructureType: true,
      requesterId: true, createdAt: true, slaDeadline: true,
    },
  })
  const expedited = await db.changeRequest.findMany({
    where: { expedited: true, retroApprovedAt: null, retroApprovalDueAt: { not: null } },
    select: {
      id: true, opcoId: true, infrastructureType: true, requesterId: true, retroApprovalDueAt: true,
    },
  })

  let nudged = 0
  for (const c of pending) {
    // Nudge only in the back half of the SLA window. Once breached, sla_escalated owns it.
    const windowMs = SLA_HOURS[c.riskLevel as RiskLevel] * HOUR
    if (now - c.createdAt.getTime() < windowMs / 2) continue
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
        recipients: [r],
        dueAt: c.retroApprovalDueAt!.toISOString().slice(0, 16).replace("T", " "),
      })
      retroOverdue++
    }
  }

  return { nudged, retroOverdue }
}
