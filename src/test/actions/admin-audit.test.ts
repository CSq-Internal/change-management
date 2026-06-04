import { describe, it, expect, vi } from "vitest"
import { recordAdminAction } from "@/server/audit"

function fakeTx(actorId: string | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(actorId ? { id: actorId } : null) },
    adminAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  }
}

describe("recordAdminAction", () => {
  it("resolves the actor by keycloakId and appends one audit row", async () => {
    const tx = fakeTx("actor-db-id")
    await recordAdminAction(tx as never, {
      actorKeycloakId: "kc-actor",
      action: "role.grant",
      opcoId: "opco-gh",
      targetUserId: "target",
      summary: "Granted approver in ghana",
      metadata: { to: "approver" },
    })
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { keycloakId: "kc-actor" },
      select: { id: true },
    })
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "actor-db-id",
        action: "role.grant",
        opcoId: "opco-gh",
        targetUserId: "target",
        summary: "Granted approver in ghana",
        metadata: { to: "approver" },
      },
    })
  })

  it("throws if the actor cannot be resolved", async () => {
    const tx = fakeTx(null)
    await expect(
      recordAdminAction(tx as never, { actorKeycloakId: "ghost", action: "x", summary: "y" })
    ).rejects.toThrow(/actor/i)
  })
})
