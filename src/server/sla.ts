// src/server/sla.ts
// SLA escalation orchestration, run by the cron route (/api/cron/sla).
import { getPrisma } from "@/server/db"
import { dueEscalationLevel, SLA_HOURS } from "@/lib/sla"
import { notifyEvent } from "@/server/notify"
import { audienceFor } from "@/server/audience"
import type { RiskLevel } from "@prisma/client"

type Db = ReturnType<typeof getPrisma>

/** Lazily upsert an inactive "system" user so escalation audit entries have a valid actor FK. */
async function systemActorId(db: Db): Promise<string> {
  const u = await db.user.upsert({
    where: { keycloakId: "system" },
    update: {},
    create: { keycloakId: "system", email: "system@csquared.com", name: "System", isActive: false },
    select: { id: true },
  })
  return u.id
}

/**
 * Escalate every pending change whose SLA breach has crossed a new tier.
 * Idempotent: a level already recorded on the change is never re-sent.
 * Best-effort emails (Promise.allSettled); escalation state advances regardless
 * so repeated reads don't re-spam.
 */
export async function runDueEscalations(): Promise<{ escalated: number }> {
  const db = getPrisma()
  const now = Date.now()

  const changes = await db.changeRequest.findMany({
    where: {
      status: "pending",
      slaDeadline: { not: null },
    },
    select: {
      id: true, title: true, riskLevel: true, opcoId: true, slaDeadline: true, escalationLevel: true,
      infrastructureType: true, requesterId: true,
    },
  })

  let escalated = 0
  let actorId: string | null = null

  for (const c of changes) {
    const target = dueEscalationLevel(c.slaDeadline!.getTime(), SLA_HOURS[c.riskLevel as RiskLevel], now)
    if (target <= c.escalationLevel) continue

    // Claim the level before sending: only the run whose conditional write lands sends, so
    // overlapping runs (a manual trigger during the schedule, a retry) can't double-send.
    const { count } = await db.changeRequest.updateMany({
      where: { id: c.id, escalationLevel: c.escalationLevel },
      data: { escalationLevel: target, lastEscalatedAt: new Date(now) },
    })
    if (count === 0) continue

    actorId ??= await systemActorId(db)

    for (let level = c.escalationLevel + 1; level <= target; level++) {
      const recipients = await audienceFor([level === 1 ? "opcoAdmins" : "groupCab"], c)
      await notifyEvent({
        type: "sla_escalated",
        recipients,
        change: { id: c.id, title: c.title, opcoId: c.opcoId },
        context: { level, riskLevel: c.riskLevel },
      }).catch(() => {})
      await db.auditLog.create({
        data: { changeId: c.id, actorId, action: "sla_escalated", note: `Escalated to level ${level}` },
      })
    }
    escalated++
  }

  return { escalated }
}
