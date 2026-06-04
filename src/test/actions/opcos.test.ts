// src/test/actions/opcos.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-gha",
    email: "gha@t.co",
    name: "Ghana Admin",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    realmRoles: [],
  }),
}))

vi.mock("@/server/keycloak", () => ({
  createKeycloakOrg: vi.fn().mockResolvedValue("kc-org-1"),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "opco-new", slug: "kenya" }),
    update: vi.fn().mockResolvedValue({ id: "opco-1" }),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { createOpCo } from "@/server/actions/opcos"
import { getAppSession } from "@/lib/session"
import { createKeycloakOrg } from "@/server/keycloak"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@t.co", name: "GA", organizations: [], realmRoles: ["group_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.opCo.findUnique.mockResolvedValue(null)
  vi.mocked(createKeycloakOrg).mockResolvedValue("kc-org-1")
})

describe("createOpCo", () => {
  it("rejects a non-group_admin (even an OpCo admin)", async () => {
    await expect(createOpCo({ slug: "kenya", name: "Kenya" })).rejects.toThrow(/Forbidden/)
  })

  it("rejects a slug that already exists", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-x", slug: "kenya" })
    await expect(createOpCo({ slug: "kenya", name: "Kenya" })).rejects.toThrow(/already exists/i)
  })

  it("creates an OpCo with the Keycloak org id and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await createOpCo({ slug: "kenya", name: "Kenya" })
    expect(mockDb.opCo.create).toHaveBeenCalledWith({
      data: { slug: "kenya", name: "Kenya", locale: "en", keycloakOrgId: "kc-org-1" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("falls back to a placeholder keycloakOrgId when Keycloak is unavailable", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    vi.mocked(createKeycloakOrg).mockRejectedValueOnce(new Error("no keycloak"))
    await createOpCo({ slug: "kenya", name: "Kenya", locale: "sw" })
    expect(mockDb.opCo.create).toHaveBeenCalledWith({
      data: { slug: "kenya", name: "Kenya", locale: "sw", keycloakOrgId: "pending-keycloak-kenya" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
