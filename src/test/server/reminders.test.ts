import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  changeRequest: { findMany: vi.fn() },
  notificationDispatch: { findFirst: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { notifyChange } = vi.hoisted(() => ({ notifyChange: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/server/notify", () => ({ notifyChange }))

const { resolveAudience } = vi.hoisted(() => ({ resolveAudience: vi.fn() }))
vi.mock("@/server/audience", () => ({ resolveAudience }))

import { runDueReminders } from "@/server/reminders"

const HOUR = 60 * 60 * 1000
const now = Date.now()

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findMany.mockResolvedValue([])
  mockDb.notificationDispatch.findFirst.mockResolvedValue(null)
  notifyChange.mockResolvedValue(undefined)
  resolveAudience.mockResolvedValue([{ userId: "a1", email: "a1@c.com", name: "A One" }])
})

describe("approver_nudge", () => {
  // low risk => SLA_HOURS 48; the midpoint is 24h after creation.
  const pendingChange = (createdOffsetH: number) => ({
    id: "c1", riskLevel: "low", opcoId: "o1",
    infrastructureType: "Wifi", requesterId: "u-req",
    createdAt: new Date(now - createdOffsetH * HOUR),
    slaDeadline: new Date(now + (48 - createdOffsetH) * HOUR),
  })

  it("does not nudge before the SLA midpoint", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(10)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
    expect(notifyChange).not.toHaveBeenCalled()
  })

  it("nudges past the SLA midpoint", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(1)
    expect(notifyChange).toHaveBeenCalledWith("approver_nudge", "c1", expect.objectContaining({
      recipients: [{ userId: "a1", email: "a1@c.com", name: "A One" }],
    }))
  })

  it("does not nudge once the SLA has breached — sla_escalated takes over", async () => {
    const breached = { ...pendingChange(30), slaDeadline: new Date(now - HOUR) }
    mockDb.changeRequest.findMany.mockResolvedValueOnce([breached]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
  })

  it("suppresses a nudge sent within the last 24h", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    mockDb.notificationDispatch.findFirst.mockResolvedValue({ id: "d1" })
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
    expect(mockDb.notificationDispatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "a1", changeId: "c1", type: "approver_nudge" }),
      })
    )
  })

  it("skips a change with no pending approvers", async () => {
    resolveAudience.mockResolvedValue([])
    mockDb.changeRequest.findMany.mockResolvedValueOnce([pendingChange(30)]).mockResolvedValueOnce([])
    const out = await runDueReminders()
    expect(out.nudged).toBe(0)
  })
})

describe("retro_overdue", () => {
  const expedited = (dueOffsetH: number) => ({
    id: "c2", opcoId: "o1", infrastructureType: "Wifi", requesterId: "u-req",
    retroApprovalDueAt: new Date(now + dueOffsetH * HOUR),
  })

  it("fires inside the 12h window", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(6)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(1)
    expect(notifyChange).toHaveBeenCalledWith("retro_overdue", "c2", expect.objectContaining({
      dueAt: expect.any(String),
    }))
  })

  it("fires when already past due", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(-5)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(1)
  })

  it("does not fire more than 12h before the deadline", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(30)])
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(0)
  })

  it("suppresses a reminder sent within the last 12h", async () => {
    mockDb.changeRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expedited(6)])
    mockDb.notificationDispatch.findFirst.mockResolvedValue({ id: "d1" })
    const out = await runDueReminders()
    expect(out.retroOverdue).toBe(0)
  })

  it("queries only expedited changes still awaiting retrospective approval", async () => {
    await runDueReminders()
    expect(mockDb.changeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expedited: true, retroApprovedAt: null }),
      })
    )
  })
})
