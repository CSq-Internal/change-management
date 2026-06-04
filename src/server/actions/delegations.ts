// src/server/actions/delegations.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageUsers, canAudit } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

// Resolves an OpCo by slug; throws if it doesn't exist.
async function resolveOpCo(db: ReturnType<typeof getPrisma>, slug: string) {
  const opco = await db.opCo.findUnique({ where: { slug } })
  if (!opco) throw new Error(`OpCo not found: ${slug}`)
  return opco
}

// Throws unless the user holds an active approver assignment in the OpCo.
async function assertApprover(
  db: ReturnType<typeof getPrisma>,
  userId: string,
  opcoId: string,
  label: string
) {
  const assignment = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, role: "approver", isActive: true },
  })
  if (!assignment) throw new Error(`Forbidden: ${label} must be an approver in this OpCo`)
}

export async function createDelegation(input: {
  opcoSlug: string
  fromUserId: string
  toUserId: string
  validUntil: Date
}) {
  if (input.fromUserId === input.toUserId) {
    throw new Error("A user cannot delegate to itself")
  }

  const session = await getAppSession()
  if (!canManageUsers(session.organizations, session.realmRoles, input.opcoSlug)) {
    throw new Error(`Forbidden: cannot manage delegations in ${input.opcoSlug}`)
  }

  const db = getPrisma()
  const opco = await resolveOpCo(db, input.opcoSlug)
  await assertApprover(db, input.fromUserId, opco.id, "delegator")
  await assertApprover(db, input.toUserId, opco.id, "delegatee")

  return db.$transaction(async (tx) => {
    const delegation = await tx.approverDelegation.create({
      data: {
        opcoId: opco.id,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        validUntil: input.validUntil,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "delegation.create",
      opcoId: opco.id,
      targetUserId: input.fromUserId,
      summary: `Delegated ${input.fromUserId}'s approvals to ${input.toUserId} in ${input.opcoSlug}`,
      metadata: { toUserId: input.toUserId, validUntil: input.validUntil },
    })
    return delegation
  })
}

export async function revokeDelegation(delegationId: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const delegation = await db.approverDelegation.findUnique({ where: { id: delegationId } })
  if (!delegation) throw new Error("Delegation not found")

  const opco = await db.opCo.findUnique({ where: { id: delegation.opcoId } })
  if (!opco) throw new Error("OpCo not found")
  if (!canManageUsers(session.organizations, session.realmRoles, opco.slug)) {
    throw new Error(`Forbidden: cannot manage delegations in ${opco.slug}`)
  }

  await db.$transaction(async (tx) => {
    await tx.approverDelegation.update({ where: { id: delegationId }, data: { isActive: false } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "delegation.revoke",
      opcoId: opco.id,
      targetUserId: delegation.fromUserId,
      summary: `Revoked delegation ${delegationId} in ${opco.slug}`,
    })
  })
}

export async function listDelegations(opcoSlug: string) {
  const session = await getAppSession()
  if (!canAudit(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot read delegations in ${opcoSlug}`)
  }
  const db = getPrisma()
  const opco = await resolveOpCo(db, opcoSlug)
  return db.approverDelegation.findMany({
    where: { opcoId: opco.id, isActive: true },
    include: { fromUser: true, toUser: true },
  })
}
