import { describe, it, expect, vi } from "vitest"
import { recordAdminAction } from "@/server/audit"

function fakeTx(actorId: string | null, upsertId = "reconciled-id") {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(actorId ? { id: actorId } : null),
      upsert: vi.fn().mockResolvedValue({ id: upsertId }),
    },
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

  it("throws if the actor cannot be resolved and no email is given to reconcile", async () => {
    const tx = fakeTx(null)
    await expect(
      recordAdminAction(tx as never, { actorKeycloakId: "ghost", action: "x", summary: "y" })
    ).rejects.toThrow(/actor/i)
  })

  it("lazily links/creates the actor by email when the row is missing", async () => {
    const tx = fakeTx(null, "linked-id")
    await recordAdminAction(tx as never, {
      actorKeycloakId: "kc-newadmin",
      actorEmail: "admin@csquared.com",
      actorName: "New Admin",
      action: "user.onboard",
      summary: "Onboarded someone",
    })
    expect(tx.user.upsert).toHaveBeenCalledWith({
      where: { email: "admin@csquared.com" },
      update: { keycloakId: "kc-newadmin" },
      create: { keycloakId: "kc-newadmin", email: "admin@csquared.com", name: "New Admin" },
      select: { id: true },
    })
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: "linked-id" }) })
    )
  })
})
