import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { viewerTier } from "@/lib/permissions"
import { requestScope, openOrRecent } from "@/server/request-scope"
import { activeOpCoSlug, withActiveOpCo } from "@/server/active-opco"
import { votesSince } from "@/lib/approval-cycle"
import RequestsTableClient, { type RequestRow } from "./requests-table-client"

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; all?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const tier = viewerTier(session.user.organizations, session.user.realmRoles)
  const { status, all } = await searchParams
  const scoped = withActiveOpCo(requestScope(session.user), await activeOpCoSlug(session.user))
  // Finished changes older than 90 days load only on request (?all=1).
  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const where = all ? scoped : { AND: [scoped, openOrRecent(Date.now())] }

  const changes = await db.changeRequest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, status: true, riskLevel: true, infrastructureType: true,
      opco: { select: { name: true } },
      requester: { select: { name: true, email: true } },
      approvals: { select: { decision: true, approverId: true, decidedAt: true } },
      auditTrail: { where: { action: "submitted" }, orderBy: { at: "desc" }, take: 1, select: { at: true } },
    },
  })

  const rows: RequestRow[] = changes.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    riskLevel: c.riskLevel,
    infrastructureType: c.infrastructureType,
    opcoName: c.opco?.name ?? "—",
    // This round only: approvals from before a resubmission were for an earlier plan.
    approvalsGiven: votesSince(c.approvals, c.auditTrail[0]?.at ?? null).filter((a) => a.decision === "approve").length,
    requesterName: c.requester?.name ?? c.requester?.email ?? "—",
  }))

  // The /changes redirect passes a comma list; the table filters by a single value,
  // so use the first as the initial selection (sufficient for the retired-list case).
  const initialStatus = status?.split(",")[0] ?? ""

  return <RequestsTableClient rows={rows} showRequester={tier !== "member"} initialStatus={initialStatus} olderHidden={!all} />
}
