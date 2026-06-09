export type ChangeStatusName =
  | "draft" | "pending" | "approved" | "rejected" | "implemented" | "verified" | "closed"
export type RiskLevelName = "low" | "medium" | "high" | "emergency"

/** Serializable input row (Dates as ISO strings). page.tsx maps Prisma rows to this. */
export interface DashboardChange {
  id: string
  title: string
  status: ChangeStatusName
  riskLevel: RiskLevelName
  isEmergency: boolean
  slaDeadline: string | null
  plannedStart: string | null
  opcoName: string
  opcoSlug: string
  ownerInitials: string
  expedited: boolean
  retroApprovalDueAt: string | null
  retroApprovedAt: string | null
}

export const STATUS_ORDER: ChangeStatusName[] =
  ["draft", "pending", "approved", "implemented", "verified", "closed"]
export const RISK_ORDER: RiskLevelName[] = ["low", "medium", "high", "emergency"]

const AT_RISK_WINDOW_MS = 4 * 3600_000

export function isOpen(status: ChangeStatusName): boolean {
  return status !== "closed" && status !== "rejected"
}

export type SlaState = "breached" | "atRisk" | "ok" | "none"

export function slaState(slaDeadline: string | null, nowMs: number): SlaState {
  if (!slaDeadline) return "none"
  const remaining = Date.parse(slaDeadline) - nowMs
  if (remaining < 0) return "breached"
  if (remaining < AT_RISK_WINDOW_MS) return "atRisk"
  return "ok"
}

/** Coarse "1h" / "25m" label for a duration in ms. */
export function durLabel(ms: number): string {
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600_000)
  const m = Math.round((abs - h * 3600_000) / 60_000)
  return h >= 1 ? `${h}h` : `${m}m`
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const pad = (n: number) => String(n).padStart(2, "0")
const startOfDayMs = (ms: number) => { const x = new Date(ms); x.setHours(0, 0, 0, 0); return x.getTime() }

