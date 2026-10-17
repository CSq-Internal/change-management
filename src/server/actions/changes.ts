// src/server/actions/changes.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo, isGroupLevel, isMemberOfOpCo, canApprove } from "@/lib/permissions"
import { notifyEvent, notifyChange } from "@/server/notify"
import { REQUIRED_DOC_KINDS, documentsRequiredForRisk } from "@/lib/attachment-kinds"
import { getRoutedApprovers, getNamedApprovers, isEligibleApprover } from "@/server/approval-authority"
import { canViewChange } from "@/server/change-access"
import { SLA_HOURS } from "@/lib/sla"
import type { NotifyEventType } from "@/lib/notifications"
import type { ChangeCategory, RiskLevel, ChangeStatus } from "@prisma/client"

// Emergency changes implemented under expedited authority must obtain retrospective
// approval within this window (ISO 27001 A.8.32).
const RETRO_APPROVAL_WINDOW_HOURS = 48

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
  /** Requester-nominated approvers. Additive — routed CAB approvers keep their authority. */
  approverIds?: string[]
}

type ChangeFormFields = Omit<CreateChangeInput, "approverIds">

// A server action receives whatever JSON the browser sends, whatever its TypeScript type
// says, so create and update copy only these keys. Spreading the input would let a caller
// set status, opcoId or implementedById, or forge votes through a nested `approvals` write.
// The Record type makes the compiler flag a form field added to the type but not here.
const CHANGE_FORM_FIELDS: Record<keyof ChangeFormFields, true> = {
  title: true, description: true, category: true, riskLevel: true, contactEmail: true,
  infrastructureType: true, changeReason: true, impactScope: true, implementationPlan: true,
  testingPlan: true, backoutPlan: true, changeWindow: true, plannedStart: true,
  plannedEnd: true, isEmergency: true,
}

function pickFormFields<T extends Partial<ChangeFormFields>>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => Object.hasOwn(CHANGE_FORM_FIELDS, key)),
  ) as T
}

/** A blackout (this OpCo's or group-wide) overlapping the window [start, end), if any. */
async function blockingBlackout(
  db: ReturnType<typeof getPrisma>, opcoId: string, start: Date, end: Date,
) {
  const [blackout] = await db.blackoutPeriod.findMany({
    where: { OR: [{ opcoId }, { opcoId: null }], startsAt: { lt: end }, endsAt: { gt: start } },
  })
  return blackout
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
      implementedBy: true,
      pir: true,
      assignees: { include: { user: { select: { name: true, email: true } } } },
    },
  })
  if (!change) return null
  return (await canViewChange(session, change)) ? change : null
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

