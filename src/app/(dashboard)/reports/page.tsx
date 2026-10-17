import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { computeSlaReport, type SlaReportRow } from "@/lib/sla-report"
import ReportsClient from "./reports-client"

/** Time from the last submission to the approval that followed it; null if never approved. */
function approvalMs(trail: { action: string; at: Date }[]): number | null {
  let submittedAt: Date | null = null
  let ms: number | null = null
  for (const e of trail) {
    if (e.action === "submitted") submittedAt = e.at
    else if (e.action === "approved" && submittedAt) ms = e.at.getTime() - submittedAt.getTime()
  }
  return ms
}

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
      select: {
        id: true, title: true, status: true, riskLevel: true, createdAt: true, updatedAt: true,
        slaDeadline: true,
        opco: { select: { slug: true, name: true } },
        auditTrail: {
          where: { action: { in: ["submitted", "approved", "rejected"] } },
          orderBy: { at: "asc" },
          select: { action: true, at: true },
        },
      },
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
      approvalMs: approvalMs(c.auditTrail),
    })),
  }

  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const now = Date.now()
  const slaRows: SlaReportRow[] = changesRaw.map((c) => ({
    opcoSlug: c.opco.slug,
    opcoName: c.opco.name,
    riskLevel: c.riskLevel,
    slaDeadline: c.slaDeadline ? c.slaDeadline.getTime() : null,
    decidedAt: c.auditTrail.find((e) => e.action !== "submitted")?.at.getTime() ?? null,
  }))
  const slaCompliance = computeSlaReport(slaRows, now)

  return <ReportsClient data={{ ...data, slaCompliance }} />
}
