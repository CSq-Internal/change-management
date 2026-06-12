// src/test/actions/delegations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-gha",
    email: "gha@t.co",
    name: "Ghana Admin",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  userOpCoAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) },
  approverDelegation: {
    create: vi.fn().mockResolvedValue({ id: "del-1" }),
    update: vi.fn().mockResolvedValue({ id: "del-1" }),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { createDelegation, revokeDelegation, listDelegations } from "@/server/actions/delegations"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }
const ghanaRequester = {
  keycloakId: "kc-ghr", email: "ghr@t.co", name: "GhR",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
  realmRoles: [],
}
const ghanaAuditor = {
  keycloakId: "kc-gaud", email: "gaud@t.co", name: "GhAud",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["auditor"] }],
  realmRoles: [],
}

const validUntil = new Date("2026-12-31")

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: "a1" })
})

describe("createDelegation", () => {
  it("rejects a non-admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/Forbidden/)
  })

  it("rejects delegating to oneself", async () => {
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-same", toUserId: "u-same", validUntil })
    ).rejects.toThrow(/itself|same|self/i)
  })

  it("rejects when the delegator is not an approver in the OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/approver/i)
  })

  it("rejects when the delegatee is not an approver in the OpCo", async () => {
    mockDb.userOpCoAssignment.findFirst
      .mockResolvedValueOnce({ id: "a1" })
      .mockResolvedValueOnce(null)
    await expect(
      createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    ).rejects.toThrow(/approver/i)
  })

  it("creates a delegation and writes an audit row", async () => {
    await createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    expect(mockDb.approverDelegation.create).toHaveBeenCalledWith({
      data: { opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to", validUntil },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("allows a group_admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await createDelegation({ opcoSlug: "ghana", fromUserId: "u-from", toUserId: "u-to", validUntil })
    expect(mockDb.approverDelegation.create).toHaveBeenCalledTimes(1)
  })
})

describe("revokeDelegation", () => {
  it("throws when the delegation does not exist", async () => {
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce(null)
    await expect(revokeDelegation("missing")).rejects.toThrow(/not found/i)
  })

  it("rejects a non-admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce({ id: "del-1", opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to" })
    await expect(revokeDelegation("del-1")).rejects.toThrow(/Forbidden/)
  })

  it("soft-revokes a delegation and writes an audit row", async () => {
    mockDb.approverDelegation.findUnique.mockResolvedValueOnce({ id: "del-1", opcoId: "opco-gh", fromUserId: "u-from", toUserId: "u-to" })
    await revokeDelegation("del-1")
    expect(mockDb.approverDelegation.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { isActive: false },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("listDelegations", () => {
  it("lets an OpCo admin list delegations", async () => {
    await listDelegations("ghana")
    expect(mockDb.approverDelegation.findMany).toHaveBeenCalledWith({
      where: { opcoId: "opco-gh", isActive: true },
      include: { fromUser: true, toUser: true },
    })
  })

  it("lets an auditor read delegations", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAuditor)
    await listDelegations("ghana")
    expect(mockDb.approverDelegation.findMany).toHaveBeenCalledTimes(1)
  })

  it("rejects a plain requester", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaRequester)
    await expect(listDelegations("ghana")).rejects.toThrow(/Forbidden/)
  })
})
