// src/server/actions/approvals.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { checkCabQuorum } from "@/lib/cab-quorum"
import { notifyEvent } from "@/server/notify"
import { isGroupLevelInfra } from "@/lib/approver-routing"
import { canUserApproveChange } from "@/server/approval-authority"

export async function submitApproval(
  changeId: string,
  decision: "approve" | "reject",
  comment: string | undefined,
  isCab: boolean
) {
  const session = await getAppSession()

  if (decision === "reject" && !comment?.trim()) {
    throw new Error("A comment is required when rejecting a change")
  }

  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { approvals: true, opco: true },
  })
  if (!change) throw new Error("Change not found")
  const isRetrospective = change.status === "implemented" && change.isEmergency && change.expedited === true
  if (change.status !== "pending" && !isRetrospective) throw new Error("Change is not pending")

  // Votes are scoped to the current submission cycle. A change can go
  // rejected → draft → pending again, and approvals from before the last submission were
  // cast against a previous version of the plan: they must neither block a fresh vote nor
  // count toward quorum. Legacy changes with no `submitted` audit row keep every approval.
  const lastSubmission = await db.auditLog.findFirst({
    where: { changeId, action: "submitted" },
    orderBy: { at: "desc" },
    select: { at: true },
  })
  const cycleApprovals = lastSubmission
    ? change.approvals.filter((a) => a.decidedAt >= lastSubmission.at)
    : change.approvals

  // One vote per approver per cycle. Deliberately application-level rather than a DB
  // unique constraint: an emergency can legitimately collect a normal approval, be
  // expedited-implemented, then receive a retrospective approval from the same person.
  if (!isRetrospective && cycleApprovals.some((a) => a.approverId === user.id)) {
    throw new Error("You have already voted on this change")
  }

  const allowed = await canUserApproveChange({
    userId: user.id,
    realmRoles: session.realmRoles,
    change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
    changeId,
  })
  if (!allowed) {
    throw new Error("Forbidden: not authorized to approve this change")
  }

  // ISO 27001 A.5.3 — Segregation of Duties: requesters cannot approve their own changes
  if (change.requesterId === user.id) {
    throw new Error("Approvers cannot approve their own requests (SoD violation — ISO 27001 A.5.3)")
  }

  const approval = await db.approval.create({
    data: { changeId, approverId: user.id, decision, comment, isCab: true },
  })

  if (isRetrospective) {
    if (decision === "approve") {
      await db.changeRequest.update({ where: { id: changeId }, data: { retroApprovedAt: new Date() } })
    }
    await db.auditLog.create({
      data: {
        changeId, actorId: user.id,
        action: decision === "approve" ? "retro_approved" : "retro_rejected",
        note: comment,
      },
    })
    return approval
  }

  const allApprovals = [...cycleApprovals, { isCab: true, decision, approverId: user.id }]
  const needsCab =
    !isGroupLevelInfra(change.infrastructureType) &&
    (change.riskLevel === "high" || change.riskLevel === "emergency")
  const quorumMet = needsCab ? checkCabQuorum(allApprovals) : decision === "approve"

  if (decision === "approve" && quorumMet) {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "approved" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "approved", fromStatus: "pending", toStatus: "approved" },
    })
    const requester = await db.user.findUnique({ where: { id: change.requesterId }, select: { id: true, email: true, name: true } })
    if (requester) {
      await notifyEvent({
        type: "change_approved",
        recipients: [{ userId: requester.id, email: requester.email, name: requester.name }],
        change: { id: changeId, title: change.title, opcoId: change.opcoId },
        context: { newStatus: "approved" },
      }).catch(() => {})
    }
  }

  if (decision === "reject") {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "rejected" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "rejected", fromStatus: "pending", toStatus: "rejected", note: comment },
    })
    const requester = await db.user.findUnique({ where: { id: change.requesterId }, select: { id: true, email: true, name: true } })
    if (requester) {
      await notifyEvent({
        type: "change_rejected",
        recipients: [{ userId: requester.id, email: requester.email, name: requester.name }],
        change: { id: changeId, title: change.title, opcoId: change.opcoId },
        context: { newStatus: "rejected" },
      }).catch(() => {})
    }
  }

  return approval
}
