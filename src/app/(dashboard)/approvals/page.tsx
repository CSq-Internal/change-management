import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { runDueEscalations } from "@/server/sla"
import { listApprovableChanges } from "@/server/approval-authority"
import { activeOpCoSlug } from "@/server/active-opco"
import ApprovalsClient from "./approvals-client"

export default async function Approvals() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const me = await db.user.findUnique({ where: { keycloakId: session.user.keycloakId }, select: { id: true } })
  if (!me) redirect("/login")

  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})

  const changes = await listApprovableChanges({ userId: me.id, realmRoles: session.user.realmRoles })

  // Header OpCo switcher: narrow the approvals queue to the active OpCo when set.
  const active = await activeOpCoSlug(session.user)
  const scopedChanges = active ? changes.filter((c) => c.opco.slug === active) : changes

  const serializable = scopedChanges.map((c) => ({
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
