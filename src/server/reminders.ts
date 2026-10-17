// src/server/reminders.ts
// Recurring notification sweep, run from /api/cron/sla alongside SLA escalation.
// Idempotency comes from the NotificationDispatch ledger: each reminder type has a
// minimum interval, so a frequent cron cannot re-send the same nudge every run.
import { getPrisma } from "@/server/db"
import { notifyChange } from "@/server/notify"
import { resolveAudience } from "@/server/audience"
import { SLA_HOURS } from "@/lib/sla"
import { utcStamp } from "@/lib/dates"
import type { NotifyEventType } from "@/lib/notifications"
import type { RiskLevel } from "@prisma/client"

const HOUR = 60 * 60 * 1000
const NUDGE_INTERVAL_MS = 24 * HOUR
/** How close to the retrospective-approval deadline the first reminder fires. */
const RETRO_WINDOW_MS = 12 * HOUR
const RETRO_INTERVAL_MS = 12 * HOUR

type Db = ReturnType<typeof getPrisma>

/**
 * Records the reminder in the ledger unless one went out within `withinMs`; true means
 * "send it". Check and write share a transaction behind the change's row lock, so two
 * overlapping sweeps can't both see no row and both send.
 */
function claim(db: Db, userId: string, changeId: string, type: NotifyEventType, withinMs: number): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ChangeRequest" WHERE "id" = ${changeId} FOR UPDATE`
    const recent = await tx.notificationDispatch.findFirst({
      where: { userId, changeId, type, sentAt: { gte: new Date(Date.now() - withinMs) } },
      select: { id: true },
    })
    if (recent) return false
    await tx.notificationDispatch.create({ data: { userId, changeId, type } })
    return true
  })
}

export async function runDueReminders(): Promise<{ nudged: number; retroOverdue: number }> {
  const db = getPrisma()
  const now = Date.now()

  const pending = await db.changeRequest.findMany({
    where: { status: "pending" },
    select: {
      id: true, riskLevel: true, opcoId: true, infrastructureType: true,
      requesterId: true, slaDeadline: true,
    },
  })
  const expedited = await db.changeRequest.findMany({
    // A retrospective rejection is final (only approval sets retroApprovedAt), so it ends the reminders too.
    where: {
      expedited: true, retroApprovedAt: null, retroApprovalDueAt: { not: null },
      auditTrail: { none: { action: "retro_rejected" } },
    },
    select: {
      id: true, opcoId: true, infrastructureType: true, requesterId: true, retroApprovalDueAt: true,
    },
  })

  let nudged = 0
  for (const c of pending) {
    // Nudge only in the back half of the SLA window, which submission starts (slaDeadline is
    // set then). Once breached, sla_escalated owns it.
    if (!c.slaDeadline) continue
    const leftMs = c.slaDeadline.getTime() - now
    if (leftMs > (SLA_HOURS[c.riskLevel as RiskLevel] * HOUR) / 2 || leftMs <= 0) continue

    const recipients = await resolveAudience("approver_nudge", {
      id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType, requesterId: c.requesterId,
    })
    for (const r of recipients) {
      if (!(await claim(db, r.userId, c.id, "approver_nudge", NUDGE_INTERVAL_MS))) continue
      await notifyChange("approver_nudge", c.id, { recipients: [r], dispatchClaimed: true })
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
      if (!(await claim(db, r.userId, c.id, "retro_overdue", RETRO_INTERVAL_MS))) continue
      await notifyChange("retro_overdue", c.id, {
        recipients: [r],
        dispatchClaimed: true,
        dueAt: utcStamp(c.retroApprovalDueAt!),
      })
      retroOverdue++
    }
  }

  return { nudged, retroOverdue }
}
