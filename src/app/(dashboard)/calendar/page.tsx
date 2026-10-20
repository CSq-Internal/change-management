import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, isGroupLevel, hasRoleInOpCo, canManageUsers } from "@/lib/permissions"
import { activeOpCoSlug, withActiveOpCo } from "@/server/active-opco"
import { computeConflicts, type CalChange, type CalBlackout, type RiskLevel } from "@/lib/calendar"
import CalendarClient, { type CalDay, type CalChipData } from "./calendar-client"

function monthBounds(monthParam: string | undefined): { start: Date; end: Date; label: string } {
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth()
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yy, mm] = monthParam.split("-").map(Number)
    y = yy; m = mm - 1
  }
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 1)
  const label = start.toLocaleString(undefined, { month: "long", year: "numeric" })
  return { start, end, label }
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const { month } = await searchParams
  const { start, end, label } = monthBounds(month)

  const db = getPrisma()
  const me = session.user
  const groupLevel = isGroupLevel(me.realmRoles)
  const opcoSlugs = me.organizations.map((o) => o.alias)
  // Header OpCo switcher: narrow the calendar to the active OpCo when set.
  const active = await activeOpCoSlug(me)
  const changeScope = withActiveOpCo(groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }, active)
  const blackoutScope = active
    ? { OR: [{ opcoId: null }, { opco: { slug: active } }] }
    : groupLevel
      ? {}
      : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] }

  // The month runs midnight to midnight in the viewer's zone, which the server doesn't know;
  // a day of margin each side covers every zone, and the browser drops what falls outside.
  const DAY = 24 * 60 * 60 * 1000
  const qStart = new Date(start.getTime() - DAY)
  const qEnd = new Date(end.getTime() + DAY)

  const meUser = await db.user.findUnique({ where: { keycloakId: me.keycloakId }, select: { id: true } })

  const [changeRows, blackoutRows, opcos] = await Promise.all([
    db.changeRequest.findMany({
      where: { AND: [changeScope, { plannedStart: { lt: qEnd }, plannedEnd: { gte: qStart } }] },
      select: {
        id: true, title: true, opcoId: true, infrastructureType: true, riskLevel: true,
        isEmergency: true, status: true, plannedStart: true, plannedEnd: true, requesterId: true,
        opco: { select: { slug: true, name: true } },
      },
    }),
    // This month's blackouts shade the grid; upcoming ones stay listed whatever month is
    // shown, or a freeze set for a later month vanishes from view once saved.
    db.blackoutPeriod.findMany({
      where: {
        AND: [blackoutScope, { OR: [{ startsAt: { lt: qEnd }, endsAt: { gte: qStart } }, { endsAt: { gte: new Date() } }] }],
      },
      select: { id: true, label: true, opcoId: true, startsAt: true, endsAt: true },
    }),
    db.opCo.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } }),
  ])

  // Blackout management is gated like the createBlackoutPeriod action: group admins can
  // manage any scope (including the group-wide null scope); OpCo user-managers can manage
  // their own OpCos. Build the scope options the current user is allowed to set.
  const groupAdmin = isGroupAdmin(me.realmRoles)
  const manageableOpcos = opcos.filter((o) => groupAdmin || canManageUsers(me.organizations, me.realmRoles, o.slug))
  const canManageBlackouts = groupAdmin || manageableOpcos.length > 0
  const blackoutScopes = [
    ...(groupAdmin ? [{ value: "", label: "Group (all OpCos)" }] : []),
    ...manageableOpcos.map((o) => ({ value: o.slug, label: o.name })),
  ]
  const opcoNameById = new Map(opcos.map((o) => [o.id, o.name]))
  const opcoSlugById = new Map(opcos.map((o) => [o.id, o.slug]))
  const blackouts = blackoutRows
    .map((b) => ({
      id: b.id,
      label: b.label,
      scopeName: b.opcoId ? (opcoNameById.get(b.opcoId) ?? "OpCo") : "Group",
      opcoSlug: b.opcoId ? (opcoSlugById.get(b.opcoId) ?? null) : null,
      startMs: b.startsAt.getTime(),
      endMs: b.endsAt.getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs)

  const calChanges: CalChange[] = changeRows.map((c) => ({
    id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType,
    riskLevel: c.riskLevel as RiskLevel, isEmergency: c.isEmergency, status: c.status,
    start: c.plannedStart!.getTime(), end: c.plannedEnd!.getTime(),
  }))
  const calBlackouts: CalBlackout[] = blackoutRows.map((b) => ({
    id: b.id, opcoId: b.opcoId, label: b.label, start: b.startsAt.getTime(), end: b.endsAt.getTime(),
  }))
  const conflicts = computeConflicts(calChanges, calBlackouts)

  const canReschedule = (c: (typeof changeRows)[number]) =>
    ["draft", "pending", "approved"].includes(c.status) &&
    (c.requesterId === meUser?.id ||
      isGroupAdmin(me.realmRoles) ||
      hasRoleInOpCo(me.organizations, c.opco.slug, "admin"))

  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const chips: CalChipData[] = changeRows.map((c) => {
    const cf = conflicts.get(c.id)!
    return {
      id: c.id, title: c.title, opcoName: c.opco.name, riskLevel: c.riskLevel, status: c.status,
      startMs: c.plannedStart!.getTime(), endMs: c.plannedEnd!.getTime(),
      overlap: cf.overlap, blackout: cf.blackout, severity: cf.severity,
      blackoutLabels: cf.blackoutLabels, canReschedule: canReschedule(c),
    }
  })

  const firstWeekday = (start.getDay() + 6) % 7
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const cells: CalDay[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `pad-${i}`, inMonth: false, dayNum: null })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: dayKey(new Date(start.getFullYear(), start.getMonth(), d)), inMonth: true, dayNum: d })
  }
  while (cells.length % 7 !== 0) cells.push({ key: `pad-end-${cells.length}`, inMonth: false, dayNum: null })

  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1)
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const fmtMonthParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`

  return (
    <CalendarClient
      monthLabel={label}
      prevMonth={fmtMonthParam(prev)}
      nextMonth={fmtMonthParam(next)}
      cells={cells}
      chips={chips}
      canManageBlackouts={canManageBlackouts}
      blackoutScopes={blackoutScopes}
      blackouts={blackouts}
    />
  )
}
