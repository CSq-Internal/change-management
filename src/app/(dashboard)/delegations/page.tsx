import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { activeOpCoSlugFilter } from "@/server/opco-scope"
import DelegationsClient from "./delegations-client"
import type { DbDelegation } from "./types"

export default async function DelegationsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const slugFilter = await activeOpCoSlugFilter(session.user)

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
    const opco = d.opcoId ? opcoById.get(d.opcoId) : undefined
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