// A draft may leave either date empty, but once both are set the end must come after the start.
function assertWindow(start: Date | null | undefined, end: Date | null | undefined) {
  if (start && end && !(new Date(end) > new Date(start))) {
    throw new Error("Invalid planned window: the end must be after the start")
  }
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

  const { approverIds = [] } = data
  const changeData = pickFormFields<ChangeFormFields>(data)
  assertWindow(changeData.plannedStart, changeData.plannedEnd)

  // Validate before opening the transaction so a bad id leaves nothing behind.
  for (const userId of approverIds) {
    // submitApproval rejects self-approval (SoD), so naming yourself would satisfy the
    // mandatory-approver gate while leaving nobody able to actually approve.
    if (userId === user.id) {
      throw new Error("Cannot name yourself as an approver on your own change")
    }
    if (!(await isEligibleApprover(userId, opco.id, data.infrastructureType))) {
      throw new Error("Assignee is not an eligible approver for this change's scope")
    }
  }

  const change = await db.$transaction(async (tx) => {
    const created = await tx.changeRequest.create({
      data: { ...changeData, opcoId: opco.id, requesterId: user.id, status: "draft" },
    })
    for (const userId of approverIds) {
      await tx.changeAssignee.create({ data: { changeId: created.id, userId, role: "approver" } })
    }
    await tx.auditLog.create({
      data: { changeId: created.id, actorId: user.id, action: "created", toStatus: "draft" },
    })
    return created
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

  const fields = pickFormFields(data)
  assertWindow(fields.plannedStart ?? change.plannedStart, fields.plannedEnd ?? change.plannedEnd)
  return db.changeRequest.update({ where: { id }, data: fields })
}

export async function submitChange(id: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id }, include: { opco: true, attachments: true, assignees: true },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can submit this change")
  if (change.status !== "draft") throw new Error("Only draft changes can be submitted")

  if (documentsRequiredForRisk(change.riskLevel)) {
    const present = new Set(change.attachments.map((a) => a.kind))
    const missing = REQUIRED_DOC_KINDS.filter((k) => !present.has(k))
    if (missing.length > 0) {
      throw new Error(`Cannot submit: required document(s) missing: ${missing.join(", ")}`)
    }
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
  assertWindow(change.plannedStart, change.plannedEnd)

  // At least one approver must be named before a change can enter the approval flow.
  // Requester-named approvers are additive — the routed CAB keeps its authority — but
  // the nomination itself is mandatory. Count only nominees who can still act: a row for
  // a deactivated or since-ineligible user would pass a bare count while leaving the
  // change in pending with nobody able to approve it, which is what this gate prevents.
  const namedApprovers = await getNamedApprovers(id)
  let actionableApprovers = 0
  for (const a of namedApprovers) {
    if (await isEligibleApprover(a.id, change.opcoId, change.infrastructureType)) actionableApprovers++
  }
  if (actionableApprovers === 0) {
    throw new Error("Cannot submit: at least one approver must be named")
  }

  // The planned window must clear every blackout, whenever it is submitted. Planned dates
  // are required above, and checked here rather than on the draft, which may still move.
  if (!change.isEmergency) {
    const blackout = await blockingBlackout(db, change.opcoId, change.plannedStart!, change.plannedEnd!)
    if (blackout) {
      throw new Error(`Blocked by blackout: "${blackout.label}". Submit as emergency to override.`)
    }
  }

  // The SLA clock starts here, and restarts on each resubmission, so a draft's age and an
  // earlier round's escalations don't count against this round.
  const slaDeadline = new Date(Date.now() + SLA_HOURS[change.riskLevel] * 3_600_000)
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.changeRequest.update({
      where: { id },
      data: { status: "pending", slaDeadline, escalationLevel: 0, lastEscalatedAt: null },
    })
    await tx.auditLog.create({
      data: { changeId: id, actorId: user.id, action: "submitted", fromStatus: "draft", toStatus: "pending" },
    })
    return updated
  })

  // Notify the routed CAB's members (group CAB for Equiano, OpCo CAB otherwise) + active delegates,
  // plus anyone explicitly named as an approver on this change. Deduplicated by id.
  const routed = await getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId })
  const named = await getNamedApprovers(change.id)
  const seenA = new Set<string>()
  const recipients = [...routed, ...named]
    .filter((u) => { if (seenA.has(u.id)) return false; seenA.add(u.id); return true })
    .map((u) => ({ userId: u.id, email: u.email, name: u.name }))
  await notifyEvent({
    type: "approval_requested",
    recipients,
    change: { id: change.id, title: change.title, opcoId: change.opcoId },
    context: { requesterName: user.name ?? user.email, riskLevel: change.riskLevel },
  }).catch(() => {})

  if (change.isEmergency) {
    const cab = await db.cABMembership.findMany({
      where: { opcoId: null, isActive: true },
      select: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    })
    await notifyEvent({
      type: "emergency_submitted",
      recipients: cab.filter((m) => m.user.isActive).map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name })),
      change: { id: change.id, title: change.title, opcoId: change.opcoId },
      context: { requesterName: user.name ?? user.email },
    }).catch(() => {})
  }

  // Receipt to the requester. Deliberately not actor-suppressed — the resolver treats
  // change_submitted as a receipt precisely so the submitter hears it landed.
  await notifyChange("change_submitted", id, { actorId: user.id }).catch(() => {})

  return updated
}

// Soft-delete a draft. A change can never be hard-deleted (its AuditLog rows are
// protected by a DB immutability trigger), so "discard" moves it to `cancelled`,
// which drops out of the open/active views while preserving the audit trail.
export async function discardChange(id: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id }, include: { opco: true } })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can discard this change")
  if (change.status !== "draft") throw new Error("Only draft changes can be discarded")

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.changeRequest.update({ where: { id }, data: { status: "cancelled" } })
    await tx.auditLog.create({
      data: { changeId: id, actorId: user.id, action: "cancelled", fromStatus: "draft", toStatus: "cancelled" },
    })
    return updated
  })

  await notifyChange("change_cancelled", id, { actorId: user.id }).catch(() => {})

  return updated
}

const VALID_TRANSITIONS: Partial<Record<ChangeStatus, ChangeStatus[]>> = {
  draft: ["pending"],
  // No `pending` entry: a pending change is approved or rejected only by votes through
  // submitApproval (quorum, CAB, SoD). The emergency pending → implemented path is below.
  approved: ["implemented"],
  implemented: ["verified"],
  verified: ["closed"],
  rejected: ["draft"],
}

/** Status transitions that are worth telling people about. Others are silent by design. */
const LIFECYCLE_EVENT: Partial<Record<ChangeStatus, NotifyEventType>> = {
  implemented: "change_implemented",
  closed: "change_closed",
  draft: "change_reopened",
}

