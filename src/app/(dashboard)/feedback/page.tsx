import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import FeedbackClient from "./feedback-client"
import type { FeedbackRow } from "./types"

// group_admin only, checked here before the query runs: the rows carry every OpCo's
// comments and author names, so hiding the nav item is not enough.
export default async function FeedbackPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isGroupAdmin(session.user.realmRoles)) redirect("/")

  const db = getPrisma()
  const rows = await db.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  })

  const serializable: FeedbackRow[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    body: r.body,
    route: r.route,
    changeId: r.changeId,
    roles: r.roles,
    opcoSlugs: r.opcoSlugs,
    authorName: r.user.name ?? r.user.email,
    createdAt: r.createdAt.toISOString(),
    triagedAt: r.triagedAt?.toISOString() ?? null,
    outcome: r.outcome,
    triageNote: r.triageNote,
  }))

  return <FeedbackClient rows={serializable} />
}
