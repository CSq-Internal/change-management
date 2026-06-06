// src/server/actions/changes.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo, isGroupLevel, isMemberOfOpCo, canApprove } from "@/lib/permissions"
import { sendApprovalRequestEmail } from "@/server/email"
import { REQUIRED_DOC_KINDS } from "@/lib/attachment-kinds"
import { getRoutedApprovers, canUserApproveChange } from "@/server/approval-authority"
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

export async function getChange(id: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const change = await db.changeRequest.findUnique({
    where: { id },
    include: {
      opco: true,
      requester: true,
      approvals: { include: { approver: true }, orderBy: { decidedAt: "asc" } },
      auditTrail: { include: { actor: true }, orderBy: { at: "asc" } },
      attachments: { orderBy: { kind: "asc" } },
    },
  })
  if (!change) return null
  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    const user = await db.user.findUnique({
      where: { keycloakId: session.keycloakId },
      select: { id: true },
    })
    const canApprove = user
      ? await canUserApproveChange({
          userId: user.id, realmRoles: session.realmRoles,
          change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
        })
      : false
    if (!canApprove) return null
  }
  return change
}

export async function listChanges(opcoSlug: string) {
  const session = await getAppSession()
  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
  const db = getPrisma()
  return db.changeRequest.findMany({
    where: { opco: { slug: opcoSlug } },
    include: { requester: true, approvals: true, opco: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function createChange(opcoSlug: string, data: CreateChangeInput) {
  const session = await getAppSession()
  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
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

  return change
}

type UpdateChangeInput = Partial<CreateChangeInput>

export async function updateChange(id: string, data: UpdateChangeInput) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id }, include: { opco: true } })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can edit this change")
  if (change.status !== "draft") throw new Error("Only draft changes can be edited")

  const updateData: UpdateChangeInput & { slaDeadline?: Date } = { ...data }
  if (data.riskLevel) {
    const slaDeadline = new Date()
    slaDeadline.setHours(slaDeadline.getHours() + SLA_HOURS[data.riskLevel])
    updateData.slaDeadline = slaDeadline
  }

  return db.changeRequest.update({ where: { id }, data: updateData })
}

export async function submitChange(id: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id }, include: { opco: true, attachments: true },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can submit this change")
  if (change.status !== "draft") throw new Error("Only draft changes can be submitted")

  const present = new Set(change.attachments.map((a) => a.kind))
  const missing = REQUIRED_DOC_KINDS.filter((k) => !present.has(k))
  if (missing.length > 0) {
    throw new Error(`Cannot submit: required document(s) missing: ${missing.join(", ")}`)
  }
  const requiredFields: [string, unknown][] = [
    ["title", change.title], ["description", change.description],
    ["contactEmail", change.contactEmail], ["infrastructureType", change.infrastructureType],
    ["plannedStart", change.plannedStart], ["plannedEnd", change.plannedEnd],
  ]
  const missingFields = requiredFields.filter(([, v]) => v === null || v === undefined || v === "").map(([k]) => k)
  if (missingFields.length > 0) {
    throw new Error(`Cannot submit: required field(s) missing: ${missingFields.join(", ")}`)
  }

  if (!change.isEmergency) {
    const now = new Date()
    const activeBlackouts = await db.blackoutPeriod.findMany({
      where: {
        OR: [{ opcoId: change.opcoId }, { opcoId: null }],
        startsAt: { lte: now }, endsAt: { gte: now },
      },
    })
    if (activeBlackouts.length > 0) {
      throw new Error(`Blocked by blackout: "${activeBlackouts[0].label}". Submit as emergency to override.`)
    }
  }

  const updated = await db.changeRequest.update({ where: { id }, data: { status: "pending" } })
  await db.auditLog.create({
    data: { changeId: id, actorId: user.id, action: "submitted", fromStatus: "draft", toStatus: "pending" },
  })

  // Notify the routed CAB's members (group CAB for Equiano, OpCo CAB otherwise) + active delegates.
  const recipients = await getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId })
  await Promise.allSettled(recipients.map((u) =>
    sendApprovalRequestEmail({
      to: u.email, approverName: u.name ?? u.email,
      changeTitle: change.title, requesterName: user.name ?? user.email,
      riskLevel: change.riskLevel, changeId: change.id,
    })
  ))
  return updated
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

  const change = await db.changeRequest.findUnique({ where: { id: changeId }, include: { opco: true } })
  if (!change) throw new Error("Change not found")

  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    throw new Error("Forbidden: change belongs to another OpCo")
  }

  if (!VALID_TRANSITIONS[change.status]?.includes(toStatus)) {
    throw new Error(`Invalid transition: ${change.status} → ${toStatus}`)
  }

  const isAdmin =
    isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")

  if (toStatus === "draft") {
    // reopen: only the original requester or an admin
    if (change.requesterId !== user.id && !isAdmin) {
      throw new Error("Forbidden: only the requester or an admin can reopen this change")
    }
  } else {
    // implemented / verified / closed: requires approver or admin rights
    if (!canApprove(session.organizations, change.opco.slug) && !isAdmin) {
      throw new Error("Forbidden: not authorized to advance this change")
    }
  }

  const updated = await db.changeRequest.update({ where: { id: changeId }, data: { status: toStatus } })
  await db.auditLog.create({
    data: { changeId, actorId: user.id, action: "status_changed", fromStatus: change.status, toStatus, note },
  })
  return updated
}
