import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  approverAssignment: { findMany: vi.fn() },
  cABMembership: { findMany: vi.fn() },
  approverDelegation: { findMany: vi.fn() },
  changeAssignee: { findMany: vi.fn() },
  changeRequest: { findMany: vi.fn() },
  userOpCoAssignment: { findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import {
  getRoutedApprovers, getNamedApprovers, canUserApproveChange, listApprovableChanges,
  listEligibleApprovers, listEligibleApproversForScope, isEligibleApprover,
} from "@/server/approval-authority"

const equianoChange = { infrastructureType: "Equiano Optics", opcoId: "opco-1" }
const wifiChange = { infrastructureType: "Wifi", opcoId: "opco-1" }
const u = (id: string) => ({ id, name: id, email: `${id}@x.com`, isActive: true })

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.approverAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
  mockDb.approverDelegation.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockResolvedValue([])
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-1" })
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
      { toUser: { id: "deputy", name: "Deputy", email: "d@c.com", isActive: true } },
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
  it("is true for a named approver-role assignee who is still eligible", async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u("named1") }])
    // Still holds the OpCo approver role, so the eligibility re-check passes.
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: u("named1") }])
    expect(await canUserApproveChange({ userId: "named1", realmRoles: [], change: wifiChange, changeId: "c1" })).toBe(true)
  })
  it("is false for a named assignee who has since lost eligibility", async () => {
    // The nomination row survives, but they are no longer on the CAB and hold no
    // approver/admin role — a nomination is not a standing grant.
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u("named1") }])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
    mockDb.cABMembership.findMany.mockResolvedValue([])
    expect(await canUserApproveChange({ userId: "named1", realmRoles: [], change: wifiChange, changeId: "c1" })).toBe(false)
  })
  it("is false for an OpCo approver named on a change since moved to Equiano infra", async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([{ user: u("opcoAppr") }])
    // Equiano is group-level: the OpCo role no longer confers authority, and the group
    // CAB is empty. Without revalidation the stale nomination would still authorise them.
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: u("opcoAppr") }])
    mockDb.cABMembership.findMany.mockResolvedValue([])
    expect(await canUserApproveChange({ userId: "opcoAppr", realmRoles: [], change: equianoChange, changeId: "c1" })).toBe(false)
  })
  it("is false for an unrelated user", async () => {
    expect(await canUserApproveChange({ userId: "nope", realmRoles: [], change: wifiChange, changeId: "c1" })).toBe(false)
  })
})

describe("getRoutedApprovers — delegates", () => {
  it("leaves out a delegate who has been deactivated", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: u("cto") }])
    mockDb.approverDelegation.findMany.mockResolvedValue([
      { toUser: { id: "gone", name: "Gone", email: "g@c.com", isActive: false } },
      { toUser: { id: "deputy", name: "Deputy", email: "d@c.com", isActive: true } },
    ])
    const out = await getRoutedApprovers(wifiChange)
    expect(out.map((x) => x.id).sort()).toEqual(["cto", "deputy"])
  })
})

describe("listApprovableChanges", () => {
  it("group_admin sees all pending", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([{ id: "c1", infrastructureType: "Wifi", opcoId: "opco-1", approvals: [], auditTrail: [] }])
    const out = await listApprovableChanges({ userId: "x", realmRoles: ["group_admin"] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
  it("a CAB member sees only changes routed to their CAB", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: "c1", infrastructureType: "Wifi", opcoId: "opco-1", approvals: [], auditTrail: [] },
      { id: "c2", infrastructureType: "Wifi", opcoId: "opco-2", approvals: [], auditTrail: [] },
    ])
    // member of opco-1 CAB only
    mockDb.cABMembership.findMany.mockImplementation(({ where }: { where: { opcoId: string | null } }) =>
      Promise.resolve(where.opcoId === "opco-1" ? [{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }] : [])
    )
    const out = await listApprovableChanges({ userId: "cto", realmRoles: [] })
    expect(out.map((c) => c.id)).toEqual(["c1"])
  })
  it("looks up each CAB once and the user's nominations once, however many changes are pending", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, infrastructureType: "Wifi", opcoId: "opco-1", approvals: [], auditTrail: [] })),
    )
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cto", user: { id: "cto", name: null, email: "cto@c.com" } }])
    const out = await listApprovableChanges({ userId: "cto", realmRoles: [] })
    expect(out).toHaveLength(8)
    expect(mockDb.approverAssignment.findMany).toHaveBeenCalledTimes(1)
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledTimes(1)
    expect(mockDb.changeAssignee.findMany).toHaveBeenCalledTimes(1)
  })
  it("still shows a change the user is named on, while they remain eligible", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: "c1", infrastructureType: "Wifi", opcoId: "opco-1", approvals: [], auditTrail: [] },
      { id: "c2", infrastructureType: "Wifi", opcoId: "opco-1", approvals: [], auditTrail: [] },
    ])
    mockDb.changeAssignee.findMany.mockResolvedValue([{ changeId: "c2" }])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: u("named1") }]) // still an approver
    const out = await listApprovableChanges({ userId: "named1", realmRoles: [] })
    expect(out.map((c) => c.id)).toEqual(["c2"])
    expect(mockDb.changeAssignee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "named1", role: "approver", changeId: { in: ["c1", "c2"] } },
    }))
  })
  it("excludes the user's own requests from the queue (SoD)", async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([])
    await listApprovableChanges({ userId: "me", realmRoles: ["group_admin"] })
    expect(mockDb.changeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ requesterId: { not: "me" } }) })
    )
  })
  it("hides a change the user has voted on in this round, but not one from an earlier round", async () => {
    const resubmitted = new Date("2026-10-10T00:00:00Z")
    mockDb.changeRequest.findMany.mockResolvedValue([
      // Voted after the latest submission: awaiting other approvers, not them.
      { id: "c1", infrastructureType: "Wifi", opcoId: "opco-1", auditTrail: [{ at: resubmitted }],
        approvals: [{ approverId: "me", decision: "approve", decidedAt: new Date("2026-10-11T00:00:00Z") }] },
      // Voted in round 1 only; the change was rejected and submitted again.
      { id: "c2", infrastructureType: "Wifi", opcoId: "opco-1", auditTrail: [{ at: resubmitted }],
        approvals: [{ approverId: "me", decision: "approve", decidedAt: new Date("2026-10-05T00:00:00Z") }] },
    ])
    const out = await listApprovableChanges({ userId: "me", realmRoles: ["group_admin"] })
    expect(out.map((c) => c.id)).toEqual(["c2"])
  })
})

