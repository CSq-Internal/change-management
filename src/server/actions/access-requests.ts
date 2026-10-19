// src/server/actions/access-requests.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canAssignRole } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { decidableAccessRequests } from "@/server/access-queue"
import { notifyUsers } from "@/server/notify"
import { sendAccessRequestEmail } from "@/server/email"
import { coerceLocale, t } from "@/lib/i18n"

export type RequestableRole = "approver" | "auditor" | "admin"
const REQUESTABLE_ROLES: readonly string[] = ["approver", "auditor", "admin"]
const MAX_REASON = 500

// Elevation: ask for a higher role in an OpCo. Who is told mirrors canAssignRole:
// OpCo admins can grant approver/auditor in their OpCo; only group admins grant admin.
export async function requestRole(input: { opcoSlug: string; role: RequestableRole; reason: string }) {
  if (!REQUESTABLE_ROLES.includes(input.role)) throw new Error(`The ${input.role} role cannot be requested`)
  const reason = input.reason.trim()
  if (!reason) throw new Error("A reason is required")
  if (reason.length > MAX_REASON) throw new Error(`Keep the reason to ${MAX_REASON} characters`)

  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true, isActive: true } })
  if (!me) throw new Error("User not found")
  if (!me.isActive) throw new Error("Your account is deactivated")
  // Role requests are for people already in the CMS; newcomers join an OpCo first.
  const memberships = await db.userOpCoAssignment.count({ where: { userId: me.id, isActive: true } })
  if (memberships === 0) throw new Error("Choose your OpCo first, then request a role")

  const opco = await db.opCo.findUnique({
    where: { slug: input.opcoSlug },
    select: { id: true, name: true, locale: true, archivedAt: true },
  })
  if (!opco || opco.archivedAt) throw new Error("OpCo not found")

  const created = await db.$transaction(async (tx) => {
    // Lock the user's row so two concurrent requests can't both pass the
    // pending check below.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${me.id} FOR UPDATE`

    const holds = await tx.userOpCoAssignment.findFirst({
      where: { userId: me.id, opcoId: opco.id, role: input.role, isActive: true },
      select: { id: true },
    })
    if (holds) throw new Error("You already have this role in this OpCo")

    const pending = await tx.accessRequest.findFirst({
      where: { userId: me.id, opcoId: opco.id, status: "pending" },
      select: { id: true },
    })
    if (pending) throw new Error("You already have a pending request for this OpCo")

    const row = await tx.accessRequest.create({
      data: { userId: me.id, opcoId: opco.id, role: input.role, note: reason },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.request",
      summary: `Requested ${input.role} in ${opco.name}`,
      opcoId: opco.id,
      metadata: { accessRequestId: row.id, opcoSlug: input.opcoSlug, role: input.role },
    })
    return row
  })

  // group_admin lives only in Keycloak, mirrored to User.isGroupAdmin at sign-in.
  const opAdmins =
    input.role === "admin"
      ? []
      : await db.userOpCoAssignment.findMany({
          where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
          select: { userId: true, user: { select: { email: true, name: true, locale: true } } },
        })
  const groupAdmins = await db.user.findMany({
    where: { isGroupAdmin: true, isActive: true },
    select: { id: true, email: true, name: true, locale: true },
  })

  // Dedup by user id; never notify the requester themselves.
  const byId = new Map<string, { userId: string; email: string; name: string | null; locale: string | null }>()
  for (const a of opAdmins) byId.set(a.userId, { userId: a.userId, email: a.user.email, name: a.user.name, locale: a.user.locale })
  for (const g of groupAdmins) byId.set(g.id, { userId: g.id, email: g.email, name: g.name, locale: g.locale })
  byId.delete(me.id)
  const recipients = [...byId.values()]

  const requesterName = session.name ?? session.email
  const opcoLocale = coerceLocale(opco.locale)
  await Promise.allSettled([
    notifyUsers(
      recipients.map((r) => ({ userId: r.userId })),
      { type: "access.requested", title: t(opcoLocale, "notif.access.requested.title"), body: `${requesterName} → ${input.role}, ${opco.name}` }
    ),
    ...recipients.map((r) =>
      sendAccessRequestEmail({
        to: r.email,
        adminName: r.name ?? r.email,
        requesterName,
        opcoName: opco.name,
        role: input.role,
        locale: coerceLocale(r.locale),
      })
    ),
  ])

  return { id: created.id }
}

export async function listMyRoleRequests() {
  const session = await getAppSession()
  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) return []

  const rows = await db.accessRequest.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, status: true, decisionReason: true, createdAt: true, opco: { select: { name: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    opcoName: r.opco.name,
    role: r.role as string,
    status: r.status,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  }))
}

