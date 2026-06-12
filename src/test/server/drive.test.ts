import { describe, it, expect } from "vitest"
import { changeFolderName, sanitizeSegment } from "@/server/drive"

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
