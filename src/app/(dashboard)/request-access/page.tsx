import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { hasAnyAccess } from "@/lib/permissions"
import RequestAccessClient, { type MyRequest } from "./request-access-client"

export default async function RequestAccessPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Users who already have access don't belong here.
  if (hasAnyAccess(session.user.organizations, session.user.realmRoles)) redirect("/")

  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.user.keycloakId },
    select: { id: true },
  })

  const opcos = await db.opCo.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true, slug: true },
  })

  const rows = me
    ? await db.accessRequest.findMany({
        where: { userId: me.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, decisionReason: true, createdAt: true, opco: { select: { name: true } } },
      })
    : []

  const requests: MyRequest[] = rows.map((r) => ({
    id: r.id,
    opcoName: r.opco.name,
    status: r.status,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  }))

  return <RequestAccessClient opcos={opcos} requests={requests} />
}
