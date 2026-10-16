import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ getAppSession: vi.fn() }))
vi.mock("@/server/audit", () => ({ recordAdminAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/keycloak", () => ({ assignToOrganization: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/email", () => ({ sendAccessRequestEmail: vi.fn().mockResolvedValue(undefined) }))

const mockDb = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
  userOpCoAssignment: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), upsert: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
  accessRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { requestRole, listMyRoleRequests, listAccessRequests, joinOpCo } from "@/server/actions/access-requests"
import { getAppSession } from "@/lib/session"
import { recordAdminAction } from "@/server/audit"
import { notifyUsers } from "@/server/notify"
import { sendAccessRequestEmail } from "@/server/email"

const member = { keycloakId: "kc-bob", email: "bob@csquared.com", name: "Bob", organizations: [], realmRoles: [] }
const groupAdmin = { keycloakId: "kc-ga", email: "ga@csquared.com", name: "GA", organizations: [], realmRoles: ["group_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  vi.mocked(getAppSession).mockResolvedValue(member)
  mockDb.user.findUnique.mockResolvedValue({ id: "bob-db", isActive: true })
  mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en" })
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.userOpCoAssignment.findUnique.mockResolvedValue(null)
  mockDb.userOpCoAssignment.count.mockResolvedValue(1)
  mockDb.accessRequest.findFirst.mockResolvedValue(null)
  mockDb.accessRequest.create.mockResolvedValue({ id: "ar-1" })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.user.findMany.mockResolvedValue([])
})

describe("listAccessRequests", () => {
  it("returns all pending requests for a group admin", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-1", note: null, createdAt: new Date("2026-06-24T00:00:00Z"), opco: { name: "Ghana", slug: "ghana" }, user: { name: "Bob", email: "bob@csquared.com" } },
    ])
    const rows = await listAccessRequests()
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending", user: { isActive: true } } })
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
      expect.objectContaining({ where: { status: "pending", user: { isActive: true }, opco: { slug: { in: ["ghana"] } }, role: { not: "admin" } } })
    )
  })

  it("returns each request's role", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-1", role: "approver", note: "Lead", createdAt: new Date("2026-10-16T09:00:00Z"), opco: { name: "CSquared Ghana", slug: "ghana" }, user: { name: "Bob", email: "bob@csquared.com" } },
    ])
    const rows = await listAccessRequests()
    expect(rows[0].role).toBe("approver")
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
  user: { keycloakId: "kc-bob", locale: "en", isActive: true },
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

  it("refuses an admin deciding their own role request", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue({ ...pendingReq, role: "approver" })
    mockDb.user.findUnique.mockResolvedValue({ id: "bob-db" }) // the decider is the requester
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/your own role request/i)
    await expect(denyAccessRequest("ar-1")).rejects.toThrow(/your own role request/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("refuses to replace an OpCo's last admin with a lower role", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue({ ...pendingReq, role: "approver" })
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })
    mockDb.userOpCoAssignment.findUnique.mockResolvedValue({ role: "admin", isActive: true })
    mockDb.userOpCoAssignment.count.mockResolvedValue(0) // no other active admin
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/last admin/i)
    expect(mockDb.userOpCoAssignment.count).toHaveBeenCalledWith({
      where: { opcoId: "opco-ghana", role: "admin", isActive: true, userId: { not: "bob-db" } },
    })
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
  })

  it("refuses to grant a role to a deactivated user", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.accessRequest.findUnique.mockResolvedValue({ ...pendingReq, role: "approver", user: { ...pendingReq.user, isActive: false } })
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })
    await expect(approveAccessRequest("ar-1")).rejects.toThrow(/deactivated/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
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

describe("joinOpCo", () => {
  it("grants requester in the chosen OpCo, audits it and tells the OpCo's admins in-app", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "admin-1" }])

    await expect(joinOpCo("ghana")).resolves.toEqual({ ok: true })

    expect(mockDb.userOpCoAssignment.create).toHaveBeenCalledWith({
      data: { userId: "bob-db", opcoId: "opco-ghana", role: "requester" },
    })
    expect(recordAdminAction).toHaveBeenCalledWith(mockDb, expect.objectContaining({ action: "access.join", opcoId: "opco-ghana" }))
    expect(assignToOrganization).toHaveBeenCalledWith("kc-bob", "ghana")
    expect(notifyUsers).toHaveBeenCalledWith([{ userId: "admin-1" }], expect.objectContaining({ type: "access.joined" }))
    expect(sendAccessRequestEmail).not.toHaveBeenCalled()
  })

  it("refuses a user who already has an OpCo role (and a second click)", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(joinOpCo("ghana")).rejects.toThrow(/ask an admin/i)
    expect(mockDb.userOpCoAssignment.create).not.toHaveBeenCalled()
  })

  it("refuses a user whose OpCo access an admin removed (an ended assignment)", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-ended" })
    await expect(joinOpCo("ghana")).rejects.toThrow(/ask an admin/i)
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "bob-db" },
      select: { id: true },
    })
    expect(mockDb.userOpCoAssignment.create).not.toHaveBeenCalled()
  })

  it("refuses a deactivated user", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "bob-db", isActive: false })
    await expect(joinOpCo("ghana")).rejects.toThrow(/deactivated/i)
    expect(mockDb.userOpCoAssignment.create).not.toHaveBeenCalled()
  })

  it("locks the user row inside the transaction before checking, so two clicks can't join two OpCos", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    await joinOpCo("ghana")
    expect(mockDb.$transaction).toHaveBeenCalled()
    const lock = mockDb.$queryRaw.mock.invocationCallOrder[0]
    const check = mockDb.userOpCoAssignment.findFirst.mock.invocationCallOrder[0]
    const write = mockDb.userOpCoAssignment.create.mock.invocationCallOrder[0]
    expect(lock).toBeLessThan(check)
    expect(check).toBeLessThan(write)
  })

  it("refuses an unknown or archived OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValueOnce(null)
    await expect(joinOpCo("nowhere")).rejects.toThrow(/OpCo not found/i)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-old", name: "Old", slug: "old", locale: "en", archivedAt: new Date() })
    await expect(joinOpCo("old")).rejects.toThrow(/OpCo not found/i)
    expect(mockDb.userOpCoAssignment.create).not.toHaveBeenCalled()
  })

  it("never notifies the joiner even when they are also an admin elsewhere", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-ghana", name: "CSquared Ghana", slug: "ghana", locale: "en", archivedAt: null })
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "bob-db" }, { userId: "admin-1" }])
    await joinOpCo("ghana")
    expect(vi.mocked(notifyUsers).mock.calls[0][0]).toEqual([{ userId: "admin-1" }])
  })
})

