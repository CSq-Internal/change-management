import { describe, it, expect, vi, beforeEach } from "vitest"

const notificationCreate = vi.fn().mockResolvedValue({})
vi.mock("@/server/db", () => ({
  getPrisma: () => ({ notification: { create: notificationCreate } }),
}))

import { notifyUsers } from "@/server/notify"

beforeEach(() => notificationCreate.mockClear())

describe("notifyUsers", () => {
  it("creates one notification per recipient with changeId null", async () => {
    await notifyUsers([{ userId: "u1" }, { userId: "u2" }], {
      type: "access.requested",
      title: "New access request",
      body: "Alice → Ghana",
    })
    expect(notificationCreate).toHaveBeenCalledTimes(2)
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "u1", type: "access.requested", title: "New access request", body: "Alice → Ghana", changeId: null },
    })
  })

  it("is a no-op when there are no recipients", async () => {
    await notifyUsers([], { type: "access.approved", title: "x", body: "y" })
    expect(notificationCreate).not.toHaveBeenCalled()
  })
})
