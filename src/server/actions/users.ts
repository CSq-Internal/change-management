// src/server/actions/users.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, canManageUsers, canAssignRole } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { createOrFindKeycloakUser, verifyAdoptedKeycloakUser } from "@/server/keycloak"
import { approverPendingFootprint, notifyRemainingAndDetectOrphans } from "@/server/approver-reassign"
import { sendUserInvitationEmail } from "@/server/email"
import { coerceLocale } from "@/lib/i18n"
import { isAllowedSignInEmail } from "@/lib/sign-in-domain"
import type { Role, Prisma } from "@prisma/client"
import { UserError } from "@/lib/user-error"

// Deactivating or reactivating acts on the whole user, so a caller below group_admin must
// hold the right (`rights`, one per role touched) for every role, and may not act on a
// group admin. With nothing to check, only a group_admin may act.
function assertCanActOnEveryRole(
  session: { realmRoles: string[] },
  target: { isGroupAdmin: boolean; isGroupAuditor: boolean },
  rights: boolean[]
) {
  if (isGroupAdmin(session.realmRoles)) return
  if (target.isGroupAdmin || target.isGroupAuditor || rights.length === 0 || rights.includes(false)) {
    throw new UserError("Forbidden: this user has roles you cannot manage. Ask a group admin.")
  }
}

export async function onboardUser(input: {
  name: string
  email: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  const session = await getAppSession()

  if (input.assignments.length === 0) throw new UserError("At least one assignment is required")
  // Stored exactly as the Google profile will send it, so the row matches at sign-in.
  const email = input.email.trim().toLowerCase()
  if (!isAllowedSignInEmail(email)) throw new UserError("Only @csquared.com addresses can be onboarded.")
  for (const a of input.assignments) {
    if (!canAssignRole(session.organizations, session.realmRoles, a.opcoSlug, a.role)) {
      throw new UserError(`Forbidden: cannot assign ${a.role} in ${a.opcoSlug}`)
    }
  }

  const db = getPrisma()
  const existing = await db.user.findFirst({ where: { email } })
  if (existing && !existing.isActive) {
    throw new UserError("This user is deactivated. Reactivate them from the Users page instead.")
  }

  // Keycloak identity work happens outside the DB transaction (external, non-rollbackable).
  let keycloakId: string
  let createdKeycloakIdentity = false

  if (existing) {
    keycloakId = existing.keycloakId
  } else {
    const identity = await createOrFindKeycloakUser(email, input.name)
    keycloakId = identity.id
    createdKeycloakIdentity = identity.created
  }

  // An ADOPTED Keycloak account (a re-invite after a DB wipe, or someone already on the
  // shared realm) gets its email verified so it can sign in. The CMS never enables it or
  // touches its password: the realm is shared, so a disabled account refuses the invite.
  if (!createdKeycloakIdentity) {
    let state: "verified" | "disabled" | undefined
    try {
      state = await verifyAdoptedKeycloakUser(keycloakId)
    } catch (err) {
      console.warn(`[onboardUser] Keycloak reconcile skipped for ${email}:`, err)
    }
    if (state === "disabled") {
      throw new UserError("This account is disabled in Keycloak, which other CSquared apps share. Ask IT before inviting.")
    }
  }

  const user = await db.$transaction(async (tx) => {
    const user = existing
      ? existing
      : await tx.user.create({ data: { keycloakId, email, name: input.name } })

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
      actorEmail: session.email,
      actorName: session.name,
      action: existing ? "user.link" : "user.onboard",
      targetUserId: user.id,
      summary: `${existing ? "Linked" : "Onboarded"} ${email} (${input.assignments.map((a) => `${a.role}@${a.opcoSlug}`).join(", ")})`,
      metadata: { assignments: input.assignments },
    })

    return user
  })

  let inviteLocale: "en" | "fr" = "en"
  const firstSlug = input.assignments[0]?.opcoSlug
  if (firstSlug) {
    const opco = await db.opCo.findUnique({ where: { slug: firstSlug }, select: { locale: true } })
    inviteLocale = coerceLocale(opco?.locale)
  }

  try {
    await sendUserInvitationEmail({
      to: email,
      name: input.name,
      assignments: input.assignments,
      locale: inviteLocale,
    })
  } catch (err) {
    console.warn(`[onboardUser] invitation email failed for ${email}:`, err)
  }

  return user
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
  if (others === 0) throw new UserError("Forbidden: cannot remove the last admin of an OpCo")
}

// Throws if `excludingUserId` losing group admin would leave no active group admin.
async function assertNotLastGroupAdmin(client: Pick<Prisma.TransactionClient, "user">, excludingUserId: string) {
  const others = await client.user.count({
    where: { isGroupAdmin: true, isActive: true, id: { not: excludingUserId } },
  })
  if (others === 0) throw new UserError("Forbidden: cannot remove the last active group admin")
}

