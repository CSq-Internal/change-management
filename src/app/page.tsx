import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { runDueEscalations } from "@/server/sla"
import { buildDashboardData, durLabel, type DashboardChange } from "@/lib/dashboard-metrics"
import DashboardClient from "./dashboard-client"
import type { FeedEvent } from "@/components/dashboard/monitor-view"

const initials = (name: string | null, email: string) => {
  const src = (name ?? email.split("@")[0] ?? "").trim()
  const parts = src.split(/[ .]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}
const FEED_TONE: Record<string, string> = {
  submit: "bg-amber-500", approve: "bg-emerald-500", reject: "bg-rose-500",
  implement: "bg-blue-500", verify: "bg-violet-500", breach: "bg-rose-500",
}
// A blackout ending within this window is flagged amber (vs. red) in the UI.
const BLACKOUT_ENDING_SOON_MS = 12 * 3600_000

export default async function Home() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const now = Date.now()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  // Fire-and-forget SLA escalation sweep — never block render.
  void runDueEscalations({ opcoSlugs: groupLevel ? undefined : opcoSlugs }).catch(() => {})

  const [rows, blackoutRows, auditRows] = await Promise.all([
    db.changeRequest.findMany({
      where: opcoFilter,
      select: {
        id: true, title: true, status: true, riskLevel: true, isEmergency: true,
        slaDeadline: true, plannedStart: true, infrastructureType: true, createdAt: true, expedited: true, retroApprovalDueAt: true, retroApprovedAt: true,
        opco: { select: { name: true, slug: true } },
        requester: { select: { name: true, email: true } },
      },
    }),
    db.blackoutPeriod.findMany({
      where: { startsAt: { lte: new Date(now) }, endsAt: { gte: new Date(now) }, ...(groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] }) },
      select: { id: true, label: true, endsAt: true, opco: { select: { name: true } } },
    }),
    db.auditLog.findMany({
      where: { change: opcoFilter },
      orderBy: { at: "desc" },
      take: 8,
      select: { id: true, action: true, at: true, change: { select: { id: true } }, actor: { select: { name: true, email: true } } },
    }),
  ])

  const changes: DashboardChange[] = rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, riskLevel: r.riskLevel, isEmergency: r.isEmergency,
    slaDeadline: r.slaDeadline?.toISOString() ?? null,
    plannedStart: r.plannedStart?.toISOString() ?? null,
    opcoName: r.opco.name, opcoSlug: r.opco.slug,
    infrastructureType: r.infrastructureType,
    createdAt: r.createdAt.toISOString(),
    ownerInitials: initials(r.requester.name, r.requester.email),
    expedited: r.expedited,
    retroApprovalDueAt: r.retroApprovalDueAt?.toISOString() ?? null,
    retroApprovedAt: r.retroApprovedAt?.toISOString() ?? null,
  }))

  const data = buildDashboardData(changes, now)

  const blackouts = blackoutRows.map((b) => ({
    id: b.id, label: b.label, scope: b.opco?.name ?? "Group",
    endsIn: durLabel(b.endsAt.getTime() - now), amber: b.endsAt.getTime() - now < BLACKOUT_ENDING_SOON_MS,
  }))

  const feed: FeedEvent[] = auditRows.map((a) => ({
    id: a.id, changeId: a.change.id,
    label: a.action,
    actor: a.actor.name ?? a.actor.email.split("@")[0],
    ago: `${durLabel(now - a.at.getTime())} ago`,
    tone: FEED_TONE[a.action] ?? "bg-slate-400",
  }))

  return <DashboardClient data={data} blackouts={blackouts} feed={feed} blackoutCount={blackouts.length} />
}
