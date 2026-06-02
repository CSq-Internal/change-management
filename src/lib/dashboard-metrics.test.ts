import { test, expect } from "vitest"
import { isOpen, slaState, durLabel, STATUS_ORDER, type DashboardChange } from "./dashboard-metrics"
import { whenLabel } from "./dashboard-metrics"

const now = Date.parse("2026-06-02T09:00:00Z")
const iso = (hoursFromNow: number) => new Date(now + hoursFromNow * 3600_000).toISOString()

test("isOpen excludes closed and rejected", () => {
  expect(isOpen("pending")).toBe(true)
  expect(isOpen("verified")).toBe(true)
  expect(isOpen("closed")).toBe(false)
  expect(isOpen("rejected")).toBe(false)
})

test("slaState classifies by deadline vs now", () => {
  expect(slaState(iso(-2), now)).toBe("breached")
  expect(slaState(iso(1), now)).toBe("atRisk")   // within 4h
  expect(slaState(iso(10), now)).toBe("ok")
  expect(slaState(null, now)).toBe("none")
})

test("durLabel renders coarse h/m", () => {
  expect(durLabel(90 * 60_000)).toBe("1h")
  expect(durLabel(25 * 60_000)).toBe("25m")
})

export function fixture(): DashboardChange[] {
  const mk = (
    id: string, title: string, opcoName: string, opcoSlug: string,
    status: DashboardChange["status"], riskLevel: DashboardChange["riskLevel"],
    slaH: number | null, planH: number | null, ownerInitials: string, isEmergency = false,
  ): DashboardChange => ({
    id, title, opcoName, opcoSlug, status, riskLevel, isEmergency, ownerInitials,
    slaDeadline: slaH === null ? null : iso(slaH),
    plannedStart: planH === null ? null : iso(planH),
  })
  return [
    mk("CHG-1042", "Backbone IP route table update", "Ghana", "ghana", "pending", "medium", 3.2, 50, "AM"),
    mk("CHG-1043", "BGP peering change — Accra IXP", "Ghana", "ghana", "pending", "high", 1.1, 26, "KO"),
    mk("CHG-1044", "DWDM card replacement — Kampala metro", "Uganda", "uganda", "approved", "high", 6, 14, "SN"),
    mk("CHG-1045", "Firewall ruleset update — Lomé PoP", "Togo", "togo", "implemented", "medium", null, -6, "DT"),
    mk("CHG-1046", "OLT firmware upgrade — Lubumbashi", "DRC", "drc", "draft", "low", null, null, "PM"),
    mk("CHG-1047", "Core router OS patch — Monrovia", "Liberia", "liberia", "pending", "high", -1.6, 30, "JG"),
    mk("CHG-1048", "Submarine cable maintenance — Mauritius landing", "Mauritius", "mauritius", "approved", "emergency", 0.4, 9, "RB", true),
    mk("CHG-1049", "VLAN re-segmentation — Kampala core", "Uganda", "uganda", "verified", "medium", null, -30, "SN"),
    mk("CHG-1050", "Power redundancy test — Accra DC", "Ghana", "ghana", "closed", "low", null, -72, "AM"),
    mk("CHG-1051", "MPLS LSP re-route — DRC backbone", "DRC", "drc", "rejected", "high", null, null, "JG"),
    mk("CHG-1052", "DNS resolver migration — group", "Group", "group", "pending", "medium", 13.5, 70, "LK"),
    mk("CHG-1053", "Edge cache node deploy — Lomé", "Togo", "togo", "approved", "low", 40, 74, "DT"),
    mk("CHG-1054", "BGP community policy update — Mauritius", "Mauritius", "mauritius", "implemented", "medium", null, -18, "RB"),
    mk("CHG-1055", "Spectrum re-grooming — Kampala–Entebbe", "Uganda", "uganda", "pending", "high", -0.3, 20, "SN"),
  ]
}

test("whenLabel buckets today/tomorrow/weekday", () => {
  const today9pm = Date.parse("2026-06-02T21:00:00Z")
  expect(whenLabel(today9pm, today9pm - 1)).toMatch(/^Tonight /)
  const tomorrow = Date.parse("2026-06-03T08:00:00Z")
  expect(whenLabel(tomorrow, today9pm)).toMatch(/^Tomorrow /)
})

import { buildDashboardData } from "./dashboard-metrics"

test("buildDashboardData matches the approved mock", () => {
  const d = buildDashboardData(fixture(), now)

  // status-bar / summary counts
  expect(d.counts.open).toBe(12)
  expect(d.counts.pending).toBe(5)
  expect(d.counts.breached).toBe(2)        // 1047, 1055
  expect(d.counts.atRisk).toBe(3)          // 1043, 1042, 1048
  expect(d.counts.emergency).toBe(1)       // 1048
  expect(d.counts.scheduledToday).toBe(3)  // 1048(9h), 1044(14h), 1055(20h)
  expect(d.counts.readyToAdvance).toBe(5)  // 3 approved + 2 implemented

  // triage worklist grouping
  expect(d.triage.overdue.map((w) => w.id)).toEqual(["CHG-1055", "CHG-1047"]) // soonest-breached first
  expect(d.triage.awaiting.map((w) => w.id)).toEqual(["CHG-1043", "CHG-1042", "CHG-1052"])
  expect(d.triage.advance).toHaveLength(5)
  expect(d.triage.overdue[0].severity).toBe("over")
  expect(d.triage.overdue[0].why).toMatch(/breached/)

  // distributions
  expect(d.report.statusCounts).toMatchObject({
    draft: 1, pending: 5, approved: 3, implemented: 2, verified: 1, rejected: 1, closed: 1,
  })
  expect(d.report.riskOpen).toMatchObject({ low: 2, medium: 5, high: 4, emergency: 1 })
  expect(d.report.opcoOpen[0]).toEqual({ name: "Uganda", count: 3 })

  // monitor tiles cover all 6 lifecycle statuses in order
  expect(d.monitor.tiles.map((t) => t.status)).toEqual(STATUS_ORDER)
  expect(d.monitor.tiles.find((t) => t.status === "pending")!.count).toBe(5)
})