export async function deactivateUser(userId: string) {
  const session = await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { opcoAssignments: { where: { isActive: true }, include: { opco: true } } },
  })
  if (!user) throw new UserError("User not found")

  if (user.keycloakId === session.keycloakId) {
    throw new UserError("Forbidden: cannot deactivate yourself")
  }

  assertCanActOnEveryRole(
    session, user,
    user.opcoAssignments.map((a) => canManageUsers(session.organizations, session.realmRoles, a.opco.slug)),
  )

  for (const a of user.opcoAssignments) {
    if (a.isActive && a.role === "admin") {
      await assertNotLastAdmin(db, a.opco.id, userId)
    }
  }
  if (user.isGroupAdmin) await assertNotLastGroupAdmin(db, userId)

  // The Keycloak account stays enabled: the realm is shared with other apps, and the CMS
  // session check (enrichedJwt) refuses an inactive user on its own.
  const footprint = await approverPendingFootprint(userId)

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } })
    // Only active rows, so roles ended earlier keep their date and stay ended on reactivation.
    await tx.userOpCoAssignment.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    })
    await tx.cABMembership.updateMany({ where: { userId, isActive: true }, data: { isActive: false, endedAt: new Date() } })
    await tx.approverAssignment.updateMany({ where: { userId, isActive: true }, data: { isActive: false } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "user.deactivate",
      targetUserId: userId,
      summary: `Deactivated user ${userId}`,
      metadata: { endedAssignmentIds: user.opcoAssignments.map((a) => a.id) },
    })
  })

  const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
  return { orphanedChanges: orphaned }
}

export async function reactivateUser(userId: string) {
  const session = await getAppSession()

  const db = getPrisma()
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) throw new UserError("User not found")
  if (user.isActive) throw new UserError("User is already active")

  // Restore only the roles the last deactivation ended; roles removed before it stay
  // removed. Deactivations recorded before this metadata existed restore none.
  const last = await db.adminAuditLog.findFirst({
    where: { action: "user.deactivate", targetUserId: userId },
    orderBy: { at: "desc" },
    select: { metadata: true },
  })
  const ids = (last?.metadata as { endedAssignmentIds?: string[] } | null)?.endedAssignmentIds ?? []
  const rows = ids.length
    ? await db.userOpCoAssignment.findMany({ where: { id: { in: ids }, userId }, include: { opco: true } })
    : []

  assertCanActOnEveryRole(
    session, user,
    rows.map((r) => canAssignRole(session.organizations, session.realmRoles, r.opco.slug, r.role)),
  )

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: true } })
    if (rows.length) {
      await tx.userOpCoAssignment.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, userId },
        data: { isActive: true, endedAt: null },
      })
    }
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
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
    throw new UserError("Duplicate OpCo in assignments")
  }
  if (desired.length === 0) {
    throw new UserError("At least one assignment is required")
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, keycloakId: true },
  })
  if (!user) throw new UserError("User not found")

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
    if (!ok) throw new UserError(`Forbidden: cannot manage roles in ${slug}`)
  }

  if (user.keycloakId === session.keycloakId) {
    for (const [slug, role] of currentBySlug) {
      if (role === "admin" && desiredBySlug.get(slug) !== "admin") {
        throw new UserError("Forbidden: cannot remove your own admin access")
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
      }
    }

    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
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
      throw new UserError("Forbidden: only a group_admin can list group approvers")
    }
  } else if (!canManageUsers(session.organizations, session.realmRoles, opcoSlug)) {
    throw new UserError(`Forbidden: cannot list approvers in ${opcoSlug}`)
  }

  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { role: "approver", isActive: true, ...(opcoSlug ? { opco: { slug: opcoSlug } } : {}) },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}

// Users eligible to sit on a CAB: those holding the approver OR admin role — matching
// what addCabMember accepts. Separate from listOpCoApprovers, which stays approver-only
// for the delegations flow.
export async function listCabEligible(opcoSlug: string | null) {
  const session = await getAppSession()
  if (opcoSlug === null) {
    if (!isGroupAdmin(session.realmRoles)) {
      throw new UserError("Forbidden: only a group_admin can list group CAB candidates")
    }
  } else if (!canManageUsers(session.organizations, session.realmRoles, opcoSlug)) {
    throw new UserError(`Forbidden: cannot list CAB candidates in ${opcoSlug}`)
  }

  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { role: { in: ["approver", "admin"] }, isActive: true, ...(opcoSlug ? { opco: { slug: opcoSlug } } : {}) },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}

export type GroupRole = "group_admin" | "group_auditor"

/** Grant, change or remove a user's group role. Only a group admin may call it. */
export async function setGroupRole(userId: string, role: GroupRole | null) {
  const session = await getAppSession()
  if (role !== null && role !== "group_admin" && role !== "group_auditor") throw new UserError("Invalid group role")
  if (!isGroupAdmin(session.realmRoles)) throw new UserError("Forbidden: only a group admin can change group roles")

  const db = getPrisma()
  // Serializable: two admins demoting each other at once can't both pass the last-admin check.
  await db.$transaction(async (tx) => {
    // The session can be up to 60s old: a just-revoked group admin must not hand out roles.
    const me = await tx.user.findUnique({ where: { keycloakId: session.keycloakId } })
    if (!me?.isActive || !me.isGroupAdmin) throw new UserError("Forbidden: only a group admin can change group roles")
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) throw new UserError("User not found")
    if (user.keycloakId === session.keycloakId) throw new UserError("Forbidden: cannot change your own group role")
    if (!user.isActive) throw new UserError("This user is deactivated. Reactivate them first.")

    const from: GroupRole | null = user.isGroupAdmin ? "group_admin" : user.isGroupAuditor ? "group_auditor" : null
    if (from === role) return
    if (from === "group_admin") await assertNotLastGroupAdmin(tx, userId)

    await tx.user.update({
      where: { id: userId },
      data: { isGroupAdmin: role === "group_admin", isGroupAuditor: role === "group_auditor" },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "user.group_role",
      targetUserId: userId,
      summary: `Group role: ${from ?? "none"} → ${role ?? "none"}`,
      metadata: { from, to: role },
    })
  }, { isolationLevel: "Serializable" })
}
