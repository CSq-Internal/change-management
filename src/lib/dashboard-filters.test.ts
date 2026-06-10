import { describe, it, expect } from "vitest"
import {
  EMPTY_FILTERS, applyFilters, isActive, filterToQuery, queryToFilter, type FilterState,
} from "@/lib/dashboard-filters"
import type { DashboardChange } from "@/lib/dashboard-metrics"

const base: Omit<DashboardChange, "id"> = {
  title: "x", status: "pending", riskLevel: "high", isEmergency: false,
  slaDeadline: "2026-06-10T12:00:00.000Z", plannedStart: "2026-06-15T08:00:00.000Z",
  opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Equiano Optics",
  createdAt: "2026-06-01T09:00:00.000Z", ownerInitials: "KO",
  expedited: false, retroApprovalDueAt: null, retroApprovedAt: null,
}
const mk = (id: string, over: Partial<DashboardChange>): DashboardChange => ({ ...base, id, ...over })

const rows: DashboardChange[] = [
  mk("a", { infrastructureType: "Equiano Optics", opcoSlug: "ghana", status: "pending", riskLevel: "high" }),
  mk("b", { infrastructureType: "Equiano IP", opcoSlug: "togo", status: "approved", riskLevel: "low" }),
  mk("c", { infrastructureType: "Power", opcoSlug: "ghana", status: "closed", riskLevel: "medium" }),
]

describe("applyFilters", () => {
  it("returns all rows when no filter is active", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(3)
  })
  it("ORs within the infra field (Equiano = both Optics and IP)", () => {
    const f = { ...EMPTY_FILTERS, infraTypes: ["Equiano Optics", "Equiano IP"] }
    expect(applyFilters(rows, f).map((r) => r.id)).toEqual(["a", "b"])
  })
  it("ANDs across fields (Equiano Optics AND ghana)", () => {
    const f = { ...EMPTY_FILTERS, infraTypes: ["Equiano Optics"], opcoSlugs: ["ghana"] }
    expect(applyFilters(rows, f).map((r) => r.id)).toEqual(["a"])
  })
  it("filters by status and risk", () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, statuses: ["approved"] }).map((r) => r.id)).toEqual(["b"])
    expect(applyFilters(rows, { ...EMPTY_FILTERS, risks: ["medium"] }).map((r) => r.id)).toEqual(["c"])
  })
  it("filters by the chosen date field within an inclusive range", () => {
    const f: FilterState = { ...EMPTY_FILTERS, dateField: "created", dateFrom: "2026-06-01", dateTo: "2026-06-01" }
    expect(applyFilters(rows, f)).toHaveLength(3)
    const planned: FilterState = { ...EMPTY_FILTERS, dateField: "planned", dateFrom: "2026-06-16", dateTo: "2026-06-20" }
    expect(applyFilters(rows, planned)).toHaveLength(0)
  })
  it("excludes rows whose chosen date field is null when a range is set", () => {
    const noSla = [mk("z", { slaDeadline: null })]
    const f: FilterState = { ...EMPTY_FILTERS, dateField: "sla", dateFrom: "2026-06-01", dateTo: "2026-06-30" }
    expect(applyFilters(noSla, f)).toHaveLength(0)
  })
})

describe("isActive", () => {
  it("is false for empty filters and true once any field is set", () => {
    expect(isActive(EMPTY_FILTERS)).toBe(false)
    expect(isActive({ ...EMPTY_FILTERS, risks: ["low"] })).toBe(true)
    expect(isActive({ ...EMPTY_FILTERS, dateFrom: "2026-06-01" })).toBe(true)
  })
})

describe("query round-trip", () => {
  it("serializes and parses back to an equivalent filter", () => {
    const f: FilterState = {
      infraTypes: ["Equiano Optics", "Equiano IP"], opcoSlugs: ["ghana"],
      statuses: ["pending"], risks: ["high"], dateField: "created",
      dateFrom: "2026-06-01", dateTo: "2026-06-07",
    }
    expect(queryToFilter(filterToQuery(f))).toEqual(f)
  })
  it("drops unknown enum values on parse", () => {
    const parsed = queryToFilter("status=bogus,pending&risk=nope")
    expect(parsed.statuses).toEqual(["pending"])
    expect(parsed.risks).toEqual([])
  })
})
