"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const ok = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!ok) throw new Error("Forbidden: not authorized to manage approvers for this scope")
  return session
}

export async function listApproverAssignments() {
  const session = await getAppSession()
  const db = getPrisma()
  const slugs = session.organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
  const where = isGroupAdmin(session.realmRoles)
    ? { isActive: true }
    : { isActive: true, OR: [{ opcoId: null }, { opco: { slug: { in: slugs } } }] }
  return db.approverAssignment.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } }, opco: { select: { name: true, slug: true } } },
    orderBy: [{ infrastructureType: "asc" }],
  })
}

export async function addApproverAssignment(input: { infrastructureType: string; opcoSlug: string | null; userId: string }) {
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")
  const target = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true } })
  if (!target || !target.isActive) throw new Error("Approver must be an active user")
  const opcoId = opco?.id ?? null

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
    if (!actor) throw new Error("User not found")
    // findFirst + create/update rather than upsert: the compound unique includes the
    // nullable opcoId, which Postgres treats as distinct, so it can't be targeted by a
    // unique `where` when null (group-level overrides).
    const existing = await tx.approverAssignment.findFirst({
      where: { infrastructureType: input.infrastructureType, opcoId, userId: input.userId },
    })
    const assignment = existing
      ? await tx.approverAssignment.update({ where: { id: existing.id }, data: { isActive: true } })
      : await tx.approverAssignment.create({
          data: { infrastructureType: input.infrastructureType, opcoId, userId: input.userId, createdById: actor.id },
        })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name, action: "approver_assignment_added",
      opcoId, summary: `Added approver override (${input.infrastructureType} / ${input.opcoSlug ?? "group"})`,
    })
    return assignment
  })
}

export async function removeApproverAssignment(id: string) {
  const db = getPrisma()
  const existing = await db.approverAssignment.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Assignment not found")
  const session = await assertCanManage(existing.opco?.slug ?? null)
  await db.$transaction(async (tx) => {
    await tx.approverAssignment.update({ where: { id }, data: { isActive: false } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name, action: "approver_assignment_removed",
      opcoId: existing.opcoId, summary: `Removed approver override (${existing.infrastructureType} / ${existing.opco?.slug ?? "group"})`,
    })
  })
}
