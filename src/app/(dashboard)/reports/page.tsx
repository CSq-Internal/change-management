import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import ReportsClient from "./reports-client"

export default async function ReportsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const [byStatusRaw, byRiskRaw, changesRaw] = await Promise.all([
    db.changeRequest.groupBy({
      by: ["status"],
      where: opcoFilter,
      _count: { status: true },
    }),
    db.changeRequest.groupBy({
      by: ["riskLevel"],
      where: opcoFilter,
      _count: { riskLevel: true },
    }),
    db.changeRequest.findMany({
      where: opcoFilter,
      select: { id: true, title: true, status: true, riskLevel: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const data = {
    byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count.status })),
    byRisk: byRiskRaw.map((r) => ({ riskLevel: r.riskLevel, count: r._count.riskLevel })),
    changes: changesRaw.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      riskLevel: c.riskLevel,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  }

  return <ReportsClient data={data} />
}
