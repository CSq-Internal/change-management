// src/test/actions/users-authz.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-1', email: 'test@csquared.com', name: 'Test',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
}))

// Hoisted so tests can assert the realm is never touched: Keycloak is shared with other
// apps, so CMS deactivation must not disable (or re-enable) the account itself.
const kc = vi.hoisted(() => ({
  createOrFindKeycloakUser: vi.fn().mockResolvedValue({ id: 'kc-new', created: true }),
  verifyAdoptedKeycloakUser: vi.fn().mockResolvedValue('verified'),
}))
vi.mock('@/server/keycloak', () => kc)

vi.mock('@/server/email', () => ({
  sendUserInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/approver-reassign', () => ({
  approverPendingFootprint: vi.fn(async () => []),
  notifyRemainingAndDetectOrphans: vi.fn(async () => ({ orphaned: [] })),
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
  cABMembership: { updateMany: vi.fn(async () => ({})) },
  approverAssignment: { updateMany: vi.fn(async () => ({})) },
  changeRequest: { findMany: vi.fn().mockResolvedValue([]) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { onboardUser, deactivateUser, reactivateUser, setUserAssignments, listOpCoApprovers, listCabEligible } from '@/server/actions/users'
import { getAppSession } from '@/lib/session'
import { createOrFindKeycloakUser } from '@/server/keycloak'
import { sendUserInvitationEmail } from '@/server/email'

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
      name: "New", email: "new@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("rejects an OpCo admin trying to grant the admin role", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(onboardUser({
      name: "New", email: "new@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "admin" }],
    })).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_admin create a brand-new user and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const result = await onboardUser({
      name: "New", email: "new@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(result).toHaveProperty("id", "user-new")
    expect(mockDb.user.create).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
    expect(sendUserInvitationEmail).toHaveBeenCalledWith({
      to: "new@csquared.com",
      name: "New",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
      locale: "en",
    })
    expect(createOrFindKeycloakUser).toHaveBeenCalledWith("new@csquared.com", "New")
  })

  it("localizes the invitation email by the first assignment's OpCo locale", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.opCo.findUnique.mockResolvedValue({ id: "opco-gh", slug: "ghana", locale: "fr" })
    await onboardUser({
      name: "Fr User", email: "fr@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "fr@csquared.com", locale: "fr" })
    )
  })

  it("links an existing email instead of creating a new identity", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findFirst.mockResolvedValueOnce({ id: "existing", keycloakId: "kc-existing", isActive: true })
    await onboardUser({
      name: "Existing", email: "exists@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "approver" }],
    })
    expect(mockDb.user.create).not.toHaveBeenCalled()
    expect(mockDb.userOpCoAssignment.upsert).toHaveBeenCalledTimes(1)
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "exists@csquared.com" })
    )
  })

  it("links a Keycloak-only existing email instead of creating a new identity", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    vi.mocked(createOrFindKeycloakUser).mockResolvedValueOnce({ id: "kc-existing", created: false })
    await onboardUser({
      name: "Keycloak Existing", email: "kc-exists@csquared.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(mockDb.user.create).toHaveBeenCalledWith({
      data: { keycloakId: "kc-existing", email: "kc-exists@csquared.com", name: "Keycloak Existing" },
    })
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "kc-exists@csquared.com" })
    )
  })

  it("refuses an address outside @csquared.com before touching Keycloak", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(onboardUser({
      name: "Partner", email: "pat@partner.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })).rejects.toThrow("Only @csquared.com addresses can be onboarded.")
    expect(createOrFindKeycloakUser).not.toHaveBeenCalled()
    expect(mockDb.user.create).not.toHaveBeenCalled()
  })

  it("onboards a CSquared address typed with capitals or spaces, stored as Google will send it", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await onboardUser({
      name: "New", email: "New@CSquared.com ",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({ where: { email: "new@csquared.com" } })
    expect(createOrFindKeycloakUser).toHaveBeenCalledWith("new@csquared.com", "New")
    expect(mockDb.user.create).toHaveBeenCalledWith({
      data: { keycloakId: "kc-new", email: "new@csquared.com", name: "New" },
    })
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "new@csquared.com" }))
  })
})