// First sign-in: the user picks their OpCo and becomes a requester there at once.
// Only for active users who have never had an OpCo assignment: someone an admin
// removed (ended rows) must not re-grant themselves, and it can't collect OpCos.
// Anything more goes through a role request or an admin.
export async function joinOpCo(opcoSlug: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true, isActive: true } })
  if (!me) throw new Error("User not found")
  if (!me.isActive) throw new Error("Your account is deactivated")

  const opco = await db.opCo.findUnique({
    where: { slug: opcoSlug },
    select: { id: true, name: true, slug: true, locale: true, archivedAt: true },
  })
  if (!opco || opco.archivedAt) throw new Error("OpCo not found")

  await db.$transaction(async (tx) => {
    // Lock the user's row so two concurrent joins run one after the other: the
    // second then sees the first's assignment and is refused.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${me.id} FOR UPDATE`
    const hadAccess = await tx.userOpCoAssignment.findFirst({
      where: { userId: me.id },
      select: { id: true },
    })
    if (hadAccess) throw new Error("You already have, or had, OpCo access. Ask an admin to change it.")

    await tx.userOpCoAssignment.create({
      data: { userId: me.id, opcoId: opco.id, role: "requester" },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.join",
      summary: `Joined ${opco.name} as requester`,
      opcoId: opco.id,
      targetUserId: me.id,
      metadata: { opcoSlug },
    })
  })

  const admins = await db.userOpCoAssignment.findMany({
    where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
    select: { userId: true },
  })
  const recipients = admins.filter((a) => a.userId !== me.id).map((a) => ({ userId: a.userId }))
  await notifyUsers(recipients, {
    type: "access.joined",
    title: t(coerceLocale(opco.locale), "notif.access.joined.title"),
    body: `${session.name ?? session.email} → ${opco.name}`,
  })

  return { ok: true as const }
}

export async function listAccessRequests() {
  const session = await getAppSession()
  const db = getPrisma()

  const rows = await db.accessRequest.findMany({
    where: decidableAccessRequests(session),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      note: true,
      createdAt: true,
      opco: { select: { name: true, slug: true } },
      user: { select: { name: true, email: true } },
    },
  })

  return rows.map((r) => ({
    id: r.id,
    role: r.role as string,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    opcoName: r.opco.name,
    opcoSlug: r.opco.slug,
    requesterName: r.user.name ?? r.user.email,
    requesterEmail: r.user.email,
  }))
}

// Loads a pending request and asserts the caller can assign its role in its OpCo.
// Returns the request and the actor's DB user id (nullable — used for decidedById).
async function loadDecidableRequest(id: string) {
  const session = await getAppSession()
  const db = getPrisma()

  const req = await db.accessRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      role: true,
      opco: { select: { id: true, slug: true, name: true } },
      user: { select: { keycloakId: true, locale: true, isActive: true } },
    },
  })
  if (!req) throw new Error("Access request not found")
  if (req.status !== "pending") throw new Error("Access request already decided")
  if (!canAssignRole(session.organizations, session.realmRoles, req.opco.slug, req.role)) {
    throw new Error(`Forbidden: cannot grant ${req.role} in ${req.opco.slug}`)
  }

  const actor = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  // Separation of duties: nobody decides their own role request.
  if (actor && actor.id === req.userId) throw new Error("You can't decide your own role request")
  return { session, db, req, actorId: actor?.id ?? null }
}

export async function approveAccessRequest(id: string) {
  const { session, db, req, actorId } = await loadDecidableRequest(id)
  if (!req.user.isActive) throw new Error("This account is deactivated")

  await db.$transaction(async (tx) => {
    // The pending check above runs outside this transaction, so a second admin can pass it
    // too. Deciding first, conditionally, lets exactly one decision land.
    const { count } = await tx.accessRequest.updateMany({
      where: { id: req.id, status: "pending" },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
    })
    if (count !== 1) throw new Error("Access request already decided")

    // Approving replaces the user's role in this OpCo. Keep the Users page's rule:
    // an OpCo can't lose its last admin this way.
    const current = await tx.userOpCoAssignment.findUnique({
      where: { userId_opcoId: { userId: req.userId, opcoId: req.opco.id } },
      select: { role: true, isActive: true },
    })
    if (current?.isActive && current.role === "admin" && req.role !== "admin") {
      const otherAdmins = await tx.userOpCoAssignment.count({
        where: { opcoId: req.opco.id, role: "admin", isActive: true, userId: { not: req.userId } },
      })
      if (otherAdmins === 0) throw new Error("Forbidden: cannot remove the last admin of an OpCo")
    }

    await tx.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: req.userId, opcoId: req.opco.id } },
      update: { role: req.role, isActive: true, endedAt: null },
      create: { userId: req.userId, opcoId: req.opco.id, role: req.role },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.approve",
      summary: `Approved ${req.role} access to ${req.opco.name}`,
      opcoId: req.opco.id,
      targetUserId: req.userId,
      metadata: { accessRequestId: req.id },
    })
  })

  const locale = coerceLocale(req.user.locale)
  await notifyUsers([{ userId: req.userId }], {
    type: "access.approved",
    title: t(locale, "notif.access.approved.title"),
    body: req.opco.name,
  })

  return { ok: true as const }
}

export async function denyAccessRequest(id: string, reason?: string) {
  const { session, db, req, actorId } = await loadDecidableRequest(id)

  await db.$transaction(async (tx) => {
    const { count } = await tx.accessRequest.updateMany({
      where: { id: req.id, status: "pending" },
      data: { status: "denied", decidedById: actorId, decidedAt: new Date(), decisionReason: reason ?? null },
    })
    if (count !== 1) throw new Error("Access request already decided")
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "access.deny",
      summary: `Denied ${req.role} access to ${req.opco.name}`,
      opcoId: req.opco.id,
      targetUserId: req.userId,
      metadata: { accessRequestId: req.id, reason: reason ?? null },
    })
  })

  const locale = coerceLocale(req.user.locale)
  await notifyUsers([{ userId: req.userId }], {
    type: "access.denied",
    title: t(locale, "notif.access.denied.title"),
    body: req.opco.name,
  })

  return { ok: true as const }
}
