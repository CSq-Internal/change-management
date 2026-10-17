import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { act } from "react"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"
import { DateTime } from "@/components/date-time"

// The server renders in UTC; this browser is in Nairobi (UTC+3). Rendering the local time
// on the server pass would make React throw away the page with a hydration error.
const savedTz = process.env.TZ
beforeAll(() => { process.env.TZ = "Africa/Nairobi" })
afterAll(() => { process.env.TZ = savedTz })

describe("DateTime", () => {
  it("hydrates without a mismatch, then shows the viewer's local time", async () => {
    const value = "2026-10-20T07:05:00.000Z"
    const el = document.createElement("div")
    // What a UTC server sends: render the server pass with the zone the server would have.
    process.env.TZ = "UTC"
    el.innerHTML = renderToString(<DateTime value={value} />)
    process.env.TZ = "Africa/Nairobi"
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(el, <DateTime value={value} />, { onRecoverableError: (e) => errors.push(e) })
    })
    expect(errors).toEqual([])
    expect(el.textContent).toMatch(/10:05/)
  })
})
