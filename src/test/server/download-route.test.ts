// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/server/documents", () => ({
  getDocumentForDownload: vi.fn().mockResolvedValue({
    buffer: Buffer.from("PDFDATA"), filename: "impact.pdf", mimeType: "application/pdf",
  }),
}))

import { GET } from "@/app/api/changes/[id]/documents/[attachmentId]/route"
import { getDocumentForDownload } from "@/server/documents"

const ctx = { params: Promise.resolve({ id: "cr-1", attachmentId: "att-1" }) }
beforeEach(() => vi.clearAllMocks())

describe("GET /api/changes/[id]/documents/[attachmentId]", () => {
  it("streams the file with content-disposition", async () => {
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(res.headers.get("content-disposition")).toContain("impact.pdf")
    expect(await res.text()).toBe("PDFDATA")
  })

  it("returns 403 on Forbidden", async () => {
    vi.mocked(getDocumentForDownload).mockRejectedValueOnce(new Error("Forbidden: not a member"))
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(403)
  })

  it("returns 404 when not found", async () => {
    vi.mocked(getDocumentForDownload).mockRejectedValueOnce(new Error("Attachment not found"))
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(404)
  })
})
