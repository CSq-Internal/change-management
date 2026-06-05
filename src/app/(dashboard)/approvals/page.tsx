import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, isGroupLevel } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import ApprovalsClient from "./approvals-client"

export default async function Approvals() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const currentUser = await db.user.findUnique({
    where: { keycloakId: session.user.keycloakId },
    select: { isGroupCto: true },
  })
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const seeAll = isGroupLevel(session.user.realmRoles) || currentUser?.isGroupCto === true
  const opcoSlugs = session.user.organizations.map((o) => o.alias)

  const where = {
    status: "pending" as const,
    ...(seeAll ? {} : { opco: { slug: { in: opcoSlugs } } }),
  }

  const changes = await db.changeRequest.findMany({
    where,
    include: { requester: true, opco: true, approvals: true },
    orderBy: { createdAt: "asc" },
  })

  const serializable = changes.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    riskLevel: c.riskLevel,
    createdAt: c.createdAt,
    requester: { name: c.requester.name, email: c.requester.email },
    opco: { name: c.opco.name, slug: c.opco.slug },
    approvals: c.approvals.map((a) => ({
      isCab: a.isCab,
      decision: a.decision,
      approverId: a.approverId,
    })),
  }))

  const canApprove =
    groupLevel ||
    currentUser?.isGroupCto === true ||
    session.user.organizations.some((o) => o.roles.includes("approver") || o.roles.includes("admin"))

  if (!canApprove) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Approver Access Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You need approver or admin role to view requests awaiting your decision.
          </p>
        </CardContent>
      </Card>
    )
  }

  return <ApprovalsClient changes={serializable} isCabMember={groupLevel} />
}
