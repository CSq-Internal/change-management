// src/server/actions/cab.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageCab, isGroupAdmin } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

export async function addCabMember(userId: string, opcoSlug: string | null) {
  const session = await getAppSession()
  const db = getPrisma()

  // --- Group CAB (opcoId = null) ---
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can manage the group CAB")
    }
    const eligible = await db.userOpCoAssignment.findFirst({
      where: { userId, role: "approver", isActive: true },
    })
    if (!eligible) throw new Error("Forbidden: user must be an approver in at least one OpCo")

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
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)

  const eligible = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId: opco.id, role: "approver", isActive: true },
  })
  if (!eligible) throw new Error(`Forbidden: user must be an approver in ${opcoSlug}`)

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
