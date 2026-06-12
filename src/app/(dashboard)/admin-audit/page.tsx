import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageAnyOpCo, isGroupLevel } from "@/lib/permissions"
import { listAdminAudit } from "@/server/actions/audit-log"
import AuditClient from "./audit-client"

export default async function AdminAuditPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const allowed =
    canManageAnyOpCo(session.user.organizations, session.user.realmRoles) ||
    isGroupLevel(session.user.realmRoles)
  if (!allowed) redirect("/")

  const rows = await listAdminAudit({})
  return <AuditClient initialRows={rows} />
}
