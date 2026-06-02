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

/** "Tonight 21:00" / "Tomorrow 08:00" / "Wed 14:00", relative to nowMs. */
export function whenLabel(whenMs: number, nowMs: number): string {
  const d = new Date(whenMs)
  const startOfDay = (ms: number) => { const x = new Date(ms); x.setHours(0, 0, 0, 0); return x.getTime() }
  const dayDelta = Math.round((startOfDay(whenMs) - startOfDay(nowMs)) / 86_400_000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (dayDelta <= 0) return `${d.getHours() >= 18 ? "Tonight" : "Today"} ${hm}`
  if (dayDelta === 1) return `Tomorrow ${hm}`
  return `${DOW[d.getDay()]} ${hm}`
}
