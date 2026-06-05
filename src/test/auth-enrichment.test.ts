import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.fn()
const userUpsert = vi.fn()
const findMany = vi.fn()

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    user: { findUnique: userFindUnique, upsert: userUpsert },
    userOpCoAssignment: { findMany },
  }),
}))

import { enrichedJwt, sessionFromToken } from '@/lib/auth-callbacks'

const account = { provider: 'keycloak', type: 'oidc', providerAccountId: 'x', access_token: 'at' } as const

describe('auth enrichment', () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    userUpsert.mockReset()
    findMany.mockReset()
  })

  it('maps DB OpCo assignments into session.user.organizations on sign-in', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', keycloakId: 'kc-sub-1' })
    findMany.mockResolvedValue([
      { role: 'admin', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, realm_access: { roles: ['group_admin'] } },
    })

    expect(token.keycloakId).toBe('kc-sub-1')
    expect(token.realmRoles).toEqual(['group_admin'])
    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['admin'] },
    ])
    expect(userUpsert).not.toHaveBeenCalled() // already linked by sub
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

  it('links a pre-provisioned user to the real Keycloak sub by verified email', async () => {
    userFindUnique.mockResolvedValue(null) // no row matches the real sub yet (seed placeholder)
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'devops@csquared.com', email_verified: true, name: 'Dev Admin' },
    })

    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'devops@csquared.com' },
      update: { keycloakId: 'real-sub-123' },
      create: { keycloakId: 'real-sub-123', email: 'devops@csquared.com', name: 'Dev Admin' },
    })
    // assignments are then loaded by the (now-linked) sub
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { keycloakId: 'real-sub-123' } },
      include: { opco: true },
    })
  })

  it('does NOT link/create when the email is not verified', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'devops@csquared.com', email_verified: false },
    })

    expect(userUpsert).not.toHaveBeenCalled()
  })

  it('does not query the DB when account is absent (token refresh)', async () => {
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: ['group_admin'] },
      user: {},
      account: null,
      profile: undefined,
    })

    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userUpsert).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
    expect(token.organizations).toEqual([])
  })
})
