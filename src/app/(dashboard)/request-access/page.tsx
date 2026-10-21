import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { hasAnyAccess } from "@/lib/permissions"
import RequestAccessClient from "./request-access-client"

export default async function RequestAccessPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Users who already have access don't belong here. The client refreshes the session
  // cookie first; a server redirect would loop against the proxy's stale cookie.
  if (hasAnyAccess(session.user.organizations, session.user.realmRoles)) return <RequestAccessClient opcos={[]} hasAccess />

  const opcos = await getPrisma().opCo.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true, slug: true },
  })

  return <RequestAccessClient opcos={opcos} />
}
