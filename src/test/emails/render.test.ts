import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import * as React from "react"
import InvitationEmail from "@/emails/invitation"
import ApprovalRequestEmail from "@/emails/approval-request"
import StatusChangeEmail from "@/emails/status-change"
import SlaEscalationEmail from "@/emails/sla-escalation"
import AccessRequestEmail from "@/emails/access-request"
import EmergencyAlertEmail from "@/emails/emergency-alert"
import type { Language } from "@/lib/i18n"

const cases = [
  ["invitation", (lang: Language) => React.createElement(InvitationEmail, { name: "A", tempPassword: "X", existingIdentity: false, assignments: [{ opcoSlug: "ghana", role: "requester" }], lang }), "/login"],
  ["approval", (lang: Language) => React.createElement(ApprovalRequestEmail, { approverName: "A", changeTitle: "T", requesterName: "R", riskLevel: "high", lang }), "/approvals"],
  ["status", (lang: Language) => React.createElement(StatusChangeEmail, { name: "A", changeTitle: "T", status: "approved", tone: "approved", changeId: "c1", lang }), "/changes/c1"],
  ["sla", (lang: Language) => React.createElement(SlaEscalationEmail, { changeTitle: "T", changeId: "c1", level: 2, riskLevel: "high", tier: "group", lang }), "/changes/c1"],
  ["access", (lang: Language) => React.createElement(AccessRequestEmail, { adminName: "A", requesterName: "R", opcoName: "Ghana", lang }), "/access-requests"],
  ["emergency", (lang: Language) => React.createElement(EmergencyAlertEmail, { changeTitle: "T", changeId: "c1", requesterName: "R", lang }), "/changes/c1"],
] as const

describe("email templates render", () => {
  for (const [name, make, hrefFragment] of cases) {
    for (const lang of ["en", "fr"] as const) {
      it(`${name} renders html + text (${lang})`, async () => {
        const el = make(lang)
        const html = await render(el)
        expect(html).toContain("csquared-icon.png")
        expect(html).toContain(hrefFragment)
        const text = await render(el, { plainText: true })
        expect(text.trim().length).toBeGreaterThan(0)
      })
    }
  }
})
