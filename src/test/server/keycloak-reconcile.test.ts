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

  // The realm is shared with other apps: an adopted account is never enabled by the CMS.
  const userRoute = (enabled: boolean) => fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'admin-tok' }), { status: 200 })
    }
    if (!init?.method) return new Response(JSON.stringify({ id: 'kc-1', enabled }), { status: 200 })
    return new Response(null, { status: 204 })
  })

  it('verifyAdoptedKeycloakUser marks an enabled account verified, without touching enabled', async () => {
    userRoute(true)
    const { verifyAdoptedKeycloakUser } = await import('@/server/keycloak')
    await expect(verifyAdoptedKeycloakUser('kc-1')).resolves.toBe('verified')
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
    expect(String(put?.[0])).toMatch(/\/users\/kc-1$/)
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ emailVerified: true })
  })

  it('verifyAdoptedKeycloakUser reports a disabled account and writes nothing', async () => {
    userRoute(false)
    const { verifyAdoptedKeycloakUser } = await import('@/server/keycloak')
    await expect(verifyAdoptedKeycloakUser('kc-1')).resolves.toBe('disabled')
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false)
  })
})
