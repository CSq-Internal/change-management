// src/test/actions/cab.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-ghr",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  userOpCoAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) },
  cABMembership: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "cab-1" }),
    update: vi.fn().mockResolvedValue({ id: "cab-1" }),
    upsert: vi.fn().mockResolvedValue({ id: "cab-1" }),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { addCabMember, removeCabMember, listCabMembers } from "@/server/actions/cab"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }
const groupAuditor = { keycloakId: "kc-gaud", email: "gaud@t.co", name: "Gaud", organizations: [], realmRoles: ["group_auditor"] }
const ghanaAdmin = {
  keycloakId: "kc-gha", email: "gha@t.co", name: "GhA",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
  realmRoles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "a1" })
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
})

describe("addCabMember — per-OpCo", () => {
  it("rejects a non-admin", async () => {
    await expect(addCabMember("user-2", "ghana")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a target who is not an approver in that OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addCabMember("user-2", "ghana")).rejects.toThrow(/approver/i)
  })

  it("upserts an eligible approver and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await addCabMember("user-2", "ghana")
    expect(mockDb.cABMembership.upsert).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("seats an OpCo admin (no separate approver role) on the OpCo CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce({ id: "asg", role: "admin" })
    await expect(addCabMember("cto-user", "ghana")).resolves.toBeDefined()
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: { in: ["approver", "admin"] } }) })
    )
  })
})

describe("addCabMember — group", () => {
  it("rejects an OpCo admin (group CAB is group_admin-only)", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(addCabMember("user-2", null)).rejects.toThrow(/Forbidden/)
  })

  it("rejects a target who is not an approver in any OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addCabMember("user-2", null)).rejects.toThrow(/approver/i)
  })

  it("creates a new group membership and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await addCabMember("user-2", null)
    expect(mockDb.cABMembership.create).toHaveBeenCalledTimes(1)
    expect(mockDb.cABMembership.upsert).not.toHaveBeenCalled()
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("revives an existing soft-removed group membership instead of duplicating", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.cABMembership.findFirst.mockResolvedValueOnce({ id: "cab-old", isActive: false })
    await addCabMember("user-2", null)
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { id: "cab-old" },
      data: { isActive: true, endedAt: null },
    })
    expect(mockDb.cABMembership.create).not.toHaveBeenCalled()
  })
})

describe("removeCabMember", () => {
  it("soft-removes a per-OpCo member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await removeCabMember("user-2", "ghana")
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { userId_opcoId: { userId: "user-2", opcoId: "opco-gh" } },
      data: { isActive: false, endedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("rejects a non-admin removing a per-OpCo member", async () => {
    await expect(removeCabMember("user-2", "ghana")).rejects.toThrow(/Forbidden/)
  })

  it("soft-removes a group member (group_admin) and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.cABMembership.findFirst.mockResolvedValueOnce({ id: "cab-g", isActive: true })
    await removeCabMember("user-2", null)
    expect(mockDb.cABMembership.update).toHaveBeenCalledWith({
      where: { id: "cab-g" },
      data: { isActive: false, endedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("rejects an OpCo admin removing a group member", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(removeCabMember("user-2", null)).rejects.toThrow(/Forbidden/)
  })
})

describe("listCabMembers", () => {
  it("lets an OpCo admin list their CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await listCabMembers("ghana")
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith({
      where: { opcoId: "opco-gh", isActive: true },
      include: { user: true },
    })
  })

  it("rejects a plain requester listing a per-OpCo CAB", async () => {
    await expect(listCabMembers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_auditor read the group CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAuditor)
    await listCabMembers(null)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith({
      where: { opcoId: null, isActive: true },
      include: { user: true },
    })
  })

  it("rejects an OpCo admin reading the group CAB", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(listCabMembers(null)).rejects.toThrow(/Forbidden/)
  })
})
