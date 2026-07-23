import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import * as React from "react"
import ChangeEventEmail from "@/emails/change-event"

const base = {
  headline: "Change implemented",
  intro: "Kofi marked your change as implemented.",
  rows: [["Change", "Router upgrade"], ["OpCo", "Ghana"]] as [string, string][],
  ctaHref: "http://localhost:3000/changes/abc123",
  ctaLabel: "View request",
}

describe("ChangeEventEmail", () => {
  it("renders EN with headline, intro, rows and CTA", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="en" />)
    expect(html).toContain("Change implemented")
    expect(html).toContain("Kofi marked your change as implemented.")
    expect(html).toContain("Router upgrade")
    expect(html).toContain("Ghana")
    expect(html).toContain("/changes/abc123")
  })

  it("renders FR without throwing", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="fr" headline="Changement mis en œuvre" />)
    expect(html).toContain("Changement mis en")
  })

  it("renders a plain-text variant", async () => {
    const text = await render(<ChangeEventEmail {...base} lang="en" />, { plainText: true })
    expect(text).toContain("Router upgrade")
  })

  it("renders the optional pill and note when supplied", async () => {
    const html = await render(
      <ChangeEventEmail {...base} lang="en" pill={{ tone: "approved", label: "implemented" }} note="Backout not required." />
    )
    expect(html).toContain("implemented")
    expect(html).toContain("Backout not required.")
  })

  it("omits the note block when not supplied", async () => {
    const html = await render(<ChangeEventEmail {...base} lang="en" />)
    expect(html).not.toContain("Backout not required.")
  })

  it("renders with no detail rows at all", async () => {
    const html = await render(<ChangeEventEmail {...base} rows={[]} lang="en" />)
    expect(html).toContain("Change implemented")
  })
})