describe("requestRole", () => {
  const ask = (over: Partial<{ opcoSlug: string; role: "approver" | "auditor" | "admin"; reason: string }> = {}) =>
    requestRole({ opcoSlug: "ghana", role: "approver", reason: "I lead the Ghana NOC", ...over })

  it("creates a pending request with the reason and audits it", async () => {
    await expect(ask()).resolves.toEqual({ id: "ar-1" })
    expect(mockDb.accessRequest.create).toHaveBeenCalledWith({
      data: { userId: "bob-db", opcoId: "opco-ghana", role: "approver", note: "I lead the Ghana NOC" },
    })
    expect(recordAdminAction).toHaveBeenCalledWith(mockDb, expect.objectContaining({ action: "access.request" }))
  })

  it("refuses the requester and group roles", async () => {
    await expect(ask({ role: "requester" as never })).rejects.toThrow(/cannot be requested/i)
    await expect(ask({ role: "group_admin" as never })).rejects.toThrow(/cannot be requested/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("refuses an empty or whitespace reason, and one over 500 characters", async () => {
    await expect(ask({ reason: "   " })).rejects.toThrow(/reason is required/i)
    await expect(ask({ reason: "x".repeat(501) })).rejects.toThrow(/500 characters/i)
  })

  it("refuses a role the user already holds in that OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "asg-1" })
    await expect(ask()).rejects.toThrow(/already have this role/i)
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "bob-db", opcoId: "opco-ghana", role: "approver", isActive: true },
      select: { id: true },
    })
  })

  it("refuses a second pending request for the same OpCo", async () => {
    mockDb.accessRequest.findFirst.mockResolvedValue({ id: "ar-0" })
    await expect(ask()).rejects.toThrow(/pending request for this OpCo/i)
  })

  it("checks for a pending request behind a lock on the user row, so two clicks can't file two", async () => {
    await ask()
    const lock = mockDb.$queryRaw.mock.invocationCallOrder[0]
    const check = mockDb.accessRequest.findFirst.mock.invocationCallOrder[0]
    const write = mockDb.accessRequest.create.mock.invocationCallOrder[0]
    expect(lock).toBeLessThan(check)
    expect(check).toBeLessThan(write)
  })

  it("refuses an unknown OpCo", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    await expect(ask({ opcoSlug: "nowhere" })).rejects.toThrow(/OpCo not found/i)
  })

  it("refuses a deactivated user", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "bob-db", isActive: false })
    await expect(ask()).rejects.toThrow(/deactivated/i)
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("refuses a user with no active OpCo role", async () => {
    mockDb.userOpCoAssignment.count.mockResolvedValue(0)
    await expect(ask()).rejects.toThrow(/choose your OpCo first/i)
    expect(mockDb.userOpCoAssignment.count).toHaveBeenCalledWith({ where: { userId: "bob-db", isActive: true } })
    expect(mockDb.accessRequest.create).not.toHaveBeenCalled()
  })

  it("sends approver and auditor requests to OpCo admins and group admins, deduped, never the requester", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { userId: "admin-1", user: { email: "admin1@csquared.com", name: "Admin One", locale: "en" } },
    ])
    mockDb.user.findMany.mockResolvedValue([
      { id: "admin-1", email: "admin1@csquared.com", name: "Admin One", locale: "en" },
      { id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" },
      { id: "bob-db", email: "bob@csquared.com", name: "Bob", locale: "en" },
    ])
    await ask({ role: "auditor" })
    const notified = vi.mocked(notifyUsers).mock.calls[0][0]
    expect(notified).toEqual(expect.arrayContaining([{ userId: "admin-1" }, { userId: "ga-2" }]))
    expect(notified).toHaveLength(2)
    expect(sendAccessRequestEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin1@csquared.com", role: "auditor" }))
    expect(sendAccessRequestEmail).toHaveBeenCalledTimes(2)
  })

  it("sends admin requests to group admins only", async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: "ga-2", email: "ga2@csquared.com", name: "Group Admin Two", locale: "fr" }])
    await ask({ role: "admin" })
    expect(mockDb.userOpCoAssignment.findMany).not.toHaveBeenCalled()
    expect(vi.mocked(notifyUsers).mock.calls[0][0]).toEqual([{ userId: "ga-2" }])
  })
})

describe("listMyRoleRequests", () => {
  it("returns the caller's requests newest first", async () => {
    mockDb.accessRequest.findMany.mockResolvedValue([
      { id: "ar-2", role: "approver", status: "pending", decisionReason: null, createdAt: new Date("2026-10-16T09:00:00Z"), opco: { name: "CSquared Ghana" } },
    ])
    await expect(listMyRoleRequests()).resolves.toEqual([
      { id: "ar-2", opcoName: "CSquared Ghana", role: "approver", status: "pending", decisionReason: null, createdAt: "2026-10-16T09:00:00.000Z" },
    ])
    expect(mockDb.accessRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "bob-db" },
      orderBy: { createdAt: "desc" },
    }))
  })
})
