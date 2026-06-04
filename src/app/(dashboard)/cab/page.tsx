import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs, isGroupLevel } from "@/lib/permissions"
import CabClient from "./cab-client"
import type { CabMember } from "./types"

export default async function CabPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }

  const db = getPrisma()
  const perOpcoRows = await db.cABMembership.findMany({
    where: { isActive: true, opcoId: { not: null }, ...(slugFilter ? { opco: { slug: slugFilter } } : {}) },
    include: { user: { select: { id: true, name: true, email: true } }, opco: { select: { name: true, slug: true } } },
  })

  const showGroup = isGroupLevel(session.user.realmRoles)
  const groupRows = showGroup
    ? await db.cABMembership.findMany({
        where: { isActive: true, opcoId: null },
        include: { user: { select: { id: true, name: true, email: true } } },
      })
    : []

  const perOpco: CabMember[] = perOpcoRows.map((r) => ({
    id: r.id, userId: r.userId, name: r.user.name, email: r.user.email,
    opco: r.opco ? { name: r.opco.name, slug: r.opco.slug } : null,
  }))
  const group: CabMember[] = groupRows.map((r) => ({
    id: r.id, userId: r.userId, name: r.user.name, email: r.user.email, opco: null,
  }))

  return <CabClient perOpco={perOpco} group={group} showGroup={showGroup} />
}
