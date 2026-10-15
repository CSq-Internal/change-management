import { describe, it, expect, vi, afterEach } from "vitest"
import { AuthError } from "next-auth"
import authConfig from "@/auth.config"

afterEach(() => vi.restoreAllMocks())

describe("auth config", () => {
  it("routes Auth.js errors to the login page instead of the built-in 500 page", () => {
    expect(authConfig.pages?.error).toBe("/login")
  })

  it("routes sign-in errors (e.g. a provider-side OAuth error) to the login page too", () => {
    // SignInError subclasses redirect to pages.signIn, not pages.error.
    expect(authConfig.pages?.signIn).toBe("/login")
  })

  it("logs auth errors as one structured line at ERROR severity so Cloud Monitoring alerts on them", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    class CallbackRouteError extends AuthError { static type = "CallbackRouteError" }
    const error = new CallbackRouteError("Read more", {
      cause: { err: new Error("server responded with an error"), error: "invalid_grant", provider: "keycloak" },
    })
    authConfig.logger!.error!(error)
    expect(spy).toHaveBeenCalledTimes(1)
    const entry = JSON.parse(spy.mock.calls[0][0] as string)
    expect(entry).toMatchObject({
      severity: "ERROR",
      message: expect.stringContaining("[auth][error] CallbackRouteError"),
      cause: "server responded with an error",
      details: { error: "invalid_grant", provider: "keycloak" },
    })
  })
  describe("signIn callback: verified @csquared.com accounts only", () => {
    type SignInParams = Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["signIn"]>>[0]
    const signIn = (profile: Record<string, unknown> | undefined) =>
      authConfig.callbacks!.signIn!({ user: {}, account: null, profile } as unknown as SignInParams)

    it("admits a verified CSquared account", async () => {
      expect(await signIn({ email: "ada@csquared.com", email_verified: true })).toBe(true)
    })

    it("admits mixed case and stray whitespace", async () => {
      expect(await signIn({ email: " Ada@CSquared.com ", email_verified: true })).toBe(true)
    })

    it("refuses an unverified email", async () => {
      expect(await signIn({ email: "ada@csquared.com", email_verified: false })).toBe(false)
      expect(await signIn({ email: "ada@csquared.com" })).toBe(false)
    })

    it("refuses another domain and lookalikes", async () => {
      expect(await signIn({ email: "ada@gmail.com", email_verified: true })).toBe(false)
      expect(await signIn({ email: "ada@csquared.com.evil.io", email_verified: true })).toBe(false)
    })

    it("refuses a sign-in with no profile", async () => {
      expect(await signIn(undefined)).toBe(false)
    })
  })
})
