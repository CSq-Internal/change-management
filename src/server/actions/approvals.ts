// src/server/actions/approvals.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { checkCabQuorum } from "@/lib/cab-quorum"

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
    include: { approvals: true },
  })
  if (!change) throw new Error("Change not found")
  if (change.status !== "pending") throw new Error("Change is not pending")

  // ISO 27001 A.5.3 — Segregation of Duties: requesters cannot approve their own changes
  if (change.requesterId === user.id) {
    throw new Error("Approvers cannot approve their own requests (SoD violation — ISO 27001 A.5.3)")
  }

  const approval = await db.approval.create({
    data: { changeId, approverId: user.id, decision, comment, isCab },
  })

  const allApprovals = [...change.approvals, { isCab, decision, approverId: user.id }]
  const needsCab = change.riskLevel === "high" || change.riskLevel === "emergency"
  const quorumMet = needsCab ? checkCabQuorum(allApprovals) : decision === "approve"

  if (decision === "approve" && quorumMet) {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "approved" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "approved", fromStatus: "pending", toStatus: "approved" },
    })
  }

  if (decision === "reject") {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "rejected" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "rejected", fromStatus: "pending", toStatus: "rejected", note: comment },
    })
  }

  return approval
}
