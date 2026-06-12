// src/server/actions/audit-log.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupLevel, canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"

export type AdminAuditRow = {
  id: string
  actorEmail: string
  action: string
  summary: string
  opcoSlug: string | null
  at: string
}

export async function listAdminAudit(filters: {
  opcoSlug?: string
  action?: string
  from?: Date
  to?: Date
}): Promise<AdminAuditRow[]> {
  const session = await getAppSession()
  const groupLevel = isGroupLevel(session.realmRoles)
  const anyAdmin = canManageAnyOpCo(session.organizations, session.realmRoles)
  if (!groupLevel && !anyAdmin) {
    throw new Error("Forbidden: cannot read the admin audit log")
  }

  const db = getPrisma()

  // OpCo admins (not group-level) only see entries for OpCos they manage.
  let opcoIdClause: { in: string[] } | string | undefined
  if (!groupLevel) {
    const managed = manageableOpCoSlugs(session.organizations, session.realmRoles)
    const slugs = managed === "all" ? [] : managed
    const managedOpcos = await db.opCo.findMany({ where: { slug: { in: slugs } }, select: { id: true } })
    opcoIdClause = { in: managedOpcos.map((o) => o.id) }
  }

  // Optional explicit OpCo filter, still subject to scope.
  if (filters.opcoSlug) {
    const opco = await db.opCo.findUnique({ where: { slug: filters.opcoSlug }, select: { id: true } })
    const id = opco?.id
    const inScope = id && (groupLevel || (typeof opcoIdClause === "object" && opcoIdClause.in.includes(id)))
    opcoIdClause = inScope ? id : "__no_match__"
  }

  const at =
    filters.from || filters.to
      ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) }
      : undefined

  const rows = await db.adminAuditLog.findMany({
    where: {
      ...(opcoIdClause !== undefined ? { opcoId: opcoIdClause } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(at ? { at } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { at: "desc" },
    take: 200,
  })

  const opcoIds = [...new Set(rows.map((r) => r.opcoId).filter((x): x is string => Boolean(x)))]
  const opcos = opcoIds.length
    ? await db.opCo.findMany({ where: { id: { in: opcoIds } }, select: { id: true, slug: true } })
    : []
  const slugById = new Map(opcos.map((o) => [o.id, o.slug]))

  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actor.email,
    action: r.action,
    summary: r.summary,
    opcoSlug: r.opcoId ? slugById.get(r.opcoId) ?? null : null,
    at: r.at.toISOString(),
  }))
}
