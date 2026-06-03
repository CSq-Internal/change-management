// src/test/actions/users-authz.test.ts
import { describe, it, expect, vi } from 'vitest'

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
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }) },
  user: {
    create: vi.fn().mockResolvedValue({ id: 'user-new', keycloakId: 'kc-new' }),
    findUnique: vi.fn().mockResolvedValue({
      id: 'target', keycloakId: 'kc-target',
      opcoAssignments: [{ opco: { slug: 'ghana' }, isActive: true }],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  userOpCoAssignment: {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { createUser, deactivateUser, reactivateUser } from '@/server/actions/users'
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

describe('createUser — authorization', () => {
  it('rejects a non-admin (ghana/requester) creating a user', async () => {
    await expect(createUser({
      name: 'New', email: 'new@csquared.com', tempPassword: 'p',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })).rejects.toThrow(/Forbidden/)
  })

  it('rejects a ghana admin assigning a user to uganda', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(createUser({
      name: 'New', email: 'new@csquared.com', tempPassword: 'p',
      assignments: [{ opcoSlug: 'uganda', role: 'requester' }],
    })).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_admin to create a user', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const result = await createUser({
      name: 'New', email: 'new@csquared.com', tempPassword: 'p',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })
    expect(result).toHaveProperty('id', 'user-new')
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
