// src/server/email.ts
import { Resend } from "resend"

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null
const FROM = "CSquared CMS <noreply@csquared.com>"
const BASE = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

export async function sendApprovalRequestEmail(opts: {
  to: string; approverName: string; changeTitle: string
  requesterName: string; riskLevel: string; changeId: string
}) {
  if (!resend) return  // graceful no-op when RESEND_API_KEY is absent
  await resend.emails.send({
    from: FROM, to: opts.to,
    subject: `Action Required: Approve "${opts.changeTitle}"`,
    html: `<p>Hi ${opts.approverName},</p>
<p><strong>${opts.requesterName}</strong> submitted a <strong>${opts.riskLevel} risk</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/approvals">Review &amp; Approve</a></p>`,
  })
}

export async function sendStatusChangeEmail(opts: {
  to: string; name: string; changeTitle: string; newStatus: string
}) {
  if (!resend) return  // graceful no-op
  await resend.emails.send({
    from: FROM, to: opts.to,
    subject: `Change "${opts.changeTitle}" updated: ${opts.newStatus}`,
    html: `<p>Hi ${opts.name},</p>
<p>Your change request <strong>${opts.changeTitle}</strong> is now: <strong>${opts.newStatus}</strong>.</p>
<p><a href="${BASE}/changes">View Changes</a></p>`,
  })
}
