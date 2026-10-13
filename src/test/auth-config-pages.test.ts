import { describe, it, expect } from "vitest"
import authConfig from "@/auth.config"

describe("auth config", () => {
  it("routes Auth.js errors to the login page instead of the built-in 500 page", () => {
    expect(authConfig.pages?.error).toBe("/login")
  })
})
