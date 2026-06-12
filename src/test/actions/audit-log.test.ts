import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-ghr",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  opCo: { findMany: vi.fn().mockResolvedValue([{ id: "opco-gh", slug: "ghana" }]), findUnique: vi.fn() },
  adminAuditLog: {
    findMany: vi.fn().mockResolvedValue([
      { id: "a1", actor: { id: "u1", name: "GA", email: "ga@csquared.com" }, action: "role.update", summary: "x", opcoId: "opco-gh", at: new Date("2026-06-01T00:00:00Z") },
    ]),
  },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { listAdminAudit } from "@/server/actions/audit-log"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }
const groupAuditor = { keycloakId: "kc-gaud", email: "gaud@t.co", name: "Gaud", organizations: [], realmRoles: ["group_auditor"] }
const ghanaAdmin = { keycloakId: "kc-gha", email: "gha@t.co", name: "GhA", organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }], realmRoles: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.opCo.findMany.mockResolvedValue([{ id: "opco-gh", slug: "ghana" }])
  mockDb.adminAuditLog.findMany.mockResolvedValue([
    { id: "a1", actor: { id: "u1", name: "GA", email: "ga@csquared.com" }, action: "role.update", summary: "x", opcoId: "opco-gh", at: new Date("2026-06-01T00:00:00Z") },
  ])
})

describe("listAdminAudit", () => {
  it("rejects a plain requester", async () => {
    await expect(listAdminAudit({})).rejects.toThrow(/Forbidden/)
  })

  it("returns all entries for a group_admin (no opco scope) and serializes rows", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const rows = await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toBeUndefined()
    expect(rows[0]).toEqual({
      id: "a1", actorEmail: "ga@csquared.com", action: "role.update",
      summary: "x", opcoSlug: "ghana", at: "2026-06-01T00:00:00.000Z",
    })
  })

  it("lets a group_auditor read (no opco scope)", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAuditor)
    await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toBeUndefined()
  })

  it("scopes an OpCo admin to their managed OpCo ids", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await listAdminAudit({})
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.opcoId).toEqual({ in: ["opco-gh"] })
  })

  it("applies the action filter", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await listAdminAudit({ action: "user.deactivate" })
    const where = mockDb.adminAuditLog.findMany.mock.calls[0][0].where
    expect(where.action).toBe("user.deactivate")
  })
})
