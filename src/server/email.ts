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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function sendUserInvitationEmail(opts: {
  to: string
  name: string
  tempPassword?: string
  existingIdentity: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
}) {
  const assignmentList = opts.assignments
    .map((a) => `<li>${escapeHtml(a.role)} in ${escapeHtml(a.opcoSlug)}</li>`)
    .join("")
  const passwordCopy = opts.existingIdentity
    ? "<p>Use your existing Keycloak password. If you do not know it, ask an administrator to reset it in Keycloak.</p>"
    : `<p>Your temporary password is: <strong>${escapeHtml(opts.tempPassword ?? "ChangeMe123!")}</strong></p><p>You may be asked to change it on first sign-in.</p>`

  await dispatchEmail(
    opts.to,
    "You're invited to CSquared CMS",
    `<p>Hi ${escapeHtml(opts.name)},</p>
<p>You have been invited to CSquared CMS.</p>
<p><a href="${BASE}/login">Sign in to CSquared CMS</a></p>
${passwordCopy}
<p>Your access:</p>
<ul>${assignmentList}</ul>`
  )
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

export async function sendSlaEscalationEmail(opts: {
  to: string; changeTitle: string; changeId: string; level: number; riskLevel: string
}) {
  const tier = opts.level >= 2 ? "group" : "OpCo admin"
  await dispatchEmail(
    opts.to,
    `SLA breach (level ${opts.level}): "${opts.changeTitle}"`,
    `<p>The <strong>${opts.riskLevel} risk</strong> change <strong>${opts.changeTitle}</strong> has breached its approval SLA and was escalated to <strong>${tier}</strong> level.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
}

export async function sendEmergencyAlertEmail(opts: {
  to: string; changeTitle: string; changeId: string; requesterName: string
}) {
  await dispatchEmail(
    opts.to,
    `Emergency change submitted: "${opts.changeTitle}"`,
    `<p><strong>${opts.requesterName}</strong> submitted an <strong>emergency</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
}