/** "Tonight 21:00" / "Tomorrow 08:00" / "Wed 14:00", relative to nowMs. */
export function whenLabel(whenMs: number, nowMs: number): string {
  const d = new Date(whenMs)
  const dayDelta = Math.round((startOfDayMs(whenMs) - startOfDayMs(nowMs)) / 86_400_000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (dayDelta <= 0) return `${d.getHours() >= 18 ? "Tonight" : "Today"} ${hm}`
  if (dayDelta === 1) return `Tomorrow ${hm}`
  return `${DOW[d.getDay()]} ${hm}`
}

export type WorklistAction = "review" | "start" | "advance" | "verify"

export interface WorklistItem {
  id: string
  title: string
  opcoName: string
  risk: RiskLevelName
  ownerInitials: string
  why: string
  severity: "over" | "soon" | "go"
  action: WorklistAction
}
export interface StatusTile {
  status: ChangeStatusName
  count: number
  risk: Record<RiskLevelName, number>
}
export interface NamedCount { name: string; count: number }

export interface DashboardData {
  counts: {
    open: number; pending: number; breached: number; atRisk: number
    emergency: number; scheduledToday: number; readyToAdvance: number; overdueRetro: number
  }
  triage: { overdue: WorklistItem[]; awaiting: WorklistItem[]; advance: WorklistItem[] }
  monitor: { tiles: StatusTile[] }
  report: {
    statusCounts: Record<ChangeStatusName, number>
    riskOpen: Record<RiskLevelName, number>
    opcoOpen: NamedCount[]
  }
}

const ONE_DAY_MS = 24 * 3600_000

export function buildDashboardData(changes: DashboardChange[], nowMs: number): DashboardData {
  const open = changes.filter((c) => isOpen(c.status))
  const breachedOf = (c: DashboardChange) => slaState(c.slaDeadline, nowMs) === "breached"
  const bySla = (a: DashboardChange, b: DashboardChange) =>
    (a.slaDeadline ? Date.parse(a.slaDeadline) : Infinity) -
    (b.slaDeadline ? Date.parse(b.slaDeadline) : Infinity)
  // "start" if the planned window is today or already past — deliberately broader than
  // counts.scheduledToday (which is future-only, next 24h); they answer different questions.
  const scheduledTodayOrPast = (planned: string | null) =>
    planned != null && Math.round((startOfDayMs(Date.parse(planned)) - startOfDayMs(nowMs)) / 86_400_000) <= 0

  // most-overdue first = earliest deadline first (matches the mock's worklist order)
  const overdueChanges = open.filter((c) => c.status === "pending" && breachedOf(c)).sort(bySla)
  const awaitingChanges = open
    .filter((c) => c.status === "pending" && !breachedOf(c)).sort(bySla)
  const advanceChanges = open
    .filter((c) => c.status === "approved" || c.status === "implemented")
    .sort((a, b) =>
      (a.plannedStart ? Date.parse(a.plannedStart) : Infinity) -
      (b.plannedStart ? Date.parse(b.plannedStart) : Infinity))

  const base = (c: DashboardChange) => ({
    id: c.id, title: c.title, opcoName: c.opcoName, risk: c.riskLevel, ownerInitials: c.ownerInitials,
  })
  const overdue: WorklistItem[] = overdueChanges.map((c) => ({
    ...base(c), severity: "over", action: "review" as const,
    why: `SLA breached ${durLabel(Date.parse(c.slaDeadline!) - nowMs)} ago`,
  }))
  const awaiting: WorklistItem[] = awaitingChanges.map((c) => {
    // A pending change can have no SLA deadline (e.g. seeded without one); don't render "NaNm to SLA".
    if (!c.slaDeadline) {
      return { ...base(c), severity: "go" as const, action: "review" as const, why: "No SLA deadline" }
    }
    const remaining = Date.parse(c.slaDeadline) - nowMs
    return { ...base(c), severity: remaining < AT_RISK_WINDOW_MS ? "soon" : "go", action: "review" as const, why: `${durLabel(remaining)} to SLA` }
  })
  const advance: WorklistItem[] = advanceChanges.map((c) => {
    const action: WorklistAction =
      c.status === "implemented" ? "verify"
        : scheduledTodayOrPast(c.plannedStart) ? "start"
          : "advance"
    return {
      ...base(c), severity: "go", action,
      why: c.status === "approved"
        ? (c.plannedStart ? `Approved · ${whenLabel(Date.parse(c.plannedStart), nowMs)}` : "Approved · ready to implement")
        : "Implemented · ready to verify",
    }
  })

  const zeroStatus = () =>
    ({ draft: 0, pending: 0, approved: 0, rejected: 0, implemented: 0, verified: 0, closed: 0 }) as Record<ChangeStatusName, number>
  const statusCounts = zeroStatus()
  for (const c of changes) statusCounts[c.status]++

  const zeroRisk = () => ({ low: 0, medium: 0, high: 0, emergency: 0 }) as Record<RiskLevelName, number>
  const riskOpen = zeroRisk()
  for (const c of open) riskOpen[c.riskLevel]++

  const opcoMap = new Map<string, number>()
  for (const c of open) opcoMap.set(c.opcoName, (opcoMap.get(c.opcoName) ?? 0) + 1)
  const opcoOpen: NamedCount[] = [...opcoMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const tiles: StatusTile[] = STATUS_ORDER.map((status) => {
    const rows = changes.filter((c) => c.status === status)
    const risk = zeroRisk()
    for (const c of rows) risk[c.riskLevel]++
    return { status, count: rows.length, risk }
  })

  const scheduledToday = open.filter(
    (c) => c.plannedStart && Date.parse(c.plannedStart) >= nowMs && Date.parse(c.plannedStart) - nowMs < ONE_DAY_MS,
  ).length

  const overdueRetro = changes.filter(
    (c) => c.expedited && c.status === "implemented" && c.retroApprovedAt == null &&
      c.retroApprovalDueAt != null && Date.parse(c.retroApprovalDueAt) < nowMs,
  ).length

  return {
    counts: {
      open: open.length,
      pending: changes.filter((c) => c.status === "pending").length,
      breached: open.filter(breachedOf).length,
      atRisk: open.filter((c) => slaState(c.slaDeadline, nowMs) === "atRisk").length,
      emergency: open.filter((c) => c.isEmergency).length,
      scheduledToday,
      readyToAdvance: advanceChanges.length,
      overdueRetro,
    },
    triage: { overdue, awaiting, advance },
    monitor: { tiles },
    report: { statusCounts, riskOpen, opcoOpen },
  }
}
