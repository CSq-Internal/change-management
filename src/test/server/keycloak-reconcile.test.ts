import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()

describe('keycloak reconcile helpers', () => {
  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER = 'https://id.example.com/realms/csquared'
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', fetchMock)
    // First call in each helper is getAdminToken → return a token.
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'admin-tok' }), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('getFederatedIdentities GETs the federated-identity endpoint and returns the list', async () => {
    const { getFederatedIdentities } = await import('@/server/keycloak')
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'admin-tok' }), { status: 200 })
      }
      return new Response(JSON.stringify([{ identityProvider: 'google-csquared', userId: 'g1' }]), { status: 200 })
    })

    const res = await getFederatedIdentities('kc-1')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/federated-identity'))
    expect(call?.[0]).toContain('/admin/realms/csquared/users/kc-1/federated-identity')
    expect(res).toEqual([{ identityProvider: 'google-csquared' }])
  })

  it('resetKeycloakPassword PUTs a temporary credential', async () => {
    const { resetKeycloakPassword } = await import('@/server/keycloak')
    await resetKeycloakPassword('kc-1', 'Temp123!')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/reset-password'))
    expect(call?.[0]).toContain('/admin/realms/csquared/users/kc-1/reset-password')
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ type: 'password', value: 'Temp123!', temporary: true })
  })

  it('ensureKeycloakUserEnabledVerified PUTs enabled + emailVerified', async () => {
    const { ensureKeycloakUserEnabledVerified } = await import('@/server/keycloak')
    await ensureKeycloakUserEnabledVerified('kc-1')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/users/kc-1'))
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ enabled: true, emailVerified: true })
  })
})
