import { describe, it, expect } from "vitest"
import { buildTourSteps } from "@/lib/tour/steps"

const base = { language: "en" as const, isAdmin: false, isGroupAdmin: false }

describe("buildTourSteps", () => {
  it("returns the 8 universal steps for a plain user, welcome first and help last", () => {
    const steps = buildTourSteps(base)
    expect(steps).toHaveLength(8)
    expect(steps[0].element).toBeUndefined() // welcome is a centered popover
    expect(steps[1].element).toBe('[data-tour="nav-dashboard"]')
    expect(steps.at(-1)!.element).toBe('[data-tour="tour-help"]')
  })

  it("includes the three admin steps when isAdmin", () => {
    const elements = buildTourSteps({ ...base, isAdmin: true }).map((s) => s.element)
    expect(elements).toContain('[data-tour="nav-users"]')
    expect(elements).toContain('[data-tour="nav-cab"]')
    expect(elements).toContain('[data-tour="nav-approval-matrix"]')
  })

  it("includes the opcos step only when isGroupAdmin", () => {
    expect(buildTourSteps(base).map((s) => s.element)).not.toContain('[data-tour="nav-opcos"]')
    expect(buildTourSteps({ ...base, isGroupAdmin: true }).map((s) => s.element)).toContain(
      '[data-tour="nav-opcos"]',
    )
  })

  it("resolves every popover string through t() in both languages (no raw keys leak)", () => {
    for (const language of ["en", "fr"] as const) {
      for (const s of buildTourSteps({ language, isAdmin: true, isGroupAdmin: true })) {
        expect(s.popover!.title).not.toMatch(/^tour\./)
        expect(s.popover!.description).not.toMatch(/^tour\./)
      }
    }
  })
})
