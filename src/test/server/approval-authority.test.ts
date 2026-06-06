import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  cABMembership: { findMany: vi.fn() },
  approverDelegation: { findMany: vi.fn() },
  changeRequest: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { getRoutedApprovers, canUserApproveChange, listApprovableChanges } from "@/server/approval-authority"

const equianoChange = { infrastructureType: "Equiano Optics", opcoId: "opco-1" }
const wifiChange = { infrastructureType: "Wifi", opcoId: "opco-1" }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.approverDelegation.findMany.mockResolvedValue([])
})

describe("getRoutedApprovers", () => {
  it("Equiano → queries the group CAB (opcoId null)", async () => {
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
})

describe("canUserApproveChange", () => {
  it("group_admin can always approve", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
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
