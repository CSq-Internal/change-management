// src/test/actions/users-authz.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-1', email: 'test@csquared.com', name: 'Test',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
}))

vi.mock('@/server/keycloak', () => ({
  createKeycloakUser: vi.fn().mockResolvedValue('kc-new'),
  assignToOrganization: vi.fn().mockResolvedValue(undefined),
  deactivateKeycloakUser: vi.fn().mockResolvedValue(undefined),
  reactivateKeycloakUser: vi.fn().mockResolvedValue(undefined),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }) },
  user: {
    create: vi.fn().mockResolvedValue({ id: 'user-new', keycloakId: 'kc-new' }),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue({
      id: 'target', keycloakId: 'kc-target',
      opcoAssignments: [{ opco: { slug: 'ghana' }, isActive: true }],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  userOpCoAssignment: {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(2),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { onboardUser, deactivateUser, reactivateUser, setUserAssignments } from '@/server/actions/users'
import { getAppSession } from '@/lib/session'

const groupAdmin = {
  keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA',
  organizations: [], realmRoles: ['group_admin'],
}
const ghanaAdmin = {
  keycloakId: 'kc-gha', email: 'gha@csquared.com', name: 'GhA',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [],
}

describe("onboardUser — authorization & ceiling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })

  it("rejects a non-admin (ghana/requester) onboarding a user", async () => {
    await expect(onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("rejects an OpCo admin trying to grant the admin role", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "admin" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_admin create a brand-new user and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const result = await onboardUser({
      name: "New", email: "new@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(result).toHaveProperty("id", "user-new")
    expect(mockDb.user.create).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("links an existing email instead of creating a new identity", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findFirst.mockResolvedValueOnce({ id: "existing", keycloakId: "kc-existing" })
    await onboardUser({
      name: "Existing", email: "exists@csquared.com", tempPassword: "p",
      assignments: [{ opcoSlug: "ghana", role: "approver" }],
    })
    expect(mockDb.user.create).not.toHaveBeenCalled()
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })
})

describe('deactivateUser — authorization', () => {
  it('rejects a non-admin caller', async () => {
    await expect(deactivateUser('target')).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_admin to deactivate', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(deactivateUser('target')).resolves.toBeUndefined()
  })

  it('allows a ghana admin to deactivate a ghana-only user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(deactivateUser('target')).resolves.toBeUndefined()
  })
})

describe('deactivateUser — self-lockout', () => {
  it('rejects deactivating yourself', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-self', email: 's@csquared.com', name: 'S',
      organizations: [{ id: 'o', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
      realmRoles: [],
    })
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'self', keycloakId: 'kc-self',
      opcoAssignments: [{ opco: { slug: 'ghana' }, isActive: true }],
    })
    await expect(deactivateUser('self')).rejects.toThrow(/yourself/)
  })
})

describe('reactivateUser — authorization', () => {
  const inactiveTarget = {
    id: 'target', keycloakId: 'kc-target', isActive: false,
    opcoAssignments: [{ opco: { slug: 'ghana' } }],
  }
  it('rejects a non-admin caller', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).rejects.toThrow(/Forbidden/)
  })
  it('allows a group_admin to reactivate', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).resolves.toBeUndefined()
  })
  it('allows a ghana admin to reactivate a ghana user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await expect(reactivateUser('target')).resolves.toBeUndefined()
  })
})

describe("deactivateUser — last-admin guard & audit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })

  it("blocks deactivating the last admin of an OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: "target", keycloakId: "kc-target",
      opcoAssignments: [{ role: "admin", isActive: true, opco: { slug: "ghana", id: "opco-gh" } }],
    })
    mockDb.userOpCoAssignment.count.mockResolvedValueOnce(0) // no OTHER active admins
    await expect(deactivateUser("target")).rejects.toThrow(/last admin/i)
  })

  it("allows deactivation when another admin remains, and writes audit", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: "target", keycloakId: "kc-target",
      opcoAssignments: [{ role: "admin", isActive: true, opco: { slug: "ghana", id: "opco-gh" } }],
    })
    mockDb.userOpCoAssignment.count.mockResolvedValueOnce(1)
    await deactivateUser("target")
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe('setUserAssignments — authorization & diff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.user.findUnique.mockResolvedValue({ id: 'target', keycloakId: 'kc-target' })
  })

  it('rejects a ghana admin changing a uganda assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    await expect(
      setUserAssignments('target', [{ opcoSlug: 'uganda', role: 'requester' }])
    ).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_admin to add an assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: 'opco-gh', slug: 'ghana' })
    await setUserAssignments('target', [{ opcoSlug: 'ghana', role: 'approver' }])
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })

  it('does not require rights for unchanged out-of-scope assignments', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: 'ghana', id: 'opco-gh' }, role: 'requester' },
      { opco: { slug: 'uganda', id: 'opco-ug' }, role: 'approver' },
    ])
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: 'opco-gh', slug: 'ghana' })
    await setUserAssignments('target', [
      { opcoSlug: 'ghana', role: 'approver' },
      { opcoSlug: 'uganda', role: 'approver' },
    ])
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
  })

  it('rejects removing your own admin assignment', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin) // keycloakId kc-gha
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'self', keycloakId: 'kc-gha' })
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: 'ghana', id: 'opco-gh' }, role: 'admin' },
    ])
    await expect(
      setUserAssignments('self', [{ opcoSlug: 'ghana', role: 'requester' }])
    ).rejects.toThrow(/own admin/)
  })

  it('rejects duplicate opco slugs', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(
      setUserAssignments('target', [
        { opcoSlug: 'ghana', role: 'admin' },
        { opcoSlug: 'ghana', role: 'requester' },
      ])
    ).rejects.toThrow(/Duplicate/)
  })

  it("rejects an OpCo admin promoting someone to admin (ceiling)", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: "ghana", id: "opco-gh" }, role: "requester" },
    ])
    await expect(
      setUserAssignments("target", [{ opcoSlug: "ghana", role: "admin" }])
    ).rejects.toThrow(/Forbidden/)
  })

  it("writes an audit row when a group_admin changes a role", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: "ghana", id: "opco-gh" }, role: "requester" },
    ])
    mockDb.opCo.findUnique.mockResolvedValueOnce({ id: "opco-gh", slug: "ghana" })
    await setUserAssignments("target", [{ opcoSlug: "ghana", role: "approver" }])
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("blocks demoting the last admin of an OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "other", keycloakId: "kc-other" })
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { opco: { slug: "ghana", id: "opco-gh" }, role: "admin" },
    ])
    mockDb.userOpCoAssignment.count.mockResolvedValueOnce(0)
    await expect(
      setUserAssignments("other", [{ opcoSlug: "ghana", role: "requester" }])
    ).rejects.toThrow(/last admin/i)
  })
})
