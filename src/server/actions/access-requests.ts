// src/server/actions/access-requests.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canAssignRole, manageableOpCoSlugs } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { notifyUsers } from "@/server/notify"
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

  const admins = await db.userOpCoAssignment.findMany({
    where: { opcoId: opco.id, role: "admin", isActive: true },
    select: { userId: true, user: { select: { isActive: true } } },
  })
  const recipients = admins.filter((a) => a.user.isActive).map((a) => ({ userId: a.userId }))
  const locale = coerceLocale(opco.locale)
  await notifyUsers(recipients, {
    type: "access.requested",
    title: t(locale, "notif.access.requested.title"),
    body: `${session.name ?? session.email} → ${opco.name}`,
  })

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
