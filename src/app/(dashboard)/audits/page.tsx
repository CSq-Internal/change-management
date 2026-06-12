import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import AuditsClient from "./audits-client"

export default async function Audits() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const entries = await db.auditLog.findMany({
    where: { change: { ...opcoFilter } },
    include: {
      actor: true,
      change: { include: { opco: true } },
    },
    orderBy: { at: "desc" },
    take: 100,
  })

  const serializable = entries.map((e) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    note: e.note ?? null,
    actor: { name: e.actor.name, email: e.actor.email },
    change: {
      title: e.change.title,
      opco: { slug: e.change.opco.slug },
    },
  }))

  return <AuditsClient entries={serializable} />
}