export async function updateChangeStatus(changeId: string, toStatus: ChangeStatus, note?: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { opco: true, approvals: true },
  })
  if (!change) throw new Error("Change not found")

  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    throw new Error("Forbidden: change belongs to another OpCo")
  }

  // Verify is only reachable by recording a PIR (see submitPostImplementationReview).
  if (toStatus === "verified") {
    throw new Error("To verify a change, submit a Post-Implementation Review (PIR)")
  }

  // Emergency expedited: pending → implemented (skipping prior approval) is allowed
  // ONLY for emergency changes; everything else must follow VALID_TRANSITIONS.
  const isExpeditedImplement = toStatus === "implemented" && change.status === "pending"
  if (isExpeditedImplement) {
    if (!change.isEmergency) {
      throw new Error("Invalid transition: only emergency changes can be implemented without approval")
    }
  } else if (!VALID_TRANSITIONS[change.status]?.includes(toStatus)) {
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
  } else if (!canApprove(session.organizations, change.opco.slug) && !isAdmin) {
    // implemented / closed normally need approver or admin rights. The exception is a named
    // implementer recording the work they did on an approved change, so "implemented by"
    // names who did it rather than whoever had the button. An expedited emergency
    // (pending → implemented) still needs an approver: implementing it stands in for the
    // approval, which a named implementer cannot give.
    // Auditors are refused even when named: naming an implementer is not validated
    // (assignees.ts), and implementing a change they may later audit is the conflict
    // A.5.3 forbids.
    const isAuditor =
      hasRoleInOpCo(session.organizations, change.opco.slug, "auditor") ||
      session.realmRoles.includes("group_auditor")
    const namedImplementer =
      toStatus === "implemented" && change.status === "approved" && !isAuditor &&
      !!(await db.changeAssignee.findFirst({ where: { changeId, userId: user.id, role: "implementer" } }))
    if (!namedImplementer) throw new Error("Forbidden: not authorized to advance this change")
  }

  const data: {
    status: ChangeStatus
    implementedById?: string
    implementedAt?: Date
    expedited?: boolean
    retroApprovalDueAt?: Date
  } = { status: toStatus }

  if (toStatus === "implemented") {
    // Implementer Segregation of Duties (lenient): the *sole* approver cannot also implement.
    const approveVoters = [
      ...new Set((change.approvals ?? []).filter((a) => a.decision === "approve").map((a) => a.approverId)),
    ]
    if (approveVoters.length === 1 && approveVoters[0] === user.id) {
      throw new Error("Forbidden: the sole approver cannot also implement this change (SoD — ISO 27001 A.5.3)")
    }
    data.implementedById = user.id
    data.implementedAt = new Date()
    if (isExpeditedImplement) {
      data.expedited = true
      data.retroApprovalDueAt = new Date(Date.now() + RETRO_APPROVAL_WINDOW_HOURS * 60 * 60 * 1000)
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.changeRequest.update({ where: { id: changeId }, data })
    await tx.auditLog.create({
      data: { changeId, actorId: user.id, action: "status_changed", fromStatus: change.status, toStatus, note },
    })
    return updated
  })

  const lifecycleEvent = LIFECYCLE_EVENT[toStatus]
  if (lifecycleEvent) {
    await notifyChange(lifecycleEvent, changeId, {
      actorId: user.id, actorName: user.name ?? user.email, note,
    }).catch(() => {})
  }

  return updated
}

const RESCHEDULABLE_STATUSES = ["draft", "pending", "approved"]

export async function rescheduleChange(id: string, newStartIso: string, newEndIso: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id }, include: { opco: true } })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can reschedule this change")

  if (!RESCHEDULABLE_STATUSES.includes(change.status))
    throw new Error("Only unimplemented changes (draft, pending, approved) can be rescheduled")

  const newStart = new Date(newStartIso)
  const newEnd = new Date(newEndIso)
  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()) || newEnd <= newStart)
    throw new Error("Invalid reschedule window")

  // Blackout is a hard block (overlap is only a soft calendar warning), unless emergency.
  if (!change.isEmergency) {
    const blackout = await blockingBlackout(db, change.opcoId, newStart, newEnd)
    if (blackout) throw new Error(`Blocked by blackout: "${blackout.label}". Emergencies may override.`)
  }

  const oldWindow = change.plannedStart && change.plannedEnd
    ? `${change.plannedStart.toISOString()} – ${change.plannedEnd.toISOString()}`
    : "unscheduled"
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.changeRequest.update({
      where: { id },
      data: { plannedStart: newStart, plannedEnd: newEnd },
    })
    await tx.auditLog.create({
      data: {
        changeId: id, actorId: user.id, action: "rescheduled",
        note: `Rescheduled ${oldWindow} to ${newStart.toISOString()} – ${newEnd.toISOString()}`,
      },
    })
    return updated
  })

  await notifyChange("change_rescheduled", id, {
    actorId: user.id,
    windowFrom: oldWindow,
    windowTo: `${newStart.toISOString()} – ${newEnd.toISOString()}`,
  }).catch(() => {})

  return updated
}
