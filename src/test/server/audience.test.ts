import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  user: { findMany: vi.fn() },
  changeAssignee: { findMany: vi.fn() },
  approval: { findMany: vi.fn() },
  userOpCoAssignment: { findMany: vi.fn() },
  cABMembership: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { getRoutedApprovers, getNamedApprovers } = vi.hoisted(() => ({
  getRoutedApprovers: vi.fn(),
  getNamedApprovers: vi.fn(),
}))
vi.mock("@/server/approval-authority", () => ({ getRoutedApprovers, getNamedApprovers }))

import { resolveAudience, AUDIENCE } from "@/server/audience"
import { NOTIFY_EVENT_TYPES } from "@/lib/notifications"

const CHANGE = { id: "c1", opcoId: "opco-1", infrastructureType: "Wifi", requesterId: "u-req" }
const user = (id: string, active = true) => ({ id, name: id, email: `${id}@c.com`, isActive: active })

/**
 * Seed the user lookup so it honours the `where: { id: { in: [...] } }` filter. A mock
 * that returns every user regardless of the filter cannot observe actor suppression —
 * the resolver drops the actor from the id set *before* the query.
 */
function seedUsers(...users: ReturnType<typeof user>[]) {
  mockDb.user.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      users.filter((u) => where.id.in.includes(u.id))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockResolvedValue([])
  mockDb.approval.findMany.mockResolvedValue([])
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
  getRoutedApprovers.mockResolvedValue([])
  getNamedApprovers.mockResolvedValue([])
})

describe("AUDIENCE table", () => {
  // assignee_added / assignee_removed target one specific person known only to the
  // caller, so they carry empty role lists by design and pass recipients explicitly.
  const EXPLICIT_RECIPIENT_TYPES = ["assignee_added", "assignee_removed"]

  it("defines an entry for every event type", () => {
    for (const t of NOTIFY_EVENT_TYPES) {
      expect(AUDIENCE[t], `missing audience for ${t}`).toBeDefined()
    }
  })

  it("every resolver-driven type has at least one role group", () => {
    for (const t of NOTIFY_EVENT_TYPES) {
      if (EXPLICIT_RECIPIENT_TYPES.includes(t)) continue
      expect(AUDIENCE[t].length, `empty audience for ${t}`).toBeGreaterThan(0)
    }
  })

  it("the explicit-recipient types resolve to nobody on their own", () => {
    for (const t of EXPLICIT_RECIPIENT_TYPES) {
      expect(AUDIENCE[t as keyof typeof AUDIENCE]).toEqual([])
    }
  })
})

describe("resolveAudience", () => {
  it("change_submitted resolves to the requester", async () => {
    seedUsers(user("u-req"))
    const out = await resolveAudience("change_submitted", CHANGE)
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("suppresses the actor from their own event", async () => {
    seedUsers(user("u-req"), user("u-other"))
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: "u-other" }])
    const out = await resolveAudience("change_implemented", CHANGE, "u-req")
    expect(out.map((r) => r.userId)).toEqual(["u-other"])
  })

  it("does NOT suppress the actor for change_submitted — it is a receipt", async () => {
    seedUsers(user("u-req"))
    const out = await resolveAudience("change_submitted", CHANGE, "u-req")
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("dedupes a user who appears in two role groups", async () => {
    seedUsers(user("u-req"))
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: "u-req" }])
    mockDb.approval.findMany.mockResolvedValue([{ approverId: "u-req" }])
    const out = await resolveAudience("change_implemented", CHANGE)
    expect(out.map((r) => r.userId)).toEqual(["u-req"])
  })

  it("drops inactive users", async () => {
    seedUsers(user("u-req", false))
    const out = await resolveAudience("change_submitted", CHANGE)
    expect(out).toEqual([])
  })

  it("approversPending excludes users who have already voted", async () => {
    getRoutedApprovers.mockResolvedValue([{ id: "a1" }, { id: "a2" }])
    getNamedApprovers.mockResolvedValue([{ id: "a3" }])
    mockDb.approval.findMany.mockResolvedValue([{ approverId: "a2" }])
    seedUsers(user("a1"), user("a3"))
    const out = await resolveAudience("approver_nudge", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["a1", "a3"])
  })

  it("retro_overdue reaches the requester and the group CAB", async () => {
    mockDb.cABMembership.findMany.mockResolvedValue([{ userId: "cab1" }])
    seedUsers(user("u-req"), user("cab1"))
    const out = await resolveAudience("retro_overdue", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["cab1", "u-req"])
    expect(mockDb.cABMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: null, isActive: true }) })
    )
  })

  it("change_verified reaches the requester and OpCo admins", async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ userId: "adm1" }])
    seedUsers(user("u-req"), user("adm1"))
    const out = await resolveAudience("change_verified", CHANGE)
    expect(out.map((r) => r.userId).sort()).toEqual(["adm1", "u-req"])
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opcoId: "opco-1", role: "admin", isActive: true }) })
    )
  })

  it("returns an empty list rather than throwing when no one matches", async () => {
    mockDb.user.findMany.mockResolvedValue([])
    const out = await resolveAudience("change_closed", CHANGE)
    expect(out).toEqual([])
  })

  it("returns an empty list for an explicit-recipient type without querying", async () => {
    const out = await resolveAudience("assignee_added", CHANGE)
    expect(out).toEqual([])
    expect(mockDb.user.findMany).not.toHaveBeenCalled()
  })
})
