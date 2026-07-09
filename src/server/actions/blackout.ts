// src/server/actions/blackout.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isGroupLevel, isMemberOfOpCo, canManageUsers } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

export async function getActiveBlackouts(opcoSlug: string) {
  const session = await getAppSession()
  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) return []
  const now = new Date()
  return db.blackoutPeriod.findMany({
    where: {
      startsAt: { lte: now }, endsAt: { gte: now },
      OR: [{ opcoId: opco.id }, { opcoId: null }],
    },
  })
}

export async function createBlackoutPeriod(input: {
  opcoSlug: string | null
  label: string
  startsAt: Date
  endsAt: Date
}) {
  const session = await getAppSession()

  const authorized = input.opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) ||
      canManageUsers(session.organizations, session.realmRoles, input.opcoSlug)
  if (!authorized) {
    throw new Error("Forbidden: not authorized to create blackout for this OpCo")
  }

  const db = getPrisma()
  const opco = input.opcoSlug
    ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
    : null

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { keycloakId: session.keycloakId } })
    if (!user) throw new Error("User not found")

    const created = await tx.blackoutPeriod.create({
      data: {
        opcoId: opco?.id ?? null,
        label: input.label,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdById: user.id,
      },
    })
    // Blackout windows are a change-governance control; their creation/removal belongs on
    // the ISO admin trail alongside CAB/delegation/risk changes.
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name,
      action: "blackout_created",
      opcoId: opco?.id ?? null,
      summary: `Created blackout "${input.label}"`,
    })
    return created
  })
}

export async function deleteBlackoutPeriod(id: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const existing = await db.blackoutPeriod.findUnique({
    where: { id },
    include: { opco: { select: { slug: true } } },
  })
  if (!existing) throw new Error("Blackout period not found")

  // Same authority model as creation: group-scoped blackouts require a group admin;
  // OpCo-scoped ones allow a group admin or that OpCo's user-manager.
  const authorized = existing.opco === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) ||
      canManageUsers(session.organizations, session.realmRoles, existing.opco.slug)
  if (!authorized) {
    throw new Error("Forbidden: not authorized to remove this blackout period")
  }

  await db.$transaction(async (tx) => {
    await tx.blackoutPeriod.delete({ where: { id } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name,
      action: "blackout_removed",
      opcoId: existing.opcoId ?? null,
      summary: `Removed blackout "${existing.label}"`,
    })
  })
}
