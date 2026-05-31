// src/server/actions/blackout.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isGroupLevel, isMemberOfOpCo, canManageUsers } from "@/lib/permissions"

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
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const opco = input.opcoSlug
    ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
    : null

  return db.blackoutPeriod.create({
    data: {
      opcoId: opco?.id ?? null,
      label: input.label,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdById: user.id,
    },
  })
}
