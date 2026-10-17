import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { activeOpCos } from "@/server/opco-scope"
import { isGroupLevelInfra, INFRA_TYPES } from "@/lib/approver-routing"
import { canManageAnyOpCo, hasRoleInOpCo, isGroupAdmin } from "@/lib/permissions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { listApproverAssignments } from "@/server/actions/approval-matrix"
import ApprovalMatrixClient from "./approval-matrix-client"

export default async function ApprovalMatrixPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  // Group CTO(s) sit on every OpCo CAB as secondee; exclude them from the per-OpCo
  // resident lists so they show by role (secondee), not by name, against each OpCo.
  const groupCtoIds = new Set(
    (await db.cABMembership.findMany({
      where: { opcoId: null, isActive: true },
      select: { userId: true },
    })).map((m) => m.userId)
  )

  const opcoCab = await db.cABMembership.findMany({
    where: { opcoId: { not: null }, isActive: true, userId: { notIn: [...groupCtoIds] } },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversBySlug: Record<string, string[]> = {}
  for (const m of opcoCab) {
    if (!m.opco) continue
    ;(approversBySlug[m.opco.slug] ??= []).push(m.user.name ?? m.user.email)
  }

  const canManage = canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
  const assignments = canManage ? await listApproverAssignments() : []
  const overrideRows = assignments.map((a) => ({
    id: a.id, infrastructureType: a.infrastructureType,
    opcoSlug: a.opco?.slug ?? null, opcoName: a.opco?.name ?? null,
    userLabel: a.user.name ?? a.user.email,
  }))
  // The override picker, and so the CAB list behind it, is only for those who can manage.
  const candidates = canManage
    ? (await db.cABMembership.findMany({
        where: { isActive: true },
        include: { user: { select: { id: true, name: true, email: true } } },
      })).map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))
    : []
  const candidateUsers = Array.from(new Map(candidates.map((c) => [c.id, c])).values())
  const opcos = await activeOpCos("all")
  // A group admin may set overrides for any OpCo (assertCanManage), not just ones they hold admin in.
  const scopes = isGroupAdmin(session.user.realmRoles)
    ? [{ slug: "", name: "Group" }, ...opcos]
    : opcos.filter((o) => hasRoleInOpCo(session.user.organizations, o.slug, "admin"))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Matrix</h1>
        <p className="text-sm text-muted-foreground">
          Who approves a change, by infrastructure type and OpCo. Approvers are notified automatically on submit.
        </p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Routing by infrastructure type</CardTitle>
          <CardDescription>Equiano infra is group-level (Group CTO); the rest route to the resident OpCo approver with the Group CTO as secondee.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {INFRA_TYPES.map((infra) => (
            <div key={infra} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/50 px-4 py-2 text-sm">
              <span className="font-medium">{infra}</span>
              <span className="text-muted-foreground">
                {isGroupLevelInfra(infra)
                  ? "Group CTO"
                  : "Resident OpCo approver + Group CTO (secondee)"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Approvers per OpCo</CardTitle>
          <CardDescription>Resident approvers for each operating company. The Group CTO is secondee on all non-Equiano changes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {opcos.map(({ slug, name }) => (
            <div key={slug} className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {approversBySlug[slug]?.length > 0 ? approversBySlug[slug].join(", ") : "No resident approver assigned"}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ApprovalMatrixClient canManage={canManage} infraTypes={INFRA_TYPES} scopes={scopes} candidates={candidateUsers} rows={overrideRows} />
    </div>
  )
}
