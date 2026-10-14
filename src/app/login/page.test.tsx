import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { signIn, searchParams, store } = vi.hoisted(() => ({
  signIn: vi.fn(),
  searchParams: { current: new URLSearchParams() },
  store: { language: "en" as "en" | "fr", setLanguage: vi.fn() },
}))
vi.mock("next-auth/react", () => ({ signIn }))
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }))
vi.mock("@/lib/store", () => ({ useStore: () => store }))

import LoginPage from "@/app/login/page"

beforeEach(() => {
  signIn.mockClear()
  store.setLanguage.mockClear()
  store.language = "en"
  searchParams.current = new URLSearchParams()
})
afterEach(() => cleanup())

describe("LoginPage", () => {
  it("offers Google as the only way in", () => {
    const { container } = render(<LoginPage />)
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^sign in$/i })).toBeNull()
    expect(container.querySelector("input")).toBeNull()
  })

  it("sends people to Google through the google-csquared IdP", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  })

  it("tells people only CSquared accounts can sign in", () => {
    render(<LoginPage />)
    expect(screen.getByText("For CSquared staff only. Only @csquared.com accounts can sign in.")).toBeInTheDocument()
  })

  it("shows no banner on a plain visit", () => {
    render(<LoginPage />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains a refused account", () => {
    searchParams.current = new URLSearchParams("error=AccessDenied")
    render(<LoginPage />)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Access refused")
    expect(alert.textContent).toContain("Only @csquared.com accounts can sign in.")
  })

  it("explains a failed sign-in callback and offers a retry", () => {
    // Auth.js redirects here (pages.error) with ?error=Configuration when the OIDC
    // callback fails, e.g. a PKCE mismatch from a stale or duplicated login tab.
    searchParams.current = new URLSearchParams("error=Configuration")
    render(<LoginPage />)
    expect(screen.getByRole("alert").textContent).toContain("Sign-in didn't complete")
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  })

  it("shows the generic banner for any other code and never echoes it", () => {
    searchParams.current = new URLSearchParams("error=<b>x</b>")
    render(<LoginPage />)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Sign-in didn't complete")
    expect(alert.textContent).not.toContain("<b>x</b>")
  })

  it("switches language from the pill", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "FR" }))
    expect(store.setLanguage).toHaveBeenCalledWith("fr")
  })

  it("renders entirely in French", () => {
    store.language = "fr"
    searchParams.current = new URLSearchParams("error=AccessDenied")
    render(<LoginPage />)
    expect(screen.getByRole("button", { name: "Se connecter avec Google" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument()
    expect(screen.getByRole("alert").textContent).toContain("Accès refusé")
    expect(screen.getAllByText("Chaque changement réseau, demandé, approuvé et tracé.").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Sign in with Google|Access refused|Every network change/)).toBeNull()
  })
})
