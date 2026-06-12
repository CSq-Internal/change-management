import type { ChangeStatusName, DashboardChange, RiskLevelName } from "./dashboard-metrics"

export type DateField = "planned" | "created" | "sla"

export interface FilterState {
  infraTypes: string[]
  opcoSlugs: string[]
  statuses: ChangeStatusName[]
  risks: RiskLevelName[]
  dateField: DateField
  dateFrom: string | null // "YYYY-MM-DD", inclusive
  dateTo: string | null // "YYYY-MM-DD", inclusive
}

export const ALL_STATUSES: ChangeStatusName[] =
  ["draft", "pending", "approved", "rejected", "implemented", "verified", "closed", "cancelled"]
export const ALL_RISKS: RiskLevelName[] = ["low", "medium", "high", "emergency"]
const DATE_FIELDS: DateField[] = ["planned", "created", "sla"]

export const EMPTY_FILTERS: FilterState = {
  infraTypes: [], opcoSlugs: [], statuses: [], risks: [],
  dateField: "planned", dateFrom: null, dateTo: null,
}

export function isActive(f: FilterState): boolean {
  return f.infraTypes.length > 0 || f.opcoSlugs.length > 0 || f.statuses.length > 0 ||
    f.risks.length > 0 || f.dateFrom != null || f.dateTo != null
}

function dateValue(c: DashboardChange, field: DateField): string | null {
  if (field === "planned") return c.plannedStart
  if (field === "created") return c.createdAt
  return c.slaDeadline
}

export function applyFilters(changes: DashboardChange[], f: FilterState): DashboardChange[] {
  const fromMs = f.dateFrom ? Date.parse(`${f.dateFrom}T00:00:00`) : null
  const toMs = f.dateTo ? Date.parse(`${f.dateTo}T23:59:59.999`) : null
  return changes.filter((c) => {
    if (f.infraTypes.length && !f.infraTypes.includes(c.infrastructureType)) return false
    if (f.opcoSlugs.length && !f.opcoSlugs.includes(c.opcoSlug)) return false
    if (f.statuses.length && !f.statuses.includes(c.status)) return false
    if (f.risks.length && !f.risks.includes(c.riskLevel)) return false
    if (fromMs != null || toMs != null) {
      const v = dateValue(c, f.dateField)
      if (v == null) return false
      const ms = Date.parse(v)
      if (fromMs != null && ms < fromMs) return false
      if (toMs != null && ms > toMs) return false
    }
    return true
  })
}

export function filterToQuery(f: FilterState): string {
  const p = new URLSearchParams()
  if (f.infraTypes.length) p.set("infra", f.infraTypes.join(","))
  if (f.opcoSlugs.length) p.set("opco", f.opcoSlugs.join(","))
  if (f.statuses.length) p.set("status", f.statuses.join(","))
  if (f.risks.length) p.set("risk", f.risks.join(","))
  if (f.dateFrom || f.dateTo) {
    p.set("df", f.dateField)
    if (f.dateFrom) p.set("from", f.dateFrom)
    if (f.dateTo) p.set("to", f.dateTo)
  }
  return p.toString()
}

export function queryToFilter(qs: string): FilterState {
  const p = new URLSearchParams(qs)
  const list = (k: string) => { const v = p.get(k); return v ? v.split(",").filter(Boolean) : [] }
  const df = p.get("df")
  return {
    infraTypes: list("infra"),
    opcoSlugs: list("opco"),
    statuses: list("status").filter((s): s is ChangeStatusName => (ALL_STATUSES as string[]).includes(s)),
    risks: list("risk").filter((r): r is RiskLevelName => (ALL_RISKS as string[]).includes(r)),
    dateField: DATE_FIELDS.includes(df as DateField) ? (df as DateField) : "planned",
    dateFrom: p.get("from"),
    dateTo: p.get("to"),
  }
}
