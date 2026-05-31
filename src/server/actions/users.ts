// src/server/actions/users.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { createKeycloakUser, assignToOrganization, deactivateKeycloakUser } from "@/server/keycloak"
import type { Role } from "@prisma/client"

export async function createUser(input: {
  name: string
  email: string
  tempPassword: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  await getAppSession()

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
  await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  await deactivateKeycloakUser(user.keycloakId)

  await db.user.update({ where: { id: userId }, data: { isActive: false } })
  await db.userOpCoAssignment.updateMany({
    where: { userId },
    data: { isActive: false, endedAt: new Date() },
  })
}
