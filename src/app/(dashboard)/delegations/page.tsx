import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs } from "@/lib/permissions"
import DelegationsClient from "./delegations-client"
import type { DbDelegation } from "./types"

export default async function DelegationsPage() {
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
  const opcos = await db.opCo.findMany({
    where: slugFilter ? { slug: slugFilter } : {},
    select: { id: true, name: true, slug: true },
  })
  const opcoById = new Map(opcos.map((o) => [o.id, o]))

  const rows = await db.approverDelegation.findMany({
    where: { isActive: true, opcoId: { in: opcos.map((o) => o.id) } },
    include: {
      fromUser: { select: { id: true, name: true, email: true } },
      toUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { validUntil: "asc" },
  })

  const delegations: DbDelegation[] = rows.map((d) => {
    const opco = opcoById.get(d.opcoId)
    return {
      id: d.id,
      opco: { name: opco?.name ?? "", slug: opco?.slug ?? "" },
      fromUser: d.fromUser,
      toUser: d.toUser,
      validUntil: d.validUntil.toISOString(),
    }
  })

  return <DelegationsClient delegations={delegations} />
}
