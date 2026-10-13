import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { signIn, searchParams } = vi.hoisted(() => ({
  signIn: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}))
vi.mock("next-auth/react", () => ({ signIn }))
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import LoginPage from "@/app/login/page"

beforeEach(() => {
  signIn.mockClear()
  searchParams.current = new URLSearchParams()
})
afterEach(() => cleanup())

describe("LoginPage", () => {
  it("work-credentials button signs in via keycloak with no idp hint", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" })
  })

  it("Google button signs in via keycloak with kc_idp_hint=google-csquared", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }))
    expect(signIn).toHaveBeenCalledWith(
      "keycloak",
      { callbackUrl: "/" },
      { kc_idp_hint: "google-csquared" }
    )
  })

  it("shows no error banner on a plain visit", () => {
    render(<LoginPage />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains a failed sign-in callback and offers a retry", () => {
    // Auth.js redirects here (pages.error) with ?error=Configuration when the OIDC
    // callback fails, e.g. a PKCE mismatch from a stale or duplicated login tab.
    searchParams.current = new URLSearchParams("error=Configuration")
    render(<LoginPage />)
    expect(screen.getByRole("alert").textContent).toContain("Sign-in didn't complete")
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" })
  })
})
