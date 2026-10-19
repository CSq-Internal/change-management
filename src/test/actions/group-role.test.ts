import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getAppSession: vi.fn() }))
vi.mock('@/server/keycloak', () => ({}))
vi.mock('@/server/email', () => ({ sendUserInvitationEmail: vi.fn() }))
vi.mock('@/server/approver-reassign', () => ({
  approverPendingFootprint: vi.fn(async () => []),
  notifyRemainingAndDetectOrphans: vi.fn(async () => ({ orphaned: [] })),
}))

const mockDb = {
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn(async () => ({})), count: vi.fn(async () => 1), upsert: vi.fn() },
  userOpCoAssignment: { updateMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []), count: vi.fn(async () => 1) },
  cABMembership: { updateMany: vi.fn(async () => ({})) },
  approverAssignment: { updateMany: vi.fn(async () => ({})) },
  adminAuditLog: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { setGroupRole, deactivateUser } from '@/server/actions/users'
import { getAppSession } from '@/lib/session'

const groupAdmin = { keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA', organizations: [], realmRoles: ['group_admin'] }
const ghanaAdmin = {
  keycloakId: 'kc-gha', email: 'gha@csquared.com', name: 'GhA',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [],
}
const target = (extra = {}) => ({
  id: 'target', keycloakId: 'kc-target', isActive: true, isGroupAdmin: false, isGroupAuditor: false, opcoAssignments: [], ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
  mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; keycloakId?: string } }) =>
    where.keycloakId ? { id: 'actor' } : target())
  mockDb.user.count.mockResolvedValue(1)
  vi.mocked(getAppSession).mockResolvedValue(groupAdmin as never)
})

describe('setGroupRole', () => {
  it('grants group_auditor, clears group_admin, and audits from → to', async () => {
    await setGroupRole('target', 'group_auditor')
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'target' }, data: { isGroupAdmin: false, isGroupAuditor: true },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'user.group_role', targetUserId: 'target',
        summary: 'Group role: none → group_auditor', metadata: { from: null, to: 'group_auditor' },
      }),
    }))
  })

  it('runs in a Serializable transaction', async () => {
    await setGroupRole('target', 'group_admin')
    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' })
  })

  it('writes nothing when the role is unchanged', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isGroupAdmin: true }) : { id: 'actor' })
    await setGroupRole('target', 'group_admin')
    expect(mockDb.user.update).not.toHaveBeenCalled()
    expect(mockDb.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not a group admin', async () => {
    vi.mocked(getAppSession).mockResolvedValue(ghanaAdmin as never)
    await expect(setGroupRole('target', 'group_auditor')).rejects.toThrow(/^Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses changing your own group role', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ keycloakId: 'kc-ga', isGroupAdmin: true }) : { id: 'actor' })
    await expect(setGroupRole('target', null)).rejects.toThrow(/Forbidden: cannot change your own group role/)
  })

  it('refuses removing the last active group admin', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isGroupAdmin: true }) : { id: 'actor' })
    mockDb.user.count.mockResolvedValue(0)
    await expect(setGroupRole('target', 'group_auditor')).rejects.toThrow(/last active group admin/)
    expect(mockDb.user.count).toHaveBeenCalledWith({
      where: { isGroupAdmin: true, isActive: true, id: { not: 'target' } },
    })
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an inactive target', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? target({ isActive: false }) : { id: 'actor' })
    await expect(setGroupRole('target', 'group_admin')).rejects.toThrow(/deactivated/)
  })

  it('refuses an unknown role value', async () => {
    await expect(setGroupRole('target', 'superuser' as never)).rejects.toThrow(/Invalid group role/)
  })
})

describe('deactivate / reactivate with group roles', () => {
  it('refuses deactivating the last active group admin', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(target({ isGroupAdmin: true }))
    mockDb.user.count.mockResolvedValue(0)
    await expect(deactivateUser('target')).rejects.toThrow(/last active group admin/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('refuses an OpCo admin deactivating a group auditor', async () => {
    // Ghana admin holds the right for the Ghana role, so only the auditor flag can refuse it.
    vi.mocked(getAppSession).mockResolvedValue(ghanaAdmin as never)
    mockDb.user.findUnique.mockResolvedValueOnce(target({
      isGroupAuditor: true,
      opcoAssignments: [{ id: 'a-gh', role: 'approver', isActive: true, opco: { slug: 'ghana', id: 'opco-ghana' } }],
    }))
    await expect(deactivateUser('target')).rejects.toThrow(/^Forbidden/)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })
})
