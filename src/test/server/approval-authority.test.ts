import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  approverAssignment: { findMany: vi.fn() },
  cABMembership: { findMany: vi.fn() },
  approverDelegation: { findMany: vi.fn() },
  changeAssignee: { findMany: vi.fn() },
  changeRequest: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { getRoutedApprovers, getNamedApprovers, canUserApproveChange, listApprovableChanges } from "@/server/approval-authority"

const equianoChange = { infrastructureType: "Equiano Optics", opcoId: "opco-1" }
const wifiChange = { infrastructureType: "Wifi", opcoId: "opco-1" }
const u = (id: string) => ({ id, name: id, email: `${id}@x.com`, isActive: true })

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.approverAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
  mockDb.approverDelegation.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockResolvedValue([])
})

describe("getRoutedApprovers", () => {
  it("Equiano → queries the group CAB (opcoId null) when no override exists", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { userId: "samuel", user: { id: "samuel", name: "Samuel", email: "s@c.com" } },
    ])
    const out = await getRoutedApprovers(equianoChange)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
    expect(out.map((u) => u.id)).toEqual(["samuel"])
  })

  it("other infra → queries the change's OpCo CAB and includes active delegates", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { userId: "cto", user: { id: "cto", name: "CTO", email: "cto@c.com" } },
    ])
    mockDb.approverDelegation.findMany.mockResolvedValue([
      { toUser: { id: "deputy", name: "Deputy", email: "d@c.com" } },
    ])
    const out = await getRoutedApprovers(wifiChange)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", isActive: true }) })
    )
    expect(out.map((u) => u.id).sort()).toEqual(["cto", "deputy"])
  })

  it("falls back to CAB membership when no override exists", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cab1", user: u("cab1") }])
    const out = await getRoutedApprovers(wifiChange)
    expect(out.map((x) => x.id)).toEqual(["cab1"])
    expect(mockDb.approverAssignment.findMany).toHaveBeenCalled()
  })

  it("uses the override and ignores CAB when an override exists", async () => {
    mockDb.approverAssignment.findMany.mockResolvedValue([{ user: u("ovr1") }, { user: u("ovr2") }])
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cab1", user: u("cab1") }])
    const out = await getRoutedApprovers(wifiChange)
    expect(out.map((x) => x.id).sort()).toEqual(["ovr1", "ovr2"])
    expect(mockDb.cABMembership.findMany).not.toHaveBeenCalled()
  })

  it("excludes inactive override users", async () => {
    mockDb.approverAssignment.findMany.mockResolvedValue([{ user: { ...u("ovr1"), isActive: false } }, { user: u("ovr2") }])
    const out = await getRoutedApprovers(wifiChange)
    expect(out.map((x) => x.id)).toEqual(["ovr2"])
  })
})

describe("getNamedApprovers", () => {
  it("returns active approver-role assignees", async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u("named1") }])
    const out = await getNamedApprovers("c1")
    expect(out.map((x) => x.id)).toEqual(["named1"])
    expect(mockDb.changeAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ changeId: "c1", role: "approver" }) })
    )
  })
})

describe("canUserApproveChange", () => {
  it("group_admin can always approve", async () => {
    expect(await canUserApproveChange({ userId: "x", realmRoles: ["group_admin"], change: wifiChange })).toBe(true)
  })
  it("a routed CAB member can approve", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }])
    expect(await canUserApproveChange({ userId: "cto", realmRoles: [], change: wifiChange })).toBe(true)
  })
  it("a non-member non-admin cannot", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }])
    expect(await canUserApproveChange({ userId: "stranger", realmRoles: [], change: wifiChange })).toBe(false)
  })
  it("is true for a group admin", async () => {
    expect(await canUserApproveChange({ userId: "x", realmRoles: ["group_admin"], change: wifiChange })).toBe(true)
  })
  it("is true for a named approver-role assignee", async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u("named1") }])
    expect(await canUserApproveChange({ userId: "named1", realmRoles: [], change: wifiChange, changeId: "c1" })).toBe(true)
  })
  it("is false for an unrelated user", async () => {
    expect(await canUserApproveChange({ userId: "nope", realmRoles: [], change: wifiChange, changeId: "c1" })).toBe(false)
  })
})

describe("listApprovableChanges", () => {
  it("group_admin sees all pending", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([{ id: "c1", infrastructureType: "Wifi", opcoId: "opco-1" }])
    const out = await listApprovableChanges({ userId: "x", realmRoles: ["group_admin"] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
  it("a CAB member sees only changes routed to their CAB", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: "c1", infrastructureType: "Wifi", opcoId: "opco-1" },
      { id: "c2", infrastructureType: "Wifi", opcoId: "opco-2" },
    ])
    // member of opco-1 CAB only
    mockDb.cABMembership.findMany.mockImplementation(({ where }: { where: { opcoId: string | null } }) =>
      Promise.resolve(where.opcoId === "opco-1" ? [{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }] : [])
    )
    const out = await listApprovableChanges({ userId: "cto", realmRoles: [] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
})
