import { test, expect } from "vitest"
import { isOpen, slaState, durLabel, type DashboardChange } from "./dashboard-metrics"

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
