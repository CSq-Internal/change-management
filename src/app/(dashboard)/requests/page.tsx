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

  return (
    <RequestForm
      opcoOptions={opcoOptions}
      myRequests={mine.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() }))}
    />
  )
}
