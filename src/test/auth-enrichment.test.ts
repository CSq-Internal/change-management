import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.fn()

vi.mock('@/server/db', () => ({
  getPrisma: () => ({ userOpCoAssignment: { findMany } }),
}))

import { enrichedJwt, sessionFromToken } from '@/lib/auth-callbacks'

describe('auth enrichment', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('maps DB OpCo assignments into session.user.organizations on sign-in', async () => {
    findMany.mockResolvedValue([
      { role: 'admin', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account: { provider: 'keycloak', type: 'oidc', providerAccountId: 'x', access_token: 'at' },
      profile: { sub: 'kc-sub-1', realm_access: { roles: ['group_admin'] } },
    })

    expect(token.keycloakId).toBe('kc-sub-1')
    expect(token.realmRoles).toEqual(['group_admin'])
    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['admin'] },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { keycloakId: 'kc-sub-1' } },
      include: { opco: true },
    })

    const session = sessionFromToken({
      // @ts-expect-error partial session shape is sufficient for the callback
      session: { user: {} },
      token,
    })
    expect(session.user.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['admin'] },
    ])
    expect(session.user.keycloakId).toBe('kc-sub-1')
    expect(session.user.realmRoles).toEqual(['group_admin'])
  })

  it('does not query the DB when account is absent (token refresh)', async () => {
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: ['group_admin'] },
      user: {},
      account: null,
      profile: undefined,
    })

    expect(findMany).not.toHaveBeenCalled()
    expect(token.organizations).toEqual([])
  })
})
