import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-1", email: "test@csquared.com", name: "Test",
    organizations: [{ id: "org-1", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", keycloakId: "kc-1" }) },
  changeRequest: {
    findUnique: vi.fn().mockResolvedValue({
      id: "cr-1", status: "draft", opcoId: "opco-1", requesterId: "user-1",
      reference: 42, title: "Router update", driveFolderId: null, createdAt: new Date("2026-06-05"),
      opco: { slug: "ghana", name: "Ghana" },
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  attachment: {
    upsert: vi.fn().mockResolvedValue({ id: "att-1", kind: "impact_scope", filename: "impact.pdf" }),
    findUnique: vi.fn().mockResolvedValue({
      id: "att-1", changeId: "cr-1", kind: "impact_scope",
      filename: "impact.pdf", mimeType: "application/pdf", storageKey: "drive-file-1",
    }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

vi.mock("@/server/drive", () => ({
  ensureChangeFolder: vi.fn().mockResolvedValue("folder-1"),
  uploadDocument: vi.fn().mockResolvedValue("drive-file-1"),
  getDownloadBuffer: vi.fn().mockResolvedValue(Buffer.from("PDF")),
  scanFile: vi.fn().mockResolvedValue(undefined),
}))

import { attachDocument, getDocumentForDownload } from "@/server/documents"
import { getAppSession } from "@/lib/session"

const pdf = { filename: "impact.pdf", mimeType: "application/pdf", buffer: Buffer.from("PDF") }
const ugandaSession = {
  keycloakId: "kc-ug", email: "ug@csquared.com", name: "UG",
  organizations: [{ id: "org-ug", name: "Uganda", alias: "uganda", roles: ["requester"] }],
  realmRoles: [] as string[],
}

beforeEach(() => vi.clearAllMocks())

describe("attachDocument", () => {
  it("uploads, upserts the attachment, and writes an audit row", async () => {
    const result = await attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    expect(result).toHaveProperty("id", "att-1")
    expect(mockDb.attachment.upsert).toHaveBeenCalled()
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "document_uploaded" }) })
    )
  })

  it("rejects a disallowed mime type", async () => {
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", filename: "x.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("x") })
    ).rejects.toThrow(/file type/i)
  })

  it("rejects a file over the size limit", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024)
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", filename: "big.pdf", mimeType: "application/pdf", buffer: big })
    ).rejects.toThrow(/size/i)
  })

  it("forbids a non-requester non-admin from uploading", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-ug", keycloakId: "kc-ug" })
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    ).rejects.toThrow(/Forbidden/)
  })

  it("forbids uploading to a non-draft change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: "cr-1", status: "pending", opcoId: "opco-1", requesterId: "user-1",
      reference: 42, title: "Router update", driveFolderId: "folder-1", createdAt: new Date(),
      opco: { slug: "ghana", name: "Ghana" },
    })
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    ).rejects.toThrow(/draft/i)
  })
})

describe("getDocumentForDownload", () => {
  it("returns the file buffer + metadata for an OpCo member and audit-logs", async () => {
    const result = await getDocumentForDownload({ changeId: "cr-1", attachmentId: "att-1" })
    expect(result.filename).toBe("impact.pdf")
    expect(result.buffer.toString()).toBe("PDF")
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "document_downloaded" }) })
    )
  })

  it("forbids a non-member of the OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    await expect(
      getDocumentForDownload({ changeId: "cr-1", attachmentId: "att-1" })
    ).rejects.toThrow(/Forbidden|not found/i)
  })
})
