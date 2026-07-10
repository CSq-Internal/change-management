import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "@/emails/layout"

describe("EmailLayout", () => {
  it("renders the logo, children, CTA and footer (en)", async () => {
    const html = await render(
      React.createElement(EmailLayout, { lang: "en", previewText: "Hi" },
        React.createElement(CtaButton, { href: "https://example.com/go" }, "Go"))
    )
    expect(html).toMatch(/csquared-icon\.png/)
    expect(html).toMatch(/https:\/\/example\.com\/go/)
    expect(html).toMatch(/automated message/i)
  })

  it("localizes the footer in French", async () => {
    const html = await render(
      React.createElement(EmailLayout, { lang: "fr", previewText: "Bonjour" }, "x")
    )
    expect(html).toMatch(/message automatique/i)
  })

  it("renders a toned Pill", async () => {
    const html = await render(React.createElement(Pill, { tone: "emergency" }, "Emergency"))
    expect(html).toMatch(/Emergency/)
  })
})
