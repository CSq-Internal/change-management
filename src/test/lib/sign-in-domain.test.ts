import { describe, it, expect } from "vitest"
import { isAllowedSignInEmail } from "@/lib/sign-in-domain"

describe("isAllowedSignInEmail", () => {
  it.each(["a@csquared.com", "A@CSquared.com ", "  first.last@csquared.com"])("admits %j", (email) => {
    expect(isAllowedSignInEmail(email)).toBe(true)
  })

  it.each([
    "a@csquared.com.evil.io",
    "a@notcsquared.com",
    "a@sub.csquared.com",
    "csquared.com",
    "@csquared.com",
    "",
    "   ",
    undefined,
    null,
    42,
  ])("refuses %j", (email) => {
    expect(isAllowedSignInEmail(email)).toBe(false)
  })
})
