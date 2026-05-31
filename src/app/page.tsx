import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import { t } from "@/lib/i18n"
import DashboardClient from "./dashboard-client"

export default async function Home() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const [myRequests, pendingApprovals, activeChanges, auditReady, recent] = await Promise.all([
    db.changeRequest.count({ where: { requester: { keycloakId: session.user.keycloakId }, ...opcoFilter } }),
    db.changeRequest.count({ where: { status: "pending", ...opcoFilter } }),
    db.changeRequest.count({ where: { status: { in: ["approved", "implemented"] }, ...opcoFilter } }),
    db.changeRequest.count({ where: { status: "closed", ...opcoFilter } }),
    db.changeRequest.findMany({
      where: opcoFilter,
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
  ])

  const email = session.user.email ?? ""
  const welcomeName = email.toLowerCase().endsWith("@csquared.com")
    ? email.split("@")[0] || t("en", "dashboard.fallbackName")
    : session.user.name ?? t("en", "dashboard.fallbackName")

  const isApprover = session.user.organizations.some(
    (o) => o.roles.includes("approver") || o.roles.includes("admin")
  ) || isGroupAdmin(session.user.realmRoles)

  return (
    <DashboardClient
      myRequests={myRequests}
      pendingApprovals={pendingApprovals}
      activeChanges={activeChanges}
      auditReady={auditReady}
      recent={recent}
      welcomeName={welcomeName}
      isApprover={isApprover}
    />
  )
}
