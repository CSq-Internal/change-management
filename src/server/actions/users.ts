// src/server/actions/users.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, canManageUsers, canAssignRole } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { createKeycloakUser, assignToOrganization, deactivateKeycloakUser, reactivateKeycloakUser } from "@/server/keycloak"
import type { Role, Prisma } from "@prisma/client"
import type { SessionOrganization } from "@/types/next-auth"

// Throws unless the caller may manage a user — a group_admin, or an admin of any
// OpCo the user is assigned to.
function assertCanManageUser(
  session: { organizations: SessionOrganization[]; realmRoles: string[] },
  assignments: Array<{ opco: { slug: string } }>
) {
  const authorized =
    isGroupAdmin(session.realmRoles) ||
    assignments.some((a) => canManageUsers(session.organizations, session.realmRoles, a.opco.slug))
  if (!authorized) throw new Error("Forbidden: cannot manage this user")
}

export async function onboardUser(input: {
  name: string
  email: string
  tempPassword: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  const session = await getAppSession()

  if (input.assignments.length === 0) throw new Error("At least one assignment is required")
  for (const a of input.assignments) {
    if (!canAssignRole(session.organizations, session.realmRoles, a.opcoSlug, a.role)) {
      throw new Error(`Forbidden: cannot assign ${a.role} in ${a.opcoSlug}`)
    }
  }

  const db = getPrisma()
  const existing = await db.user.findFirst({ where: { email: input.email } })

  // Keycloak identity work happens outside the DB transaction (external, non-rollbackable).
  let keycloakId: string
  if (existing) {
    keycloakId = existing.keycloakId
  } else {
    keycloakId = await createKeycloakUser(input.email, input.name, input.tempPassword)
  }
  for (const { opcoSlug } of input.assignments) {
    try {
      await assignToOrganization(keycloakId, opcoSlug)
    } catch (err) {
      console.warn(`[keycloak] org assignment skipped for ${opcoSlug}:`, err)
    }
  }

  return db.$transaction(async (tx) => {
    const user = existing
      ? existing
      : await tx.user.create({ data: { keycloakId, email: input.email, name: input.name } })

    for (const { opcoSlug, role } of input.assignments) {
      const opco = await tx.opCo.findUnique({ where: { slug: opcoSlug } })
      if (!opco) {
        console.warn(`[onboardUser] OpCo not found for slug: ${opcoSlug}`)
        continue
      }
      await tx.userOpCoAssignment.upsert({
        where: { userId_opcoId: { userId: user.id, opcoId: opco.id } },
        update: { role, isActive: true, endedAt: null },
        create: { userId: user.id, opcoId: opco.id, role },
      })
    }

    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: existing ? "user.link" : "user.onboard",
      targetUserId: user.id,
      summary: `${existing ? "Linked" : "Onboarded"} ${input.email} (${input.assignments.map((a) => `${a.role}@${a.opcoSlug}`).join(", ")})`,
      metadata: { assignments: input.assignments },
    })

    return user
  })
}

// Throws if ending `userId`'s admin role in `opcoId` would leave the OpCo with zero active admins.
async function assertNotLastAdmin(
  client: Pick<Prisma.TransactionClient, "userOpCoAssignment">,
  opcoId: string,
  excludingUserId: string
) {
  const others = await client.userOpCoAssignment.count({
    where: { opcoId, role: "admin", isActive: true, userId: { not: excludingUserId } },
  })
  if (others === 0) throw new Error("Forbidden: cannot remove the last admin of an OpCo")
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

  assertCanManageUser(session, user.opcoAssignments)

  for (const a of user.opcoAssignments) {
    if (a.isActive && a.role === "admin") {
      await assertNotLastAdmin(db, a.opco.id, userId)
    }
  }

  await deactivateKeycloakUser(user.keycloakId)

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } })
    await tx.userOpCoAssignment.updateMany({
      where: { userId },
      data: { isActive: false, endedAt: new Date() },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "user.deactivate",
      targetUserId: userId,
      summary: `Deactivated user ${userId}`,
    })
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

  assertCanManageUser(session, user.opcoAssignments)

  await reactivateKeycloakUser(user.keycloakId)

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: true } })
    await tx.userOpCoAssignment.updateMany({
      where: { userId },
      data: { isActive: true, endedAt: null },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "user.reactivate",
      targetUserId: userId,
      summary: `Reactivated user ${userId}`,
    })
  })
}

