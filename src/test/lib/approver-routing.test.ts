import { describe, it, expect } from "vitest"
import { isGroupLevelInfra, routedCabOpcoId } from "@/lib/approver-routing"

describe("isGroupLevelInfra", () => {
  it("is true for Equiano infra only", () => {
    expect(isGroupLevelInfra("Equiano Optics")).toBe(true)
    expect(isGroupLevelInfra("Equiano IP")).toBe(true)
    expect(isGroupLevelInfra("Backbone IP Network")).toBe(false)
  })
})

describe("routedCabOpcoId", () => {
  it("routes Equiano to the group CAB (null)", () => {
    expect(routedCabOpcoId("Equiano Optics", "opco-1")).toBeNull()
  })
  it("routes other infra to the change's OpCo CAB", () => {
    expect(routedCabOpcoId("Wifi", "opco-1")).toBe("opco-1")
  })
})
