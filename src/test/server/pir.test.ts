import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-impl", email: "impl@c.com", name: "Impl",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["approver"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: "user-impl", keycloakId: "kc-impl" }) },
  changeRequest: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  postImplementationReview: { create: vi.fn().mockResolvedValue({ id: "pir-1" }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))
vi.mock("@/server/notify", () => ({
  notifyEvent: vi.fn().mockResolvedValue(undefined),
  notifyChange: vi.fn().mockResolvedValue(undefined),
}))

import { submitPostImplementationReview } from "@/server/actions/pir"

const implemented = {
  id: "cr-1", status: "implemented", opco: { slug: "ghana" },
  riskLevel: "low", isEmergency: false, requesterId: "user-req",
  implementedById: "user-impl", expedited: false, retroApprovedAt: null, pir: null, approvals: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: "user-impl", keycloakId: "kc-impl" })
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb))
})

it("records a PIR and advances implemented → verified", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
  await submitPostImplementationReview("cr-1", { outcome: "success", summary: "All good", backoutUsed: false })
  expect(mockDb.postImplementationReview.create).toHaveBeenCalledTimes(1)
  expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: "verified" } })
  )
})

it("rejects a PIR when the change is not implemented", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, status: "approved" })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/implemented/i)
})

it("rejects a duplicate PIR", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, pir: { id: "pir-old" } })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/already has/i)
})

it("requires a non-empty summary", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "   ", backoutUsed: false })
  ).rejects.toThrow(/summary is required/i)
})

it("blocks an expedited emergency PIR until retrospectively approved", async () => {
  mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, expedited: true, retroApprovedAt: null })
  await expect(
    submitPostImplementationReview("cr-1", { outcome: "success", summary: "x", backoutUsed: false })
  ).rejects.toThrow(/retrospective approval/i)
})

describe("independent PIR (ISO 27001 A.5.3)", () => {
  const ok = { outcome: "success" as const, summary: "Done", backoutUsed: false }

  it("refuses the implementer reviewing their own high-risk change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, riskLevel: "high" })
    await expect(submitPostImplementationReview("cr-1", ok)).rejects.toThrow(/neither requested nor implemented/i)
    expect(mockDb.postImplementationReview.create).not.toHaveBeenCalled()
  })

  it("refuses the requester reviewing their own emergency change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      ...implemented, isEmergency: true, requesterId: "user-impl", implementedById: "user-other",
    })
    await expect(submitPostImplementationReview("cr-1", ok)).rejects.toThrow(/neither requested nor implemented/i)
  })

  it("refuses a self-recorded failure or backout on a low-risk change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
    await expect(submitPostImplementationReview("cr-1", { ...ok, outcome: "failed" })).rejects.toThrow(/neither requested/i)
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(implemented)
    await expect(submitPostImplementationReview("cr-1", { ...ok, backoutUsed: true })).rejects.toThrow(/neither requested/i)
  })

  it("lets an uninvolved approver review a high-risk change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({ ...implemented, riskLevel: "high", implementedById: "user-other" })
    await submitPostImplementationReview("cr-1", ok)
    expect(mockDb.postImplementationReview.create).toHaveBeenCalledTimes(1)
  })
})
