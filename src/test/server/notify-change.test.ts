import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = {
  changeRequest: { findUnique: vi.fn() },
  notificationPreference: { findMany: vi.fn() },
  notification: { create: vi.fn() },
  notificationDispatch: { create: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  opCo: { findUnique: vi.fn() },
  chatWebhook: { findMany: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

const { resolveAudience } = vi.hoisted(() => ({ resolveAudience: vi.fn() }))
vi.mock("@/server/audience", () => ({ resolveAudience }))

const { sendChangeEventEmail } = vi.hoisted(() => ({
  sendChangeEventEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/server/email", () => ({
  sendChangeEventEmail,
  sendApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined),
  sendSlaEscalationEmail: vi.fn().mockResolvedValue(undefined),
  sendEmergencyAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

import { notifyChange } from "@/server/notify"

const CHANGE = {
  id: "c1", title: "Router upgrade", opcoId: "opco-1", requesterId: "u-req",
  infrastructureType: "Wifi", riskLevel: "low",
  plannedStart: null, plannedEnd: null,
  opco: { name: "Ghana", locale: "en" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findUnique.mockResolvedValue(CHANGE)
  mockDb.notificationPreference.findMany.mockResolvedValue([])
  mockDb.notification.create.mockResolvedValue({})
  mockDb.notificationDispatch.create.mockResolvedValue({})
  mockDb.user.findMany.mockResolvedValue([{ id: "u1", locale: "en" }])
  mockDb.opCo.findUnique.mockResolvedValue({ locale: "en" })
  mockDb.chatWebhook.findMany.mockResolvedValue([])
  sendChangeEventEmail.mockResolvedValue(undefined)
  resolveAudience.mockResolvedValue([{ userId: "u1", email: "u1@c.com", name: "U One" }])
})

describe("notifyChange", () => {
  it("writes an in-app notification for the resolved audience", async () => {
    await notifyChange("change_implemented", "c1")
    expect(resolveAudience).toHaveBeenCalledWith(
      "change_implemented",
      expect.objectContaining({ id: "c1", opcoId: "opco-1", requesterId: "u-req" }),
      undefined,
    )
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", type: "change_implemented", changeId: "c1" }),
      })
    )
  })

  it("sends the generic email for a new event type", async () => {
    await notifyChange("change_implemented", "c1")
    expect(sendChangeEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u1@c.com", changeId: "c1" })
    )
  })

  it("includes change detail rows in the generic email", async () => {
    await notifyChange("change_implemented", "c1")
    const arg = sendChangeEventEmail.mock.calls[0][0] as { rows: [string, string][] }
    expect(arg.rows).toEqual(expect.arrayContaining([
      ["Change", "Router upgrade"],
      ["OpCo", "Ghana"],
      ["Risk", "low"],
    ]))
  })

  it("honours DEFAULT_CHANNELS — no email for an ambient event", async () => {
    await notifyChange("change_closed", "c1")
    expect(mockDb.notification.create).toHaveBeenCalled()
    expect(sendChangeEventEmail).not.toHaveBeenCalled()
  })

  it("a stored preference overrides the default", async () => {
    mockDb.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "change_closed", channel: "email", enabled: true },
    ])
    await notifyChange("change_closed", "c1")
    expect(sendChangeEventEmail).toHaveBeenCalled()
  })

  it("writes a ledger row per recipient", async () => {
    await notifyChange("change_implemented", "c1")
    expect(mockDb.notificationDispatch.create).toHaveBeenCalledWith({
      data: { userId: "u1", changeId: "c1", type: "change_implemented" },
    })
  })

  it("passes actorId through to the resolver", async () => {
    await notifyChange("change_implemented", "c1", { actorId: "u-actor" })
    expect(resolveAudience).toHaveBeenCalledWith("change_implemented", expect.anything(), "u-actor")
  })

  it("uses explicit recipients when supplied, bypassing the resolver", async () => {
    await notifyChange("assignee_added", "c1", {
      recipients: [{ userId: "u9", email: "u9@c.com", name: "U Nine" }],
      role: "approver",
    })
    expect(resolveAudience).not.toHaveBeenCalled()
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u9" }) })
    )
  })

  it("resolves silently when the change no longer exists", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(null)
    await expect(notifyChange("change_closed", "gone")).resolves.toBeUndefined()
    expect(mockDb.notification.create).not.toHaveBeenCalled()
  })

  it("does nothing when the audience is empty", async () => {
    resolveAudience.mockResolvedValue([])
    await notifyChange("change_closed", "c1")
    expect(mockDb.notification.create).not.toHaveBeenCalled()
  })

  it("never rejects when a transport throws", async () => {
    sendChangeEventEmail.mockRejectedValueOnce(new Error("resend down"))
    await expect(notifyChange("change_implemented", "c1")).resolves.toBeUndefined()
  })

  it("never rejects when the change lookup throws", async () => {
    mockDb.changeRequest.findUnique.mockRejectedValueOnce(new Error("db down"))
    await expect(notifyChange("change_implemented", "c1")).resolves.toBeUndefined()
  })

  it("broadcasts change_implemented to active chat webhooks", async () => {
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: "https://chat.example/hook" }])
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"))
    await notifyChange("change_implemented", "c1")
    expect(spy).toHaveBeenCalledWith("https://chat.example/hook", expect.objectContaining({ method: "POST" }))
    spy.mockRestore()
  })

  it("does not broadcast a non-broadcast type to chat", async () => {
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: "https://chat.example/hook" }])
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"))
    await notifyChange("change_closed", "c1")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
