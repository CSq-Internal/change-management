import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ getAppSession: vi.fn() }))
vi.mock("@/server/audit", () => ({ recordAdminAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/keycloak", () => ({ assignToOrganization: vi.fn().mockResolvedValue(undefined) }))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  user: { findUnique: vi.fn() },
  opCo: { findUnique: vi.fn() },
  userOpCoAssignment: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  accessRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { requestAccess, listAccessRequests } from "@/server/actions/access-requests"
import { getAppSession } from "@/lib/session"
import { notifyUsers } from "@/server/notify"

const member = { keycloakId: "kc-bob", email: "bob@csquared.com", name: "Bob", organizations: [], realmRoles: [] }
const groupAdmin = { keycloakId: "kc-ga", email: "ga@csquared.com", name: "GA", organizations: [], realmRoles: ["group_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  vi.mocked(getAppSession).mockResolvedValue(member)
  mockDb.user.findUnique.mockResolvedValue({ id: "bob-db" })
  mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en" })
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.accessRequest.findFirst.mockResolvedValue(null)
  mockDb.accessRequest.create.mockResolvedValue({ id: "ar-1" })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
})

describe("requestAccess", () => {
  it("creates a pending requester request and notifies OpCo admins", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { isActive: true } },
    ])
    const res = await requestAccess({ opcoSlug: "ghana", note: "Need access" })
    expect(res).toEqual({ id: "ar-1" })
    expect(mockDb.accessRequest.create).toHaveBeenCalledWith({
      data: { userId: "bob-db", opcoId: "opco-ghana", role: "requester", note: "Need access" },
    })
    expect(notifyUsers).toHaveBeenCalledWith(
      [{ userId: "admin-1" }],
      expect.objectContaining({ type: "access.requested" })
    )
  })

  it("rejects when the user is already an active requester there", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(requestAccess({ opcoSlug: "ghana" })).rejects.toThrow(/already have requester access/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a duplicate pending request", async () => {
    mockDb.accessRequest.findFirst.mockResolvedValue({ id: "ar-existing" })
    await expect(requestAccess({ opcoSlug: "ghana" })).rejects.toThrow(/pending request/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("rejects an unknown OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    await expect(requestAccess({ opcoSlug: "atlantis" })).rejects.toThrow(/OpCo not found/i)
  })
})

describe("listAccessRequests", () => {
  it("returns all pending requests for a group admin", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-1", note: null, createdAt: new Date("2026-06-24T00:00:00Z"), opco: { name: "Ghana", slug: "ghana" }, user: { name: "Bob", email: "bob@csquared.com" } },
    ])
    const rows = await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } })
    )
    expect(rows[0]).toMatchObject({ id: "ar-1", opcoName: "Ghana", requesterName: "Bob" })
  })

  it("scopes an OpCo admin to their managed OpCos", async () => {
    vi.mocked(getAppSession).mockResolvedValue({
      keycloakId: "kc-gha", email: "a@x.co", name: "A",
      organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }], realmRoles: [],
    })
    mockDb.accessRequest.findMany.mockResolvedValue([])
    await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending", opco: { slug: { in: ["ghana"] } } } })
    )
  })
})
