import { describe, it, expect } from "vitest"
import { isGroupLevelInfra, routedCabOpcoId, INFRA_TYPES, infraTypeOptions } from "@/lib/approver-routing"

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

describe("infraTypeOptions", () => {
  it("offers every infra type, Equiano included, even when no change uses it", () => {
    expect(infraTypeOptions(["Power"])).toEqual([...INFRA_TYPES])
  })
  it("keeps an older stored value that is no longer on the list", () => {
    expect(infraTypeOptions(["Legacy DWDM"]).at(-1)).toBe("Legacy DWDM")
  })
})
