import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import { requestScope } from "@/server/request-scope"
import { runDueEscalations } from "@/server/sla"
import { durLabel, type DashboardChange } from "@/lib/dashboard-metrics"
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
  // Members have no ops dashboard — send them to their requests.
  const tier = viewerTier(session.user.organizations, session.user.realmRoles)
  if (tier === "member") redirect("/requests")

  // eslint-disable-next-line react-hooks/purity -- async server component, not a hook; Date.now() is safe here
  const now = Date.now()
  const groupLevel = tier === "group"
  // Managed OpCos for an OpCo admin/approver (admin OR approver); group sees all.
  const opcoSlugs = groupLevel ? [] : requestScopedSlugs(session.user.organizations)
  const opcoFilter = requestScope(session.user)

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
      select: { id: true, action: true, at: true, change: { select: { id: true, title: true } }, actor: { select: { name: true, email: true } } },
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

  const infraOptions = [...new Set(changes.map((c) => c.infrastructureType))].sort()
  const opcoOptions = [...new Map(changes.map((c) => [c.opcoSlug, c.opcoName])).entries()]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const blackouts = blackoutRows.map((b) => ({
    id: b.id, label: b.label, scope: b.opco?.name ?? "Group",
    endsIn: durLabel(b.endsAt.getTime() - now), amber: b.endsAt.getTime() - now < BLACKOUT_ENDING_SOON_MS,
  }))

  const feed: FeedEvent[] = auditRows.map((a) => ({
    id: a.id, changeId: a.change.id, changeTitle: a.change.title,
    label: a.action,
    actor: a.actor.name ?? a.actor.email.split("@")[0],
    ago: `${durLabel(now - a.at.getTime())} ago`,
    tone: FEED_TONE[a.action] ?? "bg-slate-400",
  }))

  return (
    <DashboardClient
      changes={changes}
      now={now}
      infraOptions={infraOptions}
      opcoOptions={opcoOptions}
      blackouts={blackouts}
      feed={feed}
      blackoutCount={blackouts.length}
    />
  )
}
