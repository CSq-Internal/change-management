// src/server/sla.ts
// SLA escalation orchestration. Called lazily on page load and from the cron route.
import { getPrisma } from "@/server/db"
import { dueEscalationLevel, SLA_HOURS } from "@/lib/sla"
import { notifyEvent, type NotifyRecipient } from "@/server/notify"
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

/**
 * Escalate every pending change whose SLA breach has crossed a new tier.
 * Idempotent: a level already recorded on the change is never re-sent.
 * Best-effort emails (Promise.allSettled); escalation state advances regardless
 * so repeated reads don't re-spam.
 */
export async function runDueEscalations(
  { opcoSlugs }: { opcoSlugs?: string[] }
): Promise<{ escalated: number }> {
  const db = getPrisma()
  const now = Date.now()

  const changes = await db.changeRequest.findMany({
    where: {
      status: "pending",
      slaDeadline: { not: null },
      ...(opcoSlugs ? { opco: { slug: { in: opcoSlugs } } } : {}),
    },
    select: { id: true, title: true, riskLevel: true, opcoId: true, slaDeadline: true, escalationLevel: true },
  })

  let escalated = 0
  let actorId: string | null = null

  for (const c of changes) {
    const target = dueEscalationLevel(c.slaDeadline!.getTime(), SLA_HOURS[c.riskLevel as RiskLevel], now)
    if (target <= c.escalationLevel) continue

    actorId ??= await systemActorId(db)

    for (let level = c.escalationLevel + 1; level <= target; level++) {
      const recipients = level === 1 ? await opcoAdminRecipients(db, c.opcoId) : await groupCabRecipients(db)
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

    await db.changeRequest.update({
      where: { id: c.id },
      data: { escalationLevel: target, lastEscalatedAt: new Date(now) },
    })
    escalated++
  }

  return { escalated }
}
