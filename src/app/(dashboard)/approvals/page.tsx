import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { listApprovableChanges } from "@/server/approval-authority"
import ApprovalsClient from "./approvals-client"

export default async function Approvals() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.user.keycloakId }, select: { id: true } })
  if (!me) redirect("/login")

  const changes = await listApprovableChanges({ userId: me.id, realmRoles: session.user.realmRoles })

  const serializable = changes.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    riskLevel: c.riskLevel,
    createdAt: c.createdAt,
    requester: { name: c.requester.name, email: c.requester.email },
    opco: { name: c.opco.name, slug: c.opco.slug },
    approvals: c.approvals.map((a) => ({ isCab: a.isCab, decision: a.decision, approverId: a.approverId })),
  }))

  return <ApprovalsClient changes={serializable} isCabMember={true} />
}
