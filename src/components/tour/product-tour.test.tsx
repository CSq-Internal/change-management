import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"

// vi.mock is hoisted above top-level consts, so the factory's dependencies
// must be created inside vi.hoisted to be initialized before the mock runs.
const { drive, driverFactory } = vi.hoisted(() => {
  const drive = vi.fn()
  const destroy = vi.fn()
  const driverFactory = vi.fn(() => ({ drive, destroy }))
  return { drive, driverFactory }
})

vi.mock("driver.js", () => ({ driver: driverFactory }))
vi.mock("driver.js/dist/driver.css", () => ({}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizations: [], realmRoles: [] } } }),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import ProductTour from "@/components/tour/product-tour"

beforeEach(() => {
  localStorage.clear()
  drive.mockClear()
  driverFactory.mockClear()
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())

describe("ProductTour", () => {
  it("auto-starts once on desktop when unseen, and sets the seen flag", () => {
    render(<ProductTour />)
    expect(drive).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("csq-tour-seen")).toBe("1")
  })

  it("does not auto-start when csq-tour-seen is already set", () => {
    localStorage.setItem("csq-tour-seen", "1")
    render(<ProductTour />)
    expect(drive).not.toHaveBeenCalled()
  })

  it("starts when a csq:start-tour event fires (replay)", () => {
    localStorage.setItem("csq-tour-seen", "1")
    render(<ProductTour />)
    expect(drive).not.toHaveBeenCalled()
    window.dispatchEvent(new Event("csq:start-tour"))
    expect(drive).toHaveBeenCalledTimes(1)
  })
})