describe('deactivateUser — authorization', () => {
  it('rejects a non-admin caller', async () => {
    await expect(deactivateUser('target')).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_admin to deactivate', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(deactivateUser('target')).resolves.toEqual({ orphanedChanges: [] })
  })

  it('allows a ghana admin to deactivate a ghana-only user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(deactivateUser('target')).resolves.toEqual({ orphanedChanges: [] })
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
  const inactiveTarget = { id: 'target', keycloakId: 'kc-target', isActive: false, isGroupAdmin: false }
  const lastDeactivation = (ids: string[]) =>
    mockDb.adminAuditLog.findFirst.mockResolvedValueOnce({ metadata: { endedAssignmentIds: ids } })
  const endedRows = (rows: Array<{ id: string; role: string; slug: string }>) =>
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce(
      rows.map((r) => ({ id: r.id, role: r.role, opco: { slug: r.slug } })),
    )
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })

  it('rejects a non-admin caller', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    lastDeactivation(['a-gh'])
    endedRows([{ id: 'a-gh', role: 'approver', slug: 'ghana' }])
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
    lastDeactivation(['a-gh'])
    endedRows([{ id: 'a-gh', role: 'approver', slug: 'ghana' }])
    await expect(reactivateUser('target')).resolves.toBeUndefined()
  })

  it('refuses a user who is already active', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce({ ...inactiveTarget, isActive: true })
    await expect(reactivateUser('target')).rejects.toThrow(/already active/i)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('restores only the roles the last deactivation ended', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    lastDeactivation(['a-gh'])
    endedRows([{ id: 'a-gh', role: 'approver', slug: 'ghana' }])
    await reactivateUser('target')
    expect(mockDb.adminAuditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { action: 'user.deactivate', targetUserId: 'target' }, orderBy: { at: 'desc' },
    }))
    expect(mockDb.userOpCoAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a-gh'] }, userId: 'target' },
      data: { isActive: true, endedAt: null },
    })
  })

  it('restores no roles when the deactivation recorded none (older deactivations)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    mockDb.adminAuditLog.findFirst.mockResolvedValueOnce({ metadata: null })
    await reactivateUser('target')
    expect(mockDb.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { isActive: true } })
    expect(mockDb.userOpCoAssignment.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['a role in an OpCo they do not manage', [{ id: 'a-gh', role: 'approver', slug: 'ghana' }, { id: 'a-ng', role: 'approver', slug: 'nigeria' }]],
    ['the admin role, which OpCo admins cannot grant', [{ id: 'a-gh', role: 'admin', slug: 'ghana' }]],
    ['nothing at all', []],
  ])('refuses an OpCo admin when it would restore %s', async (_label, rows) => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    lastDeactivation(rows.map((r) => r.id))
    if (rows.length) endedRows(rows) // with no ids the lookup never runs; a queued value would leak
    await expect(reactivateUser('target')).rejects.toThrow(/Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an OpCo admin reactivating a group admin', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce({ ...inactiveTarget, isGroupAdmin: true })
    lastDeactivation(['a-gh'])
    endedRows([{ id: 'a-gh', role: 'approver', slug: 'ghana' }])
    await expect(reactivateUser('target')).rejects.toThrow(/Forbidden/)
  })

  it('leaves the Keycloak account alone', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(inactiveTarget)
    await reactivateUser('target')
    for (const fn of Object.values(kc)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('deactivateUser — scope', () => {
  const target = (assignments: Array<{ id: string; slug: string; role?: string }>, extra = {}) => ({
    id: 'target', keycloakId: 'kc-target', isGroupAdmin: false, ...extra,
    opcoAssignments: assignments.map((a) => ({
      id: a.id, role: a.role ?? 'approver', isActive: true, opco: { slug: a.slug, id: `opco-${a.slug}` },
    })),
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })

  it('refuses an OpCo admin when the user also holds a role in another OpCo', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(target([{ id: 'a-gh', slug: 'ghana' }, { id: 'a-ng', slug: 'nigeria' }]))
    await expect(deactivateUser('target')).rejects.toThrow(/Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an OpCo admin deactivating a group admin', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(target([{ id: 'a-gh', slug: 'ghana' }], { isGroupAdmin: true }))
    await expect(deactivateUser('target')).rejects.toThrow(/Forbidden/)
  })

  it('ends only the active roles and records which ones, for reactivation', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(target([{ id: 'a-gh', slug: 'ghana' }]))
    await deactivateUser('target')
    expect(mockDb.userOpCoAssignment.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target', isActive: true },
      data: { isActive: false, endedAt: expect.any(Date) },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'user.deactivate', metadata: { endedAssignmentIds: ['a-gh'] } }),
    })
  })

  it('leaves the Keycloak account alone', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findUnique.mockResolvedValueOnce(target([{ id: 'a-gh', slug: 'ghana' }]))
    await deactivateUser('target')
    for (const fn of Object.values(kc)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('onboardUser — accounts that are switched off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  })
  const invite = () => onboardUser({
    name: 'Ama', email: 'ama@csquared.com', assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
  })

  it('refuses to re-invite a deactivated CMS user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.user.findFirst.mockResolvedValueOnce({ id: 'u-ama', keycloakId: 'kc-ama', isActive: false })
    await expect(invite()).rejects.toThrow(/deactivated/i)
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
    expect(kc.verifyAdoptedKeycloakUser).not.toHaveBeenCalled()
  })

  it('refuses a Keycloak account that is disabled, and writes nothing', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    kc.createOrFindKeycloakUser.mockResolvedValueOnce({ id: 'kc-ama', created: false })
    kc.verifyAdoptedKeycloakUser.mockResolvedValueOnce('disabled')
    await expect(invite()).rejects.toThrow(/disabled/i)
    expect(mockDb.user.create).not.toHaveBeenCalled()
    expect(mockDb.userOpCoAssignment.upsert).not.toHaveBeenCalled()
    expect(sendUserInvitationEmail).not.toHaveBeenCalled()
  })

  it('verifies an adopted account that is enabled, then links it', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    kc.createOrFindKeycloakUser.mockResolvedValueOnce({ id: 'kc-ama', created: false })
    await invite()
    expect(kc.verifyAdoptedKeycloakUser).toHaveBeenCalledWith('kc-ama')
    expect(mockDb.user.create).toHaveBeenCalled()
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

describe("listOpCoApprovers", () => {
  it("rejects a non-admin for a per-OpCo request", async () => {
    await expect(listOpCoApprovers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a non-group_admin for a group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(listOpCoApprovers(null)).rejects.toThrow(/Forbidden/)
  })

  it("returns approver users for an OpCo admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { user: { id: "u1", name: "Ada", email: "ada@csquared.com" } },
    ])
    const approvers = await listOpCoApprovers("ghana")
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: "approver", isActive: true, opco: { slug: "ghana" } },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
    expect(approvers).toEqual([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
  })

  it("queries across all OpCos for a group_admin group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    await listOpCoApprovers(null)
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: "approver", isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
  })
})

describe("listCabEligible", () => {
  it("rejects a non-admin for a per-OpCo request", async () => {
    await expect(listCabEligible("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a non-group_admin for a group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(listCabEligible(null)).rejects.toThrow(/Forbidden/)
  })

  it("lists approver AND admin users for an OpCo admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { user: { id: "u1", name: "Ada", email: "ada@csquared.com" } },
    ])
    const eligible = await listCabEligible("ghana")
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: { in: ["approver", "admin"] }, isActive: true, opco: { slug: "ghana" } },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
    expect(eligible).toEqual([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
  })

  it("queries approver+admin across all OpCos for a group_admin group request", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([])
    await listCabEligible(null)
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { role: { in: ["approver", "admin"] }, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
  })
})
