import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageAnyOpCo } from "@/lib/permissions"
import { listAccessRequests } from "@/server/actions/access-requests"
import AccessRequestsClient, { type QueueRow } from "./access-requests-client"

export default async function AccessRequestsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canManageAnyOpCo(session.user.organizations, session.user.realmRoles)) redirect("/")

  const requests = (await listAccessRequests()) as QueueRow[]
  return <AccessRequestsClient requests={requests} />
}
