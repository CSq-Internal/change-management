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
