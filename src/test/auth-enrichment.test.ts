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
  // Rows default to active, as the column does; a test passes isActive: false to override.
  const active = (row: unknown) => (row ? { isActive: true, ...(row as object) } : null)
  userFindUnique.mockImplementation(async ({ where }: { where: { keycloakId?: string; email?: string } }) =>
    where.keycloakId ? active(bySub) : active(byEmail)
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
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })
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

  it('takes group roles from the DB flags, not the token', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAuditor: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(token.realmRoles).toEqual(['group_auditor'])
  })

  it('gives no group role to a row without a flag, whatever Keycloak sends', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'x@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })
    expect(token.realmRoles).toEqual([])
  })

  it('carries the flags of a row relinked by verified email', async () => {
    mockUsers({ bySub: null, byEmail: { id: 'u1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-new', email: 'devops@csquared.com', email_verified: true },
    })
    expect(userUpdate).toHaveBeenCalledWith({ where: { email: 'devops@csquared.com' }, data: { keycloakId: 'kc-new' } })
    expect(token.realmRoles).toEqual(['group_admin'])
  })

  it('no longer writes isGroupAdmin at sign-in, only the IdP name', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'kc-sub-1', email: 'ga@csquared.com', email_verified: true, name: 'Ama Mensah' },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({ where: { keycloakId: 'kc-sub-1' }, data: { name: 'Ama Mensah' } })
  })

  it('picks up a group-role grant on the refresh', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isGroupAdmin: true } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: [], orgsRefreshedAt: 0 },
      user: {}, account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])
    expect(token.realmRoles).toEqual(['group_admin'])
  })

  it('drops a revoked group role on the refresh', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], realmRoles: ['group_admin'], orgsRefreshedAt: 0 },
      user: {}, account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])
    expect(token.realmRoles).toEqual([])
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

  it('flags the token orphaned (not null) when the stale sub maps to no DB user', async () => {
    mockUsers({ bySub: null }) // no row for this sub anymore
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: { keycloakId: 'kc-gone', organizations: [{ id: 'o', name: 'x', alias: 'x', roles: ['admin'] }], orgsRefreshedAt: 1 },
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    // must NOT return null (that loops against the edge proxy); flags instead
    expect(token).not.toBeNull()
    expect(token.orphaned).toBe(true)
    expect(token.organizations).toEqual([])
    expect(findMany).not.toHaveBeenCalled() // no point loading orgs for a gone user
  })

  it('flags a deactivated user orphaned on refresh and drops their roles', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isActive: false } })
    findMany.mockResolvedValue([{ role: 'admin', opco: { id: 'o', name: 'Ghana', slug: 'ghana' } }])

    const token = await enrichedJwt({
      token: {
        keycloakId: 'kc-sub-1', realmRoles: ['group_admin'], orgsRefreshedAt: 1,
        organizations: [{ id: 'o', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
      },
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(token.orphaned).toBe(true)
    expect(token.organizations).toEqual([])
    expect(token.realmRoles).toEqual([])
  })

  it('flags a deactivated user orphaned at sign-in, whatever roles Keycloak sends', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1', isActive: false } })
    findMany.mockResolvedValue([{ role: 'admin', opco: { id: 'o', name: 'Ghana', slug: 'ghana' } }])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'gone@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
    })

    expect(token.orphaned).toBe(true)
    expect(token.organizations).toEqual([])
    expect(token.realmRoles).toEqual([])
  })

  it('clears the orphaned flag when the stale sub still maps to a DB user', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: 1, orphaned: true },
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(token.orphaned).toBe(false)
    expect(findMany).toHaveBeenCalled()
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

  it('re-enriches organizations on a session update even inside the TTL', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([
      { role: 'requester', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: Date.now() }, // fresh
      user: {},
      account: null,
      trigger: 'update',
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['requester'] },
    ])
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

  it('keeps the sign-in ID token so Log out can end the Keycloak session', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account: { ...account, id_token: 'id.jwt.sig' },
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: [] } } },
    })

    expect(token.idToken).toBe('id.jwt.sig')
  })
})