export async function setUserAssignments(
  userId: string,
  desired: Array<{ opcoSlug: string; role: Role }>
) {
  const session = await getAppSession()
  const db = getPrisma()

  const slugs = desired.map((d) => d.opcoSlug)
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Duplicate OpCo in assignments")
  }
  if (desired.length === 0) {
    throw new Error("At least one assignment is required")
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, keycloakId: true },
  })
  if (!user) throw new Error("User not found")

  const current = await db.userOpCoAssignment.findMany({
    where: { userId, isActive: true },
    include: { opco: true },
  })
  const currentBySlug = new Map(current.map((a: { opco: { slug: string }; role: string }) => [a.opco.slug, a.role]))
  const desiredBySlug = new Map(desired.map((d) => [d.opcoSlug, d.role]))

  const changed = new Set<string>()
  for (const [slug, role] of desiredBySlug) {
    if (currentBySlug.get(slug) !== role) changed.add(slug) // added or role-changed
  }
  for (const slug of currentBySlug.keys()) {
    if (!desiredBySlug.has(slug)) changed.add(slug) // removed
  }

  for (const slug of changed) {
    const desiredRole = desiredBySlug.get(slug)
    const ok =
      desiredRole === undefined
        ? isGroupAdmin(session.realmRoles) || canManageUsers(session.organizations, session.realmRoles, slug)
        : canAssignRole(session.organizations, session.realmRoles, slug, desiredRole)
    if (!ok) throw new Error(`Forbidden: cannot manage roles in ${slug}`)
  }

  if (user.keycloakId === session.keycloakId) {
    for (const [slug, role] of currentBySlug) {
      if (role === "admin" && desiredBySlug.get(slug) !== "admin") {
        throw new Error("Forbidden: cannot remove your own admin access")
      }
    }
  }

  await db.$transaction(async (tx) => {
    for (const slug of changed) {
      const currentOpcoId = current.find((a: { opco: { slug: string; id: string } }) => a.opco.slug === slug)?.opco.id

      if (currentBySlug.get(slug) === "admin" && desiredBySlug.get(slug) !== "admin") {
        await assertNotLastAdmin(tx, currentOpcoId!, userId)
      }

      const desiredRole = desiredBySlug.get(slug)
      if (desiredRole === undefined) {
        await tx.userOpCoAssignment.update({
          where: { userId_opcoId: { userId, opcoId: currentOpcoId! } },
          data: { isActive: false, endedAt: new Date() },
        })
      } else {
        const opco = await tx.opCo.findUnique({ where: { slug } })
        if (!opco) {
          console.warn(`[setUserAssignments] OpCo not found for slug: ${slug}`)
          continue
        }
        await tx.userOpCoAssignment.upsert({
          where: { userId_opcoId: { userId, opcoId: opco.id } },
          update: { role: desiredRole, isActive: true, endedAt: null },
          create: { userId, opcoId: opco.id, role: desiredRole },
        })
        try {
          await assignToOrganization(user.keycloakId, slug)
        } catch (err) {
          console.warn(`[keycloak] org assignment skipped for ${slug}:`, err)
        }
      }
    }

    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "role.update",
      targetUserId: userId,
      summary: `Updated assignments for user ${userId}: ${[...changed].join(", ")}`,
      metadata: { changed: [...changed], desired },
    })
  })
}

export async function listOpCoApprovers(opcoSlug: string | null) {
  const session = await getAppSession()
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new Error("Forbidden: only a group_admin can list group approvers")
    }
  } else if (!canManageUsers(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot list approvers in ${opcoSlug}`)
  }

  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { role: "approver", isActive: true, ...(opcoSlug ? { opco: { slug: opcoSlug } } : {}) },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}
