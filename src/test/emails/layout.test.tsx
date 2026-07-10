import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import { EmailLayout, CtaButton, Pill } from "@/emails/layout"

describe("EmailLayout", () => {
  it("renders the logo, children, CTA and footer (en)", async () => {
    const html = await render(
      <EmailLayout lang="en" previewText="Hi">
        <CtaButton href="https://example.com/go">Go</CtaButton>
      </EmailLayout>
    )
    expect(html).toMatch(/csquared-icon\.png/)
    expect(html).toMatch(/https:\/\/example\.com\/go/)
    expect(html).toMatch(/automated message/i)
  })

  it("localizes the footer in French", async () => {
    const html = await render(
      <EmailLayout lang="fr" previewText="Bonjour">x</EmailLayout>
    )
    expect(html).toMatch(/message automatique/i)
  })

  it("renders a toned Pill", async () => {
    const html = await render(<Pill tone="emergency">Emergency</Pill>)
    expect(html).toMatch(/Emergency/)
  })
})
