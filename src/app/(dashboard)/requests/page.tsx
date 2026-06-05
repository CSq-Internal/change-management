import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { OPCO_SLUGS } from "@/lib/opco"
import RequestForm from "./request-form"

export default async function RequestsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const opcoOptions = isGroupLevel(session.user.realmRoles)
    ? [...OPCO_SLUGS]
    : session.user.organizations.map((o) => o.alias)

  const mine = await db.changeRequest.findMany({
    where: { requester: { keycloakId: session.user.keycloakId } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, title: true, status: true, updatedAt: true },
  })

  // Approver-routing data for the live preview: Group CTO(s) + resident approver(s) per selectable OpCo.
  const groupCtos = await db.user.findMany({
    where: { isGroupCto: true, isActive: true },
    select: { name: true, email: true },
  })
  const opcoRecords = await db.opCo.findMany({
    where: { slug: { in: opcoOptions } },
    select: { id: true, slug: true },
  })
  const assignments = await db.userOpCoAssignment.findMany({
    where: { opcoId: { in: opcoRecords.map((o) => o.id) }, role: "approver", isActive: true },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversByOpco: Record<string, { name: string | null; email: string }[]> = {}
  for (const o of opcoRecords) approversByOpco[o.slug] = []
  for (const a of assignments) approversByOpco[a.opco.slug]?.push({ name: a.user.name, email: a.user.email })

  return (
    <RequestForm
      opcoOptions={opcoOptions}
      myRequests={mine.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() }))}
      defaultEmail={session.user.email ?? ""}
      groupCtos={groupCtos}
      approversByOpco={approversByOpco}
    />
  )
}
