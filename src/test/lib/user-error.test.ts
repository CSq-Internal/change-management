import { describe, it, expect } from "vitest"
import { UserError, errorMessage } from "@/lib/user-error"

// What a production build hands the browser for a thrown server-action error: React's
// generic text, with only the digest kept from the server.
const asProd = (err: Error & { digest?: string }) =>
  Object.assign(new Error("An error occurred in the Server Components render."), { digest: err.digest ?? "3829201" })

describe("errorMessage", () => {
  it("reads a UserError's message back out of a production-masked error", () => {
    const masked = asProd(new UserError('Blocked by blackout: "Year-end freeze". Submit as emergency to override.'))
    expect(errorMessage(masked, "Unknown error")).toBe('Blocked by blackout: "Year-end freeze". Submit as emergency to override.')
  })

  it("shows the fallback, not React's generic text, for any other server error", () => {
    expect(errorMessage(asProd(new Error("relation does not exist")), "Unknown error")).toBe("Unknown error")
  })

  it("keeps the message of an error thrown in the browser", () => {
    expect(errorMessage(new Error("Upload failed: too large"), "Unknown error")).toBe("Upload failed: too large")
  })

  it("falls back for a thrown non-error", () => {
    expect(errorMessage("boom", "Unknown error")).toBe("Unknown error")
  })
})
