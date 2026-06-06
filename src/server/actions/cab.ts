// src/server/actions/cab.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageCab, isGroupAdmin, isGroupLevel, canAudit } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

// Resolves an OpCo by slug; throws if it doesn't exist.
async function resolveOpCo(db: ReturnType<typeof getPrisma>, slug: string) {
  const opco = await db.opCo.findUnique({ where: { slug } })
  if (!opco) throw new Error(`OpCo not found: ${slug}`)
  return opco
}

export async function addCabMember(userId: string, opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  // --- Group CAB (opcoId = null) ---
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can manage the group CAB")
    }
    const eligible = await db.userOpCoAssignment.findFirst({
      where: { userId, role: { in: ["approver", "admin"] }, isActive: true },
    })
    if (!eligible) throw new Error("Forbidden: user must be an approver or admin in at least one OpCo")

    // Postgres treats NULL opcoId as distinct, so upsert can't dedupe group rows —
    // find-then-create/update guards against duplicates.
    const existing = await db.cABMembership.findFirst({ where: { userId, opcoId: null } })
    return db.$transaction(async (tx) => {
      const member = existing
        ? await tx.cABMembership.update({
            where: { id: existing.id },
            data: { isActive: true, endedAt: null },
          })
        : await tx.cABMembership.create({ data: { userId, opcoId: null } })
      await recordAdminAction(tx, {
        actorKeycloakId: session.keycloakId,
        action: "cab.add",
        targetUserId: userId,
        summary: `Added user ${userId} to the group CAB`,
      })
      return member
    })
  }

  // --- Per-OpCo CAB ---
  if (!canManageCab(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage the CAB in ${opcoSlug}`)
  }
  const opco = await resolveOpCo(db, opcoSlug)

  const eligible = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId: opco.id, role: { in: ["approver", "admin"] }, isActive: true },
  })
  if (!eligible) throw new Error(`Forbidden: user must be an approver or admin in ${opcoSlug}`)

  return db.$transaction(async (tx) => {
    const member = await tx.cABMembership.upsert({
      where: { userId_opcoId: { userId, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId, opcoId: opco.id },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "cab.add",
      opcoId: opco.id,
      targetUserId: userId,
      summary: `Added user ${userId} to the ${opcoSlug} CAB`,
    })
    return member
  })
}

export async function removeCabMember(userId: string, opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can manage the group CAB")
    }
    const existing = await db.cABMembership.findFirst({
      where: { userId, opcoId: null, isActive: true },
    })
    if (!existing) throw new Error("User is not an active group CAB member")
    await db.$transaction(async (tx) => {
      await tx.cABMembership.update({
        where: { id: existing.id },
        data: { isActive: false, endedAt: new Date() },
      })
      await recordAdminAction(tx, {
        actorKeycloakId: session.keycloakId,
        action: "cab.remove",
        targetUserId: userId,
        summary: `Removed user ${userId} from the group CAB`,
      })
    })
    return
  }

  if (!canManageCab(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage the CAB in ${opcoSlug}`)
  }
  const opco = await resolveOpCo(db, opcoSlug)

  await db.$transaction(async (tx) => {
    await tx.cABMembership.update({
      where: { userId_opcoId: { userId, opcoId: opco.id } },
      data: { isActive: false, endedAt: new Date() },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "cab.remove",
      opcoId: opco.id,
      targetUserId: userId,
      summary: `Removed user ${userId} from the ${opcoSlug} CAB`,
    })
  })
}

export async function listCabMembers(opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  if (opcoSlug === null) {
    if (!isGroupLevel(session.realmRoles)) {
      throw new Error("Forbidden: cannot read the group CAB")
    }
    return db.cABMembership.findMany({ where: { opcoId: null, isActive: true }, include: { user: true } })
  }

  if (!canAudit(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot read the CAB in ${opcoSlug}`)
  }
  const opco = await resolveOpCo(db, opcoSlug)
  return db.cABMembership.findMany({ where: { opcoId: opco.id, isActive: true }, include: { user: true } })
}
