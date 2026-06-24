import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { viewerTier, hasAnyAccess } from "@/lib/permissions"
import { requestScope } from "@/server/request-scope"
import RequestsTableClient, { type RequestRow } from "./requests-table-client"

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/request-access")
  const db = getPrisma()

  const tier = viewerTier(session.user.organizations, session.user.realmRoles)
  const where = requestScope(session.user)

  const changes = await db.changeRequest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, status: true, riskLevel: true, infrastructureType: true,
      opco: { select: { name: true } },
      requester: { select: { name: true, email: true } },
      approvals: { select: { decision: true } },
    },
  })

  const rows: RequestRow[] = changes.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    riskLevel: c.riskLevel,
    infrastructureType: c.infrastructureType,
    opcoName: c.opco?.name ?? "—",
    approvalsGiven: c.approvals.filter((a) => a.decision === "approve").length,
    requesterName: c.requester?.name ?? c.requester?.email ?? "—",
  }))

  const { status } = await searchParams
  // The /changes redirect passes a comma list; the table filters by a single value,
  // so use the first as the initial selection (sufficient for the retired-list case).
  const initialStatus = status?.split(",")[0] ?? ""

  return <RequestsTableClient rows={rows} showRequester={tier !== "member"} initialStatus={initialStatus} />
}
