import { describe, it, expect } from "vitest"
import { config } from "@/proxy"

// Next.js treats each matcher entry as a path regex; anything it matches goes through
// the sign-in redirect.
const gated = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path))

describe("proxy matcher", () => {
  it("gates pages and API routes", () => {
    expect(gated("/")).toBe(true)
    expect(gated("/login")).toBe(true)
    expect(gated("/changes/abc")).toBe(true)
    expect(gated("/api/changes")).toBe(true)
  })

  it("serves the logo to signed-out visitors, so the sign-in page can show it", () => {
    expect(gated("/csquared-icon.png")).toBe(false)
  })
})
