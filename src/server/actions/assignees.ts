"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { routedCabOpcoId } from "@/lib/approver-routing"

type AssigneeInput = { userId: string; role: "approver" | "implementer" }

async function isEligibleApprover(
  db: ReturnType<typeof getPrisma>, userId: string, opcoId: string, cabOpcoId: string | null
): Promise<boolean> {
  const opcoRole = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, isActive: true, role: { in: ["approver", "admin"] } },
  })
  if (opcoRole) return true
  const cab = await db.cABMembership.findFirst({ where: { userId, opcoId: cabOpcoId, isActive: true } })
  return !!cab
}

export async function listChangeAssignees(changeId: string) {
  const db = getPrisma()
  return db.changeAssignee.findMany({
    where: { changeId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

export async function setChangeAssignees(changeId: string, assignees: AssigneeInput[]) {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    select: { id: true, requesterId: true, opcoId: true, infrastructureType: true, opco: { select: { slug: true } } },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== me.id && !isAdmin)
    throw new Error("Forbidden: only the requester or an admin can set assignees")

  const cabOpcoId = routedCabOpcoId(change.infrastructureType, change.opcoId)
  for (const a of assignees.filter((x) => x.role === "approver")) {
    if (!(await isEligibleApprover(db, a.userId, change.opcoId, cabOpcoId)))
      throw new Error("Assignee is not an eligible approver for this change's scope")
  }

  await db.$transaction(async (tx) => {
    await tx.changeAssignee.deleteMany({ where: { changeId } })
    for (const a of assignees) {
      await tx.changeAssignee.create({ data: { changeId, userId: a.userId, role: a.role } })
    }
    await tx.auditLog.create({
      data: { changeId, actorId: me.id, action: "assignees_set", note: `Set ${assignees.length} assignee(s)` },
    })
  })
}
