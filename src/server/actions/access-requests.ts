// src/server/actions/access-requests.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canAssignRole, manageableOpCoSlugs } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { notifyUsers } from "@/server/notify"
import { sendAccessRequestEmail } from "@/server/email"
import { assignToOrganization } from "@/server/keycloak"
import { coerceLocale, t } from "@/lib/i18n"

export async function requestAccess(input: { opcoSlug: string; note?: string }) {
  const session = await getAppSession()
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const opco = await db.opCo.findUnique({
    where: { slug: input.opcoSlug },
    select: { id: true, name: true, locale: true },
  })
  if (!opco) throw new Error("OpCo not found")

  const alreadyRequester = await db.userOpCoAssignment.findFirst({
    where: { userId: me.id, opcoId: opco.id, role: "requester", isActive: true },
    select: { id: true },
  })
  if (alreadyRequester) throw new Error("You already have requester access to this OpCo")

  const pending = await db.accessRequest.findFirst({
    where: { userId: me.id, opcoId: opco.id, status: "pending" },
    select: { id: true },
  })
  if (pending) throw new Error("You already have a pending request for this OpCo")

  const created = await db.accessRequest.create({
    data: { userId: me.id, opcoId: opco.id, role: "requester", note: input.note ?? null },
  })

  await recordAdminAction(db, {
    actorKeycloakId: session.keycloakId,
    actorEmail: session.email,
    actorName: session.name,
    action: "access.request",
    summary: `Requested requester access to ${opco.name}`,
    opcoId: opco.id,
    metadata: { accessRequestId: created.id, opcoSlug: input.opcoSlug },
  })

  // Recipients: active admins of the target OpCo PLUS all active group-level admins
  // (group_admin lives only in Keycloak, mirrored to User.isGroupAdmin at sign-in).
  // Dedup by user id; never notify the requester themselves.
  const [opAdmins, groupAdmins] = await Promise.all([
    db.userOpCoAssignment.findMany({
      where: { opcoId: opco.id, role: "admin", isActive: true, user: { isActive: true } },
      select: { userId: true, user: { select: { email: true, name: true, locale: true } } },
    }),
    db.user.findMany({
      where: { isGroupAdmin: true, isActive: true },
      select: { id: true, email: true, name: true, locale: true },
    }),
  ])

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
      { type: "access.requested", title: t(opcoLocale, "notif.access.requested.title"), body: `${requesterName} → ${opco.name}` }
    ),
    ...recipients.map((r) =>
      sendAccessRequestEmail({
        to: r.email,
        adminName: r.name ?? r.email,
        requesterName,
        opcoName: opco.name,
        locale: coerceLocale(r.locale),
      })
    ),
  ])

  return { id: created.id }
}

export async function listAccessRequests() {
  const session = await getAppSession()
  const db = getPrisma()

  const scope = manageableOpCoSlugs(session.organizations, session.realmRoles)
  const rows = await db.accessRequest.findMany({
    where: {
      status: "pending",
      ...(scope === "all" ? {} : { opco: { slug: { in: scope } } }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      note: true,
      createdAt: true,
      opco: { select: { name: true, slug: true } },
      user: { select: { name: true, email: true } },
    },
  })

  return rows.map((r) => ({
    id: r.id,
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
      user: { select: { keycloakId: true, locale: true } },
    },
  })
  if (!req) throw new Error("Access request not found")
  if (req.status !== "pending") throw new Error("Access request already decided")
  if (!canAssignRole(session.organizations, session.realmRoles, req.opco.slug, req.role)) {
    throw new Error(`Forbidden: cannot grant ${req.role} in ${req.opco.slug}`)
  }

  const actor = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  return { session, db, req, actorId: actor?.id ?? null }
}

export async function approveAccessRequest(id: string) {
  const { session, db, req, actorId } = await loadDecidableRequest(id)

  await db.$transaction(async (tx) => {
    await tx.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: req.userId, opcoId: req.opco.id } },
      update: { role: req.role, isActive: true, endedAt: null },
      create: { userId: req.userId, opcoId: req.opco.id, role: req.role },
    })
    await tx.accessRequest.update({
      where: { id: req.id },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
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

  try {
    await assignToOrganization(req.user.keycloakId, req.opco.slug)
  } catch (err) {
    console.warn(`[keycloak] org assignment skipped for ${req.opco.slug}:`, err)
  }

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
    await tx.accessRequest.update({
      where: { id: req.id },
      data: { status: "denied", decidedById: actorId, decidedAt: new Date(), decisionReason: reason ?? null },
    })
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
