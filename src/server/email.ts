// src/server/email.ts
import { Resend } from "resend"
import nodemailer from "nodemailer"

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.APP_PASSWORD
const transporter = (smtpUser && smtpPass) ? nodemailer.createTransport({
  service: "gmail",
  auth: { user: smtpUser, pass: smtpPass },
}) : null

const isDev = process.env.NODE_ENV !== "production"
const FROM = process.env.EMAIL_FROM ?? (isDev ? "onboarding@resend.dev" : "CSquared CMS <noreply@csquared.com>")
const BASE = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

function resolveRecipient(originalTo: string) {
  if (isDev && process.env.TEST_EMAIL_RECIPIENT) {
    return process.env.TEST_EMAIL_RECIPIENT
  }
  return originalTo
}

async function dispatchEmail(to: string, subject: string, html: string) {
  const recipient = resolveRecipient(to)
  if (resend) {
    await resend.emails.send({ from: FROM, to: recipient, subject, html })
  } else if (transporter) {
    const sender = isDev && smtpUser ? smtpUser : FROM
    await transporter.sendMail({ from: sender, to: recipient, subject, html })
  } else {
    console.log(`[Email Mock] To: ${recipient} | Subject: ${subject}`)
  }
}

export async function sendApprovalRequestEmail(opts: {
  to: string; approverName: string; changeTitle: string
  requesterName: string; riskLevel: string; changeId: string
}) {
  await dispatchEmail(
    opts.to,
    `Action Required: Approve "${opts.changeTitle}"`,
    `<p>Hi ${opts.approverName},</p>
<p><strong>${opts.requesterName}</strong> submitted a <strong>${opts.riskLevel} risk</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/approvals">Review &amp; Approve</a></p>`
  )
}

export async function sendStatusChangeEmail(opts: {
  to: string; name: string; changeTitle: string; newStatus: string
}) {
  await dispatchEmail(
    opts.to,
    `Change "${opts.changeTitle}" updated: ${opts.newStatus}`,
    `<p>Hi ${opts.name},</p>
<p>Your change request <strong>${opts.changeTitle}</strong> is now: <strong>${opts.newStatus}</strong>.</p>
<p><a href="${BASE}/changes">View Changes</a></p>`
  )
}
