import { describe, it, expect } from "vitest"
import { changeIdFromPath } from "@/lib/feedback-context"

const CUID = "clxyz0123456789abcdefghij"

describe("changeIdFromPath", () => {
  it("returns the change id on a change detail page", () => {
    expect(changeIdFromPath(`/changes/${CUID}`)).toBe(CUID)
  })

  it("returns the change id on a nested change page", () => {
    expect(changeIdFromPath(`/changes/${CUID}/edit`)).toBe(CUID)
  })

  it("returns null when the segment is not a change id", () => {
    expect(changeIdFromPath("/changes/new")).toBeNull()
    expect(changeIdFromPath("/changes/CLXYZ0123456789ABCDEFGHIJ")).toBeNull()
  })

  it("returns null off the change pages", () => {
    expect(changeIdFromPath("/changes")).toBeNull()
    expect(changeIdFromPath(`/requests/${CUID}`)).toBeNull()
    expect(changeIdFromPath("/")).toBeNull()
  })
})
