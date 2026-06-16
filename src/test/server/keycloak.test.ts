// src/test/server/keycloak.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAdminToken, createKeycloakUser, findKeycloakUserByEmail, deactivateKeycloakUser, reactivateKeycloakUser } from '@/server/keycloak'

const ENV: Record<string, string> = {
  KEYCLOAK_ISSUER: 'https://kc.example.com/realms/csquared',
  KEYCLOAK_ADMIN_CLIENT_ID: 'csquared-cms-admin',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'svc-secret',
}

function tokenResponse(token = 'tok') {
  return { ok: true, json: async () => ({ access_token: token }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  delete process.env.KEYCLOAK_REALM
})

afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  delete process.env.KEYCLOAK_REALM
})

describe('getAdminToken — realm-scoped client credentials (A)', () => {
  it('requests a token via client_credentials against the realm token endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    const token = await getAdminToken()
    expect(token).toBe('tok')

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://kc.example.com/realms/csquared/protocol/openid-connect/token')
    const body = String((opts as RequestInit).body)
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('client_id=csquared-cms-admin')
    expect(body).toContain('client_secret=svc-secret')
    // must NOT fall back to the master realm or a password grant
    expect(url).not.toContain('/realms/master')
    expect(body).not.toContain('grant_type=password')
  })

  it('throws (without calling fetch) when the admin client secret is missing', async () => {
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAdminToken()).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('realm is parameterised, not hardcoded (C)', () => {
  it('derives the realm from KEYCLOAK_ISSUER', async () => {
    process.env.KEYCLOAK_ISSUER = 'https://kc.example.com/realms/acme'
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    await getAdminToken()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://kc.example.com/realms/acme/protocol/openid-connect/token'
    )
  })

  it('honours the KEYCLOAK_REALM override', async () => {
    process.env.KEYCLOAK_ISSUER = 'https://kc.example.com/realms/whatever'
    process.env.KEYCLOAK_REALM = 'acme'
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    await getAdminToken()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://kc.example.com/realms/acme/protocol/openid-connect/token'
    )
  })

  it('createKeycloakUser targets /admin/realms/<derived realm>/users with the bearer token', async () => {
    process.env.KEYCLOAK_ISSUER = 'https://kc.example.com/realms/acme'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse()) // admin token
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'https://kc.example.com/admin/realms/acme/users/uid-123' },
      }) // create user
    vi.stubGlobal('fetch', fetchMock)

    const id = await createKeycloakUser('a@x.com', 'Ada Lovelace', 'temp-pw')
    expect(id).toBe('uid-123')

    const [url, opts] = fetchMock.mock.calls[1]
    expect(url).toBe('https://kc.example.com/admin/realms/acme/users')
    expect((opts as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok')
  })

  it('createKeycloakUser links an existing Keycloak user when create returns 409', async () => {
    process.env.KEYCLOAK_ISSUER = 'https://kc.example.com/realms/acme'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse()) // admin token
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => '{"errorMessage":"User exists with same email"}',
      }) // create user
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'uid-existing', email: 'a@x.com' }],
      }) // exact email lookup
    vi.stubGlobal('fetch', fetchMock)

    const id = await createKeycloakUser('a@x.com', 'Ada Lovelace', 'temp-pw')

    expect(id).toBe('uid-existing')
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://kc.example.com/admin/realms/acme/users?email=a%40x.com&exact=true'
    )
  })

  it('findKeycloakUserByEmail returns null when no exact user matches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    await expect(findKeycloakUserByEmail('missing@x.com')).resolves.toBeNull()
  })
})

describe('deactivate/reactivate tolerate a missing Keycloak user', () => {
  it('deactivateKeycloakUser resolves (no throw) when Keycloak returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '{"error":"User not found"}' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(deactivateKeycloakUser('missing-sub')).resolves.toBeUndefined()
  })

  it('reactivateKeycloakUser resolves (no throw) when Keycloak returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '{"error":"User not found"}' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(reactivateKeycloakUser('missing-sub')).resolves.toBeUndefined()
  })

  it('deactivateKeycloakUser still throws on a non-404 error (e.g. 500)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(deactivateKeycloakUser('x')).rejects.toThrow()
  })
})
