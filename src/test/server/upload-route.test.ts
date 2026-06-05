// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/server/documents", () => ({
  attachDocument: vi.fn().mockResolvedValue({ id: "att-1", kind: "impact_scope", filename: "impact.pdf" }),
}))

import { POST } from "@/app/api/changes/[id]/documents/route"
import { attachDocument } from "@/server/documents"

function makeRequest(form: FormData) {
  return new Request("http://localhost/api/changes/cr-1/documents", { method: "POST", body: form })
}

beforeEach(() => vi.clearAllMocks())

describe("POST /api/changes/[id]/documents", () => {
  it("attaches the uploaded file and returns the attachment", async () => {
    const form = new FormData()
    form.set("kind", "impact_scope")
    form.set("file", new File([new Uint8Array([1, 2, 3])], "impact.pdf", { type: "application/pdf" }))
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "att-1" })
    expect(attachDocument).toHaveBeenCalledWith(
      expect.objectContaining({ changeId: "cr-1", kind: "impact_scope", filename: "impact.pdf" })
    )
  })

  it("returns 400 when the file is missing", async () => {
    const form = new FormData()
    form.set("kind", "impact_scope")
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(400)
  })

  it("returns 403 when attachDocument throws Forbidden", async () => {
    vi.mocked(attachDocument).mockRejectedValueOnce(new Error("Forbidden: nope"))
    const form = new FormData()
    form.set("kind", "impact_scope")
    form.set("file", new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }))
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(403)
  })
})
