// src/server/email.ts
import { Resend } from "resend"
import nodemailer from "nodemailer"
import { render } from "@react-email/render"
import InvitationEmail from "@/emails/invitation"
import ApprovalRequestEmail from "@/emails/approval-request"
import StatusChangeEmail from "@/emails/status-change"
import SlaEscalationEmail from "@/emails/sla-escalation"
import AccessRequestEmail from "@/emails/access-request"
import type { Language } from "@/lib/i18n"

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.APP_PASSWORD
const transporter = (smtpUser && smtpPass) ? nodemailer.createTransport({
  service: "gmail",
  auth: { user: smtpUser, pass: smtpPass },
}) : null

const isDev = process.env.NODE_ENV !== "production"
// Production default sends from the Resend-verified domain (csquarednet.com). Override
// with EMAIL_FROM. Note this is the *sender* domain — distinct from recipient addresses
// (@csquared.com). An unverified sender domain causes Resend to drop/bounce the mail.
const FROM = process.env.EMAIL_FROM ?? (isDev ? "onboarding@resend.dev" : "CSquared CMS <noreply@csquarednet.com>")
const BASE = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

function resolveRecipient(originalTo: string) {
  if (isDev && process.env.TEST_EMAIL_RECIPIENT) {
    return process.env.TEST_EMAIL_RECIPIENT
  }
  return originalTo
}

async function dispatchEmail(to: string, subject: string, html: string, text?: string) {
  const recipient = resolveRecipient(to)
  if (resend) {
    // Resend returns { data, error } and does NOT throw on API failures (e.g. an
    // unverified sender domain or a test-mode key), so the error must be inspected
    // explicitly — otherwise failed sends look successful. Log, don't throw, so a
    // mail problem never breaks the calling flow (sends are best-effort).
    const { data, error } = await resend.emails.send({ from: FROM, to: recipient, subject, html, text })
    if (error) {
      console.error(`[email] Resend rejected message to ${recipient}: ${error.name ?? "Error"} — ${error.message ?? JSON.stringify(error)}`)
      return
    }
    console.log(`[email] sent via Resend to ${recipient} (id=${data?.id ?? "?"}): ${subject}`)
  } else if (transporter) {
    const sender = isDev && smtpUser ? smtpUser : FROM
    const info = await transporter.sendMail({ from: sender, to: recipient, subject, html, text })
    console.log(`[email] sent via SMTP to ${recipient} (id=${info.messageId}): ${subject}`)
  } else {
    console.warn(`[email] no transport configured — set RESEND_API_KEY (and a verified EMAIL_FROM) or SMTP_USER+APP_PASSWORD. Mocked send to ${recipient}: ${subject}`)
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
  federated?: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
  locale?: Language
}) {
  const fr = opts.locale === "fr"
  const subject = fr ? "Vous êtes invité à CSquared CMS" : "You're invited to CSquared CMS"
  const el = (
    <InvitationEmail
      name={opts.name}
      tempPassword={opts.tempPassword}
      existingIdentity={opts.existingIdentity}
      federated={opts.federated}
      assignments={opts.assignments}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}

export async function sendApprovalRequestEmail(opts: {
  to: string; approverName: string; changeTitle: string
  requesterName: string; riskLevel: string; changeId: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const subject = fr
    ? `Action requise : approuver « ${opts.changeTitle} »`
    : `Action Required: Approve "${opts.changeTitle}"`
  const el = (
    <ApprovalRequestEmail
      approverName={opts.approverName}
      changeTitle={opts.changeTitle}
      requesterName={opts.requesterName}
      riskLevel={opts.riskLevel}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}

export async function sendStatusChangeEmail(opts: {
  to: string; name: string; changeTitle: string; newStatus: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const statusFr: Record<string, string> = { approved: "approuvé", rejected: "rejeté" }
  const status = fr ? (statusFr[opts.newStatus] ?? opts.newStatus) : opts.newStatus
  const tone = opts.newStatus === "approved" ? "approved" : opts.newStatus === "rejected" ? "rejected" : "info"
  const subject = fr
    ? `Changement « ${opts.changeTitle} » mis à jour : ${status}`
    : `Change "${opts.changeTitle}" updated: ${status}`
  const el = (
    <StatusChangeEmail
      name={opts.name}
      changeTitle={opts.changeTitle}
      status={status}
      tone={tone}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}

export async function sendSlaEscalationEmail(opts: {
  to: string; changeTitle: string; changeId: string; level: number; riskLevel: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const tier = fr
    ? (opts.level >= 2 ? "groupe" : "administrateur OpCo")
    : (opts.level >= 2 ? "group" : "OpCo admin")
  const subject = fr
    ? `Dépassement de SLA (niveau ${opts.level}) : « ${opts.changeTitle} »`
    : `SLA breach (level ${opts.level}): "${opts.changeTitle}"`
  const el = (
    <SlaEscalationEmail
      changeTitle={opts.changeTitle}
      changeId={opts.changeId}
      level={opts.level}
      riskLevel={opts.riskLevel}
      tier={tier}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}

export async function sendAccessRequestEmail(opts: {
  to: string; adminName: string; requesterName: string; opcoName: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const subject = fr ? `Nouvelle demande d'accès : ${opts.opcoName}` : `New access request: ${opts.opcoName}`
  const el = (
    <AccessRequestEmail
      adminName={opts.adminName}
      requesterName={opts.requesterName}
      opcoName={opts.opcoName}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}

export async function sendEmergencyAlertEmail(opts: {
  to: string; changeTitle: string; changeId: string; requesterName: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  await dispatchEmail(
    opts.to,
    fr ? `Changement d'urgence soumis : « ${opts.changeTitle} »` : `Emergency change submitted: "${opts.changeTitle}"`,
    fr
      ? `<p><strong>${opts.requesterName}</strong> a soumis un changement <strong>d'urgence</strong> : <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Examiner le changement</a></p>`
      : `<p><strong>${opts.requesterName}</strong> submitted an <strong>emergency</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
}
