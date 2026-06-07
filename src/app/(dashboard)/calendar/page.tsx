import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, isGroupLevel, hasRoleInOpCo } from "@/lib/permissions"
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
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const meUser = await db.user.findUnique({ where: { keycloakId: me.keycloakId }, select: { id: true } })

  const [changeRows, blackoutRows] = await Promise.all([
    db.changeRequest.findMany({
      where: { ...opcoFilter, plannedStart: { lt: end }, plannedEnd: { gte: start } },
      select: {
        id: true, title: true, opcoId: true, infrastructureType: true, riskLevel: true,
        isEmergency: true, status: true, plannedStart: true, plannedEnd: true, requesterId: true,
        opco: { select: { slug: true, name: true } },
      },
    }),
    db.blackoutPeriod.findMany({
      where: {
        startsAt: { lt: end }, endsAt: { gte: start },
        ...(groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] }),
      },
      select: { id: true, label: true, opcoId: true, startsAt: true, endsAt: true },
    }),
  ])

  const calChanges: CalChange[] = changeRows.map((c) => ({
    id: c.id, opcoId: c.opcoId, infrastructureType: c.infrastructureType,
    riskLevel: c.riskLevel as RiskLevel, isEmergency: c.isEmergency,
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
      timeLabel: c.plannedStart!.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      day: dayKey(c.plannedStart!),
      overlap: cf.overlap, blackout: cf.blackout, severity: cf.severity,
      blackoutLabels: cf.blackoutLabels, canReschedule: canReschedule(c),
    }
  })

  const firstWeekday = (start.getDay() + 6) % 7
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const cells: CalDay[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `pad-${i}`, inMonth: false, dayNum: null, isToday: false })
  const today = new Date()
  const todayKey = dayKey(today)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(start.getFullYear(), start.getMonth(), d)
    cells.push({ key: dayKey(date), inMonth: true, dayNum: d, isToday: dayKey(date) === todayKey })
  }
  while (cells.length % 7 !== 0) cells.push({ key: `pad-end-${cells.length}`, inMonth: false, dayNum: null, isToday: false })

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
    />
  )
}
