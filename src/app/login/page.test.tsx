import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock("next-auth/react", () => ({ signIn }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import LoginPage from "@/app/login/page"

beforeEach(() => signIn.mockClear())
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
})
