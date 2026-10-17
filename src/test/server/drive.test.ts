import { describe, it, expect, vi } from "vitest"
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

describe("Drive client", () => {
  it("is built once, not on every call", async () => {
    vi.resetModules()
    const files = { get: vi.fn(async () => ({ data: new ArrayBuffer(0) })) }
    const driveFactory = vi.fn(() => ({ files }))
    vi.doMock("@googleapis/drive", () => ({ drive: driveFactory }))
    vi.doMock("google-auth-library", () => ({ GoogleAuth: vi.fn() }))
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "{}")
    const { getDownloadBuffer } = await import("@/server/drive")
    await getDownloadBuffer("a")
    await getDownloadBuffer("b")
    expect(files.get).toHaveBeenCalledTimes(2)
    expect(driveFactory).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
})
