import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.fn()
const userCreate = vi.fn()
const userUpdate = vi.fn()
const userUpdateMany = vi.fn()
const findMany = vi.fn()

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    user: { findUnique: userFindUnique, create: userCreate, update: userUpdate, updateMany: userUpdateMany },
    userOpCoAssignment: { findMany },
  }),
}))

import { enrichedJwt, sessionFromToken } from '@/lib/auth-callbacks'

const account = { provider: 'keycloak', type: 'oidc', providerAccountId: 'x', access_token: 'at' } as const

// The reconcile block makes two findUnique calls: first by keycloakId (the incoming sub),
// then — only if that misses — by email. Route the mock by which key the query uses.
function mockUsers({ bySub = null, byEmail = null }: { bySub?: unknown; byEmail?: unknown }) {
  userFindUnique.mockImplementation(async ({ where }: { where: { keycloakId?: string; email?: string } }) =>
    where.keycloakId ? bySub : byEmail
  )
}

describe('auth enrichment', () => {
  beforeEach(() => {
    process.env.KEYCLOAK_CLIENT_ID = 'csquared-cms'
    userFindUnique.mockReset()
    userCreate.mockReset()
    userUpdate.mockReset()
    userUpdateMany.mockReset()
    findMany.mockReset()
    mockUsers({})
  })

  it('maps DB OpCo assignments into session.user.organizations on sign-in', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([
      { role: 'admin', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })

    expect(token.keycloakId).toBe('kc-sub-1')
    expect(token.realmRoles).toEqual(['group_admin'])
    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['admin'] },
    ])
    expect(userCreate).not.toHaveBeenCalled() // already linked by sub
    expect(userUpdate).not.toHaveBeenCalled()
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

  it('inherits the profile picture claim into session.user.image', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, picture: 'https://lh3.googleusercontent.com/a/abc', resource_access: { 'csquared-cms': { roles: [] } } },
    })
    expect(token.picture).toBe('https://lh3.googleusercontent.com/a/abc')

    const session = sessionFromToken({
      // @ts-expect-error partial session shape is sufficient for the callback
      session: { user: {} },
      token,
    })
    expect(session.user.image).toBe('https://lh3.googleusercontent.com/a/abc')
  })

  it('sets session.user.image to null when the picture claim is absent', () => {
    const session = sessionFromToken({
      // @ts-expect-error partial session shape is sufficient for the callback
      session: { user: {} },
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: [] },
    })
    expect(session.user.image).toBeNull()
  })

  it('relinks a pre-provisioned row to the real Keycloak sub by verified email', async () => {
    mockUsers({ bySub: null, byEmail: { id: 'seed-row' } }) // seed placeholder row exists by email
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'devops@csquared.com', email_verified: true, name: 'Dev Admin' },
    })

    expect(userUpdate).toHaveBeenCalledWith({
      where: { email: 'devops@csquared.com' },
      data: { keycloakId: 'real-sub-123' },
    })
    expect(userCreate).not.toHaveBeenCalled()
    // assignments are then loaded by the (now-linked) sub
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { keycloakId: 'real-sub-123' } },
      include: { opco: true },
    })
  })

  it('seeds User.locale from the profile.locale claim when creating a new row', async () => {
    mockUsers({ bySub: null, byEmail: null })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'sub-fr', email: 'pierre@csquared.com', email_verified: true, name: 'Pierre', locale: 'fr' },
    })
    expect(userCreate).toHaveBeenCalledWith({
      data: { keycloakId: 'sub-fr', email: 'pierre@csquared.com', name: 'Pierre', locale: 'fr' },
    })
  })

  it('defaults locale to en when the claim is absent', async () => {
    mockUsers({ bySub: null, byEmail: null })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'sub-x', email: 'sam@csquared.com', email_verified: true, name: 'Sam' },
    })
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locale: 'en' }) })
    )
  })

  it('creates a brand-new row even when email_verified is false (brokered Google)', async () => {
    mockUsers({ bySub: null, byEmail: null }) // no row by sub, none by email → brand-new identity
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'real-sub-123', email: 'eessel@csquared.com', email_verified: false, name: 'E Essel' },
    })

    expect(userCreate).toHaveBeenCalledWith({
      data: { keycloakId: 'real-sub-123', email: 'eessel@csquared.com', name: 'E Essel', locale: 'en' },
    })
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('does NOT relink an existing row when the email is unverified (takeover guard)', async () => {
    mockUsers({ bySub: null, byEmail: { id: 'victim-row' } }) // a privileged row already owns this email
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'attacker-sub', email: 'admin@csquared.com', email_verified: false },
    })

    expect(userUpdate).not.toHaveBeenCalled()
    expect(userCreate).not.toHaveBeenCalled()
  })

  it('does NOT link/create when no email is present', async () => {
    mockUsers({ bySub: null, byEmail: null })
    findMany.mockResolvedValue([])

    await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'no-email-sub' },
    })

    expect(userCreate).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('reads group roles from the csquared-cms client roles and ignores realm roles', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: {
        sub: 'kc-sub-1',
        email: 'devops@csquared.com',
        email_verified: true,
        // realm_access MUST be ignored; only the client's resource_access counts
        realm_access: { roles: ['group_admin'] },
        resource_access: { 'csquared-cms': { roles: ['group_auditor'] } },
      },
    })

    expect(token.realmRoles).toEqual(['group_auditor'])
  })

  it('marks isGroupAdmin true when the token carries the group_admin client role', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'ga@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-1' }, data: { isGroupAdmin: true } })
  })

  it('clears isGroupAdmin (false) when the token has no group_admin role', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-2' } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-2', email: 'member@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: [] } } },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-2' }, data: { isGroupAdmin: false } })
  })

  it('does not query the DB when account is absent (token refresh)', async () => {
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: ['group_admin'], orgsRefreshedAt: Date.now() },
      user: {},
      account: null,
      profile: undefined,
    })

    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userCreate).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
    expect(token.organizations).toEqual([])
  })

  it('re-enriches organizations from the DB when the token is stale and there is no account', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([
      { role: 'approver', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      // no account → token-refresh path
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: 1 }, // stale (epoch 1ms)
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { keycloakId: 'kc-sub-1' } },
      include: { opco: true },
    })
    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['approver'] },
    ])
    expect(typeof token.orgsRefreshedAt).toBe('number')
    expect(token.orgsRefreshedAt).toBeGreaterThan(1)
  })

  it('does NOT hit the DB on a fresh token refresh (within TTL)', async () => {
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: Date.now() },
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(findMany).not.toHaveBeenCalled()
    expect(token.keycloakId).toBe('kc-sub-1')
  })

  it('stamps orgsRefreshedAt on sign-in', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: [] } } },
    })

    expect(typeof token.orgsRefreshedAt).toBe('number')
  })
})