describe("listEligibleApprovers", () => {
  it("non-Equiano infra: returns OpCo CAB members plus OpCo approver/admin role holders", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
      { user: { id: "adm1", name: "Adm One", email: "adm1@c.com", isActive: true } },
    ])

    const out = await listEligibleApprovers("opco-1", "Wifi")

    expect(out.map((u) => u.id).sort()).toEqual(["adm1", "appr1", "cab1"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", isActive: true }) })
    )
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          opcoId: "opco-1", isActive: true, role: { in: ["approver", "admin"] },
        }),
      })
    )
  })

  it("Equiano infra: returns group CAB members ONLY and never queries OpCo role holders", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "samuel", name: "Samuel", email: "s@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
    ])

    const out = await listEligibleApprovers("opco-1", "Equiano Optics")

    expect(out.map((u) => u.id)).toEqual(["samuel"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
    expect(mockDb.userOpCoAssignment.findMany).not.toHaveBeenCalled()
  })

  it("excludes inactive users", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "live", name: "Live", email: "live@c.com", isActive: true } },
      { user: { id: "gone", name: "Gone", email: "gone@c.com", isActive: false } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["live"])
  })

  it("excludes excludeUserId (the requester)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "me", name: "Me", email: "me@c.com", isActive: true } },
      { user: { id: "other", name: "Other", email: "other@c.com", isActive: true } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi", "me")
    expect(out.map((u) => u.id)).toEqual(["other"])
  })

  it("dedupes a user who is both a CAB member and an OpCo approver", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "dual", name: "Dual", email: "dual@c.com", isActive: true } },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "dual", name: "Dual", email: "dual@c.com", isActive: true } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["dual"])
  })

  it("does NOT include delegates (they derive authority via getRoutedApprovers)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    mockDb.approverDelegation.findMany.mockResolvedValue([
      { toUser: { id: "delegate", name: "Del", email: "del@c.com" } },
    ])
    const out = await listEligibleApprovers("opco-1", "Wifi")
    expect(out.map((u) => u.id)).toEqual(["cab1"])
  })
})

describe("listEligibleApproversForScope", () => {
  it("resolves the OpCo slug to an id and delegates to listEligibleApprovers", async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-9" })
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    const out = await listEligibleApproversForScope("ghana", "Wifi")
    expect(mockDb.opCo.findUnique).toHaveBeenCalledWith({ where: { slug: "ghana" }, select: { id: true } })
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-9" }) })
    )
    expect(out.map((u) => u.id)).toEqual(["cab1"])
  })

  it("returns an empty list for an unknown OpCo slug", async () => {
    mockDb.opCo.findUnique.mockResolvedValue(null)
    const out = await listEligibleApproversForScope("nowhere", "Wifi")
    expect(out).toEqual([])
  })
})

describe("isEligibleApprover", () => {
  it("agrees with listEligibleApprovers — true for a listed user", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([
      { user: { id: "cab1", name: "Cab One", email: "cab1@c.com", isActive: true } },
    ])
    expect(await isEligibleApprover("cab1", "opco-1", "Wifi")).toBe(true)
  })

  it("false for a user absent from the eligible list", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
    expect(await isEligibleApprover("rando", "opco-1", "Wifi")).toBe(false)
  })

  it("false for an OpCo approver on an Equiano change (group-only tightening)", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: "appr1", name: "Appr One", email: "appr1@c.com", isActive: true } },
    ])
    expect(await isEligibleApprover("appr1", "opco-1", "Equiano IP")).toBe(false)
  })
})
