import { describe, it, expect, vi, beforeEach } from "vitest"

const getToken = vi.fn()
vi.mock("next-auth/jwt", () => ({ getToken: (...a: unknown[]) => getToken(...a) }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "x=1" }) }))

import { keycloakLogoutUrl } from "@/server/actions/logout"

beforeEach(() => {
  getToken.mockReset()
  vi.stubEnv("KEYCLOAK_ISSUER", "https://id.example.com/realms/csquared")
  vi.stubEnv("KEYCLOAK_CLIENT_ID", "csquared-cms")
  vi.stubEnv("NEXTAUTH_URL", "https://cms.example.com")
})

describe("keycloakLogoutUrl", () => {
  it("ends the Keycloak session with the sign-in ID token and returns to the app", async () => {
    getToken.mockResolvedValue({ idToken: "id.jwt.sig" })
    const url = new URL(await keycloakLogoutUrl())
    expect(url.origin + url.pathname).toBe("https://id.example.com/realms/csquared/protocol/openid-connect/logout")
    expect(url.searchParams.get("id_token_hint")).toBe("id.jwt.sig")
    expect(url.searchParams.get("client_id")).toBe("csquared-cms")
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://cms.example.com/login")
    // An https app reads the __Secure- cookie.
    expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }))
  })

  it("still logs out without a hint when the session has no ID token", async () => {
    getToken.mockResolvedValue(null)
    const url = new URL(await keycloakLogoutUrl())
    expect(url.searchParams.has("id_token_hint")).toBe(false)
    expect(url.searchParams.get("client_id")).toBe("csquared-cms")
  })
})
