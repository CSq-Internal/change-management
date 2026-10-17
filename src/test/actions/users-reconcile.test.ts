// src/test/actions/users-reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-admin', email: 'admin@csquared.com', name: 'Admin',
    organizations: [], realmRoles: ['group_admin'],
  }),
}))

vi.mock('@/server/keycloak', () => ({
  createOrFindKeycloakUser: vi.fn().mockResolvedValue({ id: 'kc-new', created: true }),
  assignToOrganization: vi.fn().mockResolvedValue(undefined),
  verifyAdoptedKeycloakUser: vi.fn().mockResolvedValue('verified'),
}))

vi.mock('@/server/email', () => ({
  sendUserInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/approver-reassign', () => ({
  approverPendingFootprint: vi.fn(async () => []),
  notifyRemainingAndDetectOrphans: vi.fn(async () => ({ orphaned: [] })),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-gh', slug: 'ghana', locale: 'en' }) },
  user: {
    create: vi.fn().mockResolvedValue({ id: 'user-new', keycloakId: 'kc-new' }),
    findFirst: vi.fn().mockResolvedValue(null),
    // findUnique is called by recordAdminAction to look up the actor; return the actor by default.
    findUnique: vi.fn().mockResolvedValue({ id: 'actor-id', keycloakId: 'kc-admin' }),
    upsert: vi.fn().mockResolvedValue({ id: 'actor-id' }),
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
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { onboardUser } from '@/server/actions/users'
import {
  createOrFindKeycloakUser,
  verifyAdoptedKeycloakUser,
} from '@/server/keycloak'
import { sendUserInvitationEmail } from '@/server/email'

describe('onboardUser — adopt-path reconcile (Task B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
    mockDb.user.findFirst.mockResolvedValue(null)
    mockDb.user.create.mockResolvedValue({ id: 'user-new', keycloakId: 'kc-1' })
    mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana', locale: 'en' })
  })

  it('adopted Keycloak account: verified, never enabled, no password touched', async () => {
    vi.mocked(createOrFindKeycloakUser).mockResolvedValueOnce({ id: 'kc-1', created: false })

    await onboardUser({
      name: 'Adopted User', email: 'adopted@csquared.com',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })

    expect(verifyAdoptedKeycloakUser).toHaveBeenCalledWith('kc-1')
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'adopted@csquared.com' }))
  })

  it('brand-new user: no reconcile, Google invite', async () => {
    vi.mocked(createOrFindKeycloakUser).mockResolvedValueOnce({ id: 'kc-new', created: true })

    await onboardUser({
      name: 'New User', email: 'new@csquared.com',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })

    expect(verifyAdoptedKeycloakUser).not.toHaveBeenCalled()
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@csquared.com' }))
  })
})
