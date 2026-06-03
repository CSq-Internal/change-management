// src/server/actions/users.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, canManageUsers } from "@/lib/permissions"
import { createKeycloakUser, assignToOrganization, deactivateKeycloakUser, reactivateKeycloakUser } from "@/server/keycloak"
import type { Role } from "@prisma/client"

export async function createUser(input: {
  name: string
  email: string
  tempPassword: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  const session = await getAppSession()

  for (const a of input.assignments) {
    if (
      !isGroupAdmin(session.realmRoles) &&
      !canManageUsers(session.organizations, session.realmRoles, a.opcoSlug)
    ) {
      throw new Error(`Forbidden: cannot manage users in ${a.opcoSlug}`)
    }
  }

  const keycloakId = await createKeycloakUser(input.email, input.name, input.tempPassword)

  const db = getPrisma()
  const user = await db.user.create({
    data: { keycloakId, email: input.email, name: input.name },
  })

  // Best-effort: assign to Keycloak orgs (app reads roles from DB, not Keycloak orgs)
  for (const { opcoSlug } of input.assignments) {
    try {
      await assignToOrganization(keycloakId, opcoSlug)
    } catch (err) {
      console.warn(`[keycloak] org assignment skipped for ${opcoSlug}:`, err)
    }
  }

  // Authoritative: create DB assignments
  for (const { opcoSlug, role } of input.assignments) {
    const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
    if (!opco) {
      console.warn(`[createUser] OpCo not found for slug: ${opcoSlug}`)
      continue
    }
    await db.userOpCoAssignment.create({
      data: { userId: user.id, opcoId: opco.id, role },
    })
  }

  return user
}

export async function deactivateUser(userId: string) {
  const session = await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { opcoAssignments: { where: { isActive: true }, include: { opco: true } } },
  })
  if (!user) throw new Error("User not found")

  if (user.keycloakId === session.keycloakId) {
    throw new Error("Forbidden: cannot deactivate yourself")
  }

  const authorized =
    isGroupAdmin(session.realmRoles) ||
    user.opcoAssignments.some((a) =>
      canManageUsers(session.organizations, session.realmRoles, a.opco.slug)
    )
  if (!authorized) {
    throw new Error("Forbidden: cannot manage this user")
  }

  await deactivateKeycloakUser(user.keycloakId)

  await db.user.update({ where: { id: userId }, data: { isActive: false } })
  await db.userOpCoAssignment.updateMany({
    where: { userId },
    data: { isActive: false, endedAt: new Date() },
  })
}

export async function reactivateUser(userId: string) {
  const session = await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { opcoAssignments: { include: { opco: true } } },
  })
  if (!user) throw new Error("User not found")

  const authorized =
    isGroupAdmin(session.realmRoles) ||
    user.opcoAssignments.some((a) =>
      canManageUsers(session.organizations, session.realmRoles, a.opco.slug)
    )
  if (!authorized) {
    throw new Error("Forbidden: cannot manage this user")
  }

  await reactivateKeycloakUser(user.keycloakId)

  await db.user.update({ where: { id: userId }, data: { isActive: true } })
  await db.userOpCoAssignment.updateMany({
    where: { userId },
    data: { isActive: true, endedAt: null },
  })
}
