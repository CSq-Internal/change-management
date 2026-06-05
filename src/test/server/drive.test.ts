import { describe, it, expect } from "vitest"
import { changeFolderName, sanitizeSegment, SUBFOLDER_FOR_KIND } from "@/server/drive"

describe("sanitizeSegment", () => {
  it("strips characters Drive dislikes and trims", () => {
    expect(sanitizeSegment("Core/router: upgrade?")).toBe("Core-router- upgrade")
  })
  it("collapses to a non-empty fallback", () => {
    expect(sanitizeSegment("   ")).toBe("untitled")
  })
})

describe("changeFolderName", () => {
  it("formats reference zero-padded with the title", () => {
    expect(changeFolderName(42, "Core router upgrade")).toBe("CHG-0042 — Core router upgrade")
  })
})

describe("SUBFOLDER_FOR_KIND", () => {
  it("maps every kind to an ordered subfolder name", () => {
    expect(SUBFOLDER_FOR_KIND.impact_scope).toBe("01_Impact-and-Scope")
    expect(SUBFOLDER_FOR_KIND.implementation_plan).toBe("02_Implementation-Plan")
    expect(SUBFOLDER_FOR_KIND.testing_plan).toBe("03_Testing-and-Validation")
    expect(SUBFOLDER_FOR_KIND.backout_plan).toBe("04_Backout-Plan")
    expect(SUBFOLDER_FOR_KIND.solution_document).toBe("05_Solution-Document")
  })
})
