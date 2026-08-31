"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { isEligibleApprover } from "@/server/approval-authority"
import { notifyChange } from "@/server/notify"

type AssigneeInput = { userId: string; role: "approver" | "implementer" }

const NO_APPROVER_ERROR =
  "Cannot save: a submitted change must have at least one named approver"

/**
 * Shared authz + change lookup for both setters. Only the requester or an admin may
 * change who is assigned to a change.
 */
async function loadChangeForAssigneeWrite(changeId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.keycloakId },
    select: { id: true },
  })
  if (!me) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    select: {
      id: true, status: true, requesterId: true, opcoId: true,
      infrastructureType: true, opco: { select: { slug: true } },
    },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin =
    isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== me.id && !isAdmin) {
    throw new Error("Forbidden: only the requester or an admin can set assignees")
  }
  return { db, me, change }
}

async function assertApproversEligible(
  approverIds: string[],
  opcoId: string,
  infrastructureType: string,
  requesterId: string,
) {
  for (const userId of approverIds) {
    // submitApproval rejects self-approval (SoD), so naming the requester would satisfy the
    // mandatory-approver gate while leaving nobody able to actually approve.
    if (userId === requesterId) {
      throw new Error("Cannot name yourself as an approver on your own change")
    }
    if (!(await isEligibleApprover(userId, opcoId, infrastructureType))) {
      throw new Error("Assignee is not an eligible approver for this change's scope")
    }
  }
}

export async function listChangeAssignees(changeId: string) {
  const db = getPrisma()
  return db.changeAssignee.findMany({
    where: { changeId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

export async function setChangeAssignees(changeId: string, assignees: AssigneeInput[]) {
  const { db, me, change } = await loadChangeForAssigneeWrite(changeId)

  const approverIds = assignees.filter((a) => a.role === "approver").map((a) => a.userId)
  // A change awaiting approval must never be left without an approver — otherwise a
  // requester could submit with one and immediately strip it back out. Scoped to pending:
  // naming an implementer on an already-approved change is routine and must not be blocked.
  if (change.status === "pending" && approverIds.length === 0) {
    throw new Error(NO_APPROVER_ERROR)
  }
  await assertApproversEligible(approverIds, change.opcoId, change.infrastructureType, change.requesterId)

  // Both setters replace rows wholesale, so "who was added/removed" only exists as a diff
  // against the previous set. Read it before the write.
  const previous = await db.changeAssignee.findMany({
    where: { changeId }, select: { userId: true, role: true },
  })

  await db.$transaction(async (tx) => {
    await tx.changeAssignee.deleteMany({ where: { changeId } })
    for (const a of assignees) {
      await tx.changeAssignee.create({ data: { changeId, userId: a.userId, role: a.role } })
    }
    await tx.auditLog.create({
      data: { changeId, actorId: me.id, action: "assignees_set", note: `Set ${assignees.length} assignee(s)` },
    })
  })

  const before = new Map(previous.map((r) => [r.userId, r.role as string]))
  const after = new Map(assignees.map((a) => [a.userId, a.role as string]))
  const added = assignees.filter((a) => before.get(a.userId) !== a.role)
    .map((a) => ({ userId: a.userId, role: a.role as string }))
  const removed = previous.filter((r) => after.get(r.userId) !== r.role)
    .map((r) => ({ userId: r.userId, role: r.role as string }))
  await notifyAssigneeDiff(changeId, added, removed, me.id)
}

/**
 * Replace only the approver rows. Used by the request form, which knows about approvers
 * but not implementers — a full setChangeAssignees call from there would silently delete
 * implementers named on the change-detail page.
 */
export async function setChangeApprovers(changeId: string, approverIds: string[]) {
  const { db, me, change } = await loadChangeForAssigneeWrite(changeId)

  if (change.status === "pending" && approverIds.length === 0) {
    throw new Error(NO_APPROVER_ERROR)
  }
  await assertApproversEligible(approverIds, change.opcoId, change.infrastructureType, change.requesterId)

  const previous = await db.changeAssignee.findMany({
    where: { changeId, role: "approver" }, select: { userId: true },
  })

  await db.$transaction(async (tx) => {
    await tx.changeAssignee.deleteMany({ where: { changeId, role: "approver" } })
    for (const userId of approverIds) {
      await tx.changeAssignee.create({ data: { changeId, userId, role: "approver" } })
    }
    await tx.auditLog.create({
      data: {
        changeId, actorId: me.id, action: "approvers_set",
        note: `Named ${approverIds.length} approver(s)`,
      },
    })
  })

  const before = new Set(previous.map((r) => r.userId))
  const after = new Set(approverIds)
  await notifyAssigneeDiff(
    changeId,
    approverIds.filter((id) => !before.has(id)).map((userId) => ({ userId, role: "approver" })),
    [...before].filter((id) => !after.has(id)).map((userId) => ({ userId, role: "approver" })),
    me.id,
  )
}

/**
 * assignee_added / assignee_removed target one specific person, so recipients are passed
 * explicitly rather than resolved from a role group. Fires after the transaction commits.
 */
async function notifyAssigneeDiff(
  changeId: string,
  added: { userId: string; role: string }[],
  removed: { userId: string; role: string }[],
  actorId: string,
) {
  if (added.length === 0 && removed.length === 0) return
  const db = getPrisma()
  const ids = [...new Set([...added, ...removed].map((a) => a.userId))]
  const users = await db.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, email: true },
  })
  const byId = new Map(users.map((u) => [u.id, u]))

  const send = async (entry: { userId: string; role: string }, type: "assignee_added" | "assignee_removed") => {
    // No point telling people they assigned themselves.
    if (entry.userId === actorId) return
    const u = byId.get(entry.userId)
    if (!u) return
    await notifyChange(type, changeId, {
      recipients: [{ userId: u.id, email: u.email, name: u.name }],
      role: entry.role,
    }).catch(() => {})
  }

  for (const a of added) await send(a, "assignee_added")
  for (const r of removed) await send(r, "assignee_removed")
}
