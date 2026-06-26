import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ getAppSession: vi.fn() }))
vi.mock("@/server/audit", () => ({ recordAdminAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/keycloak", () => ({ assignToOrganization: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/email", () => ({ sendAccessRequestEmail: vi.fn().mockResolvedValue(undefined) }))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
  userOpCoAssignment: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  accessRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { requestAccess, listAccessRequests } from "@/server/actions/access-requests"
import { getAppSession } from "@/lib/session"
import { notifyUsers } from "@/server/notify"
import { sendAccessRequestEmail } from "@/server/email"

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
  mockDb.user.findMany.mockResolvedValue([])
})

describe("requestAccess", () => {
  it("creates a pending requester request and notifies OpCo admins", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
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
    expect(sendAccessRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin1@csquared.com", opcoName: "CSquared Ghana", requesterName: "Bob" })
    )
  })

  it("notifies group admins and the target OpCo's admins, deduped and excluding the requester", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
    ])
    mockDb.user.findMany.mockResolvedValue([
      { id: "admin-1", email: "admin1@csquared.com", name: "Admin One", locale: "en" }, // also a group admin → dedup
      { id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" },
      { id: "bob-db", email: "bob@csquared.com", name: "Bob", locale: "en" }, // the requester → excluded
    ])
    await requestAccess({ opcoSlug: "ghana" })
    const notified = vi.mocked(notifyUsers).mock.calls[0][0]
    expect(notified).toEqual(expect.arrayContaining([{ userId: "admin-1" }, { userId: "ga-2" }]))
    expect(notified).toHaveLength(2) // deduped admin-1, excluded bob-db
    expect(sendAccessRequestEmail).toHaveBeenCalledTimes(2)
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

import { approveAccessRequest, denyAccessRequest } from "@/server/actions/access-requests"
import { assignToOrganization } from "@/server/keycloak"

const pendingReq = {
  id: "ar-1",
  status: "pending",
  userId: "bob-db",
  role: "requester",
  opco: { id: "opco-ghana", slug: "ghana", name: "CSquared Ghana" },
  user: { keycloakId: "kc-bob", locale: "en" },
}

describe("approveAccessRequest", () => {
  it("grants the requester assignment, flips status, and notifies the requester", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })

    const res = await approveAccessRequest("ar-1")
    expect(res).toEqual({ ok: true })
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_opcoId: { userId: "bob-db", opcoId: "opco-ghana" } },
      update: { role: "requester", isActive: true, endedAt: null },
      create: { userId: "bob-db", opcoId: "opco-ghana", role: "requester" },
    })
    expect(mockDb.accessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ar-1" }, data: expect.objectContaining({ status: "approved", decidedById: "ga-db" }) })
    )
    expect(assignToOrganization).toHaveBeenCalledWith("kc-bob", "ghana")
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "bob-db" }], expect.objectContaining({ type: "access.approved" }))
  })

  it("rejects when the caller cannot assign requester in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValue(member) // no roles
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/Forbidden/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-pending request", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue({ ...pendingReq, status: "approved" })
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/already decided/i)
  })
})

describe("denyAccessRequest", () => {
  it("flips status to denied with the reason and notifies the requester", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })

    const res = await denyAccessRequest("ar-1", "Not needed")
    expect(res).toEqual({ ok: true })
    expect(mockDb.accessRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied", decisionReason: "Not needed", decidedById: "ga-db" }) })
    )
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "bob-db" }], expect.objectContaining({ type: "access.denied" }))
  })

  it("rejects when the caller cannot assign requester in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValue(member)
    mockDb.accessRequest.findUnique.mockResolvedValue(pendingReq)
    await expect(denyAccessRequest("ar-1")).rejects.toThrow(/Forbidden/i)
  })
})
