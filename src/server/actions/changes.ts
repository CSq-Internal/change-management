// src/server/actions/changes.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { sendApprovalRequestEmail } from "@/server/email"
import type { ChangeCategory, RiskLevel, ChangeStatus } from "@prisma/client"

const SLA_HOURS: Record<RiskLevel, number> = { low: 48, medium: 24, high: 4, emergency: 1 }

type CreateChangeInput = {
  title: string
  description: string
  category: ChangeCategory
  riskLevel: RiskLevel
  contactEmail: string
  infrastructureType: string
  changeReason?: string
  impactScope?: string
  implementationPlan?: string
  testingPlan?: string
  backoutPlan?: string
  changeWindow?: string
  plannedStart?: Date
  plannedEnd?: Date
  isEmergency?: boolean
}

export async function listChanges(opcoSlug: string) {
  await getAppSession()
  const db = getPrisma()
  return db.changeRequest.findMany({
    where: { opco: { slug: opcoSlug } },
    include: { requester: true, approvals: true, opco: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function createChange(opcoSlug: string, data: CreateChangeInput) {
  const session = await getAppSession()
  const db = getPrisma()

  const [opco, user] = await Promise.all([
    db.opCo.findUnique({ where: { slug: opcoSlug } }),
    db.user.findUnique({ where: { keycloakId: session.keycloakId } }),
  ])

  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)
  if (!user) throw new Error("User not found in database")

  if (!data.isEmergency) {
    const now = new Date()
    const activeBlackouts = await db.blackoutPeriod.findMany({
      where: {
        OR: [{ opcoId: opco.id }, { opcoId: null }],
        startsAt: { lte: now }, endsAt: { gte: now },
      },
    })
    if (activeBlackouts.length > 0) {
      throw new Error(`Blocked by blackout: "${activeBlackouts[0].label}". Submit as emergency to override.`)
    }
  }

  const slaDeadline = new Date()
  slaDeadline.setHours(slaDeadline.getHours() + SLA_HOURS[data.riskLevel])

  const change = await db.changeRequest.create({
    data: { ...data, opcoId: opco.id, requesterId: user.id, status: "draft", slaDeadline },
  })

  await db.auditLog.create({
    data: { changeId: change.id, actorId: user.id, action: "created", toStatus: "draft" },
  })

  const approvers = await db.userOpCoAssignment.findMany({
    where: { opcoId: opco.id, role: "approver", isActive: true },
    include: { user: true },
  })
  await Promise.allSettled(approvers.map((a) =>
    sendApprovalRequestEmail({
      to: a.user.email, approverName: a.user.name ?? a.user.email,
      changeTitle: change.title, requesterName: user.name ?? user.email,
      riskLevel: change.riskLevel, changeId: change.id,
    })
  ))

  return change
}

const VALID_TRANSITIONS: Partial<Record<ChangeStatus, ChangeStatus[]>> = {
  draft: ["pending"],
  pending: ["approved", "rejected"],
  approved: ["implemented"],
  implemented: ["verified"],
  verified: ["closed"],
  rejected: ["draft"],
}

export async function updateChangeStatus(changeId: string, toStatus: ChangeStatus, note?: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id: changeId } })
  if (!change) throw new Error("Change not found")

  if (!VALID_TRANSITIONS[change.status]?.includes(toStatus)) {
    throw new Error(`Invalid transition: ${change.status} → ${toStatus}`)
  }

  const updated = await db.changeRequest.update({ where: { id: changeId }, data: { status: toStatus } })
  await db.auditLog.create({
    data: { changeId, actorId: user.id, action: "status_changed", fromStatus: change.status, toStatus, note },
  })
  return updated
}
