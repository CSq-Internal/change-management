import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listRisks } from "@/server/actions/risk-register"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import RiskRegisterClient, { type RiskRow } from "./risk-register-client"

export default async function RiskRegisterPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const risks = await listRisks()
  const rows: RiskRow[] = risks.map((r) => ({
    id: r.id, title: r.title, description: r.description, category: r.category,
    likelihood: r.likelihood, impact: r.impact, owner: r.owner,
    mitigationPlan: r.mitigationPlan ?? null, status: r.status,
    reviewDate: r.reviewDate ? r.reviewDate.toISOString() : null,
    opcoSlug: r.opco?.slug ?? null, opcoName: r.opco?.name ?? null,
  }))

  const manageableOpcos = session.user.organizations
    .filter((o) => o.roles.includes("admin"))
    .map((o) => ({ slug: o.alias, name: o.name }))

  return (
    <RiskRegisterClient
      rows={rows}
      canManage={canManageAnyOpCo(session.user.organizations, session.user.realmRoles)}
      canManageGroup={isGroupAdmin(session.user.realmRoles)}
      manageableOpcos={manageableOpcos}
    />
  )
}
