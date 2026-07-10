# Branded React Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6 unstyled transactional email HTML strings with branded React Email templates sharing one layout (logo on a brand-blue band, white card, brand-blue CTA, footer), bilingual FR/EN, working with both Resend and the nodemailer fallback, plus a plain-text fallback.

**Architecture:** New `src/emails/*` React Email components rendered to an HTML **string** (and a plain-text string) server-side via `@react-email/render`, then passed to both transports. `src/server/email.ts` becomes `src/server/email.tsx` — a thin dispatch layer that keeps every sender's signature and subject.

**Tech Stack:** React Email (`@react-email/components` + `@react-email/render`), React 19, Next 16, Resend + nodemailer, Vitest.

## Global Constraints

- Package manager is **pnpm** (never npm). Type-check `pnpm tsc --noEmit`; test `pnpm test`.
- Brand color is **`#0a3d91`**. Logo is the app's public asset at `${EMAIL_BASE_URL}/csquared-icon.png`.
- Preserve today's exact FR/EN wording. Tests assert these phrases survive in rendered HTML: `approuver`/`approbation`, `niveau groupe`/`escaladé`, `mot de passe temporaire`, `Sign in with Google`, `temporary password`. Adjust a template's copy (never a test) if a phrase drifts.
- Every sender keeps its **exact current signature and subject strings** — no caller changes anywhere.
- No new email types, no content changes beyond styling + the plain-text fallback, no dark-mode CSS.
- **No `Co-Authored-By` trailers** in commit messages.
- `render` from `@react-email/render` is async — always `await` it.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/emails/config.ts` (new) | `EMAIL_BASE_URL`, `BRAND` — shared by layout + email dispatcher |
| `src/emails/layout.tsx` (new) | `EmailLayout`, `CtaButton`, `Pill` |
| `src/emails/invitation.tsx` (new) | invitation template |
| `src/emails/approval-request.tsx` (new) | approval-request template |
| `src/emails/status-change.tsx` (new) | status-change template |
| `src/emails/sla-escalation.tsx` (new) | SLA-escalation template |
| `src/emails/access-request.tsx` (new) | access-request template |
| `src/emails/emergency-alert.tsx` (new) | emergency-alert template |
| `src/server/email.ts` → `src/server/email.tsx` (rename + rewrite bodies) | thin dispatch layer; `text` param |
| `src/test/emails/render.test.ts` (new) | render smoke tests for all 6 |
| `package.json` | add react-email deps |

---

### Task 1: Dependencies + shared config

**Files:**
- Modify: `package.json` (via pnpm add)
- Create: `src/emails/config.ts`

**Interfaces:**
- Produces: `EMAIL_BASE_URL: string`, `BRAND: string` from `@/emails/config` — consumed by Tasks 2–9.

- [ ] **Step 1: Add the dependencies**

Run:
```bash
pnpm add @react-email/components @react-email/render
pnpm add -D react-email
```
Expected: `package.json` gains `@react-email/components` + `@react-email/render` under dependencies and `react-email` under devDependencies; lockfile updates.

- [ ] **Step 2: Create the shared config**

Create `src/emails/config.ts`:
```ts
// Shared by the email layout and the dispatcher. Kept in its own module so the
// template components don't import from src/server/email.tsx (which imports them).
export const EMAIL_BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000"
export const BRAND = "#0a3d91"
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/emails/config.ts
git commit -m "feat(email): add react-email deps + shared email config"
```

---

### Task 2: Shared layout + primitives

**Files:**
- Create: `src/emails/layout.tsx`
- Create: `src/test/emails/layout.test.ts`

**Interfaces:**
- Consumes: `EMAIL_BASE_URL`, `BRAND` (Task 1); `Language` from `@/lib/i18n`.
- Produces: `EmailLayout({ lang, previewText, children })`, `CtaButton({ href, children })`, `Pill({ tone, children })` from `@/emails/layout` — consumed by Tasks 4–9.

- [ ] **Step 1: Write the failing test**

Create `src/test/emails/layout.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/emails/layout.test.ts`
Expected: FAIL — cannot resolve `@/emails/layout`.

- [ ] **Step 3: Implement the layout**

Create `src/emails/layout.tsx`:
```tsx
import {
  Html, Head, Preview, Tailwind, Body, Container, Section, Img, Text, Button, pixelBasedPreset,
} from "@react-email/components"
import * as React from "react"
import { EMAIL_BASE_URL, BRAND } from "./config"
import type { Language } from "@/lib/i18n"

export function EmailLayout({
  lang, previewText, children,
}: { lang: Language; previewText: string; children: React.ReactNode }) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Body className="bg-slate-100 py-8 font-sans">
          <Container className="mx-auto max-w-[520px]">
            <Section className="rounded-t-lg px-6 py-5 text-center" style={{ backgroundColor: BRAND }}>
              <Img
                src={`${EMAIL_BASE_URL}/csquared-icon.png`}
                alt="CSquared"
                width={40}
                height={40}
                className="mx-auto"
              />
            </Section>
            <Section className="rounded-b-lg border border-t-0 border-slate-200 bg-white px-6 py-6">
              {children}
              <Text className="mt-8 text-xs text-slate-400">
                {lang === "fr"
                  ? "Système de gestion des changements CSquared · message automatique, merci de ne pas répondre."
                  : "CSquared Change Management System · automated message — please do not reply."}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button
      href={href}
      className="mt-4 inline-block rounded-md px-5 py-3 text-sm font-medium text-white"
      style={{ backgroundColor: BRAND }}
    >
      {children}
    </Button>
  )
}

const PILL_TONES: Record<string, string> = {
  emergency: "bg-red-100 text-red-700",
  high: "bg-red-100 text-red-700",
  sla: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  info: "bg-slate-100 text-slate-700",
}

export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const cls = PILL_TONES[tone] ?? PILL_TONES.info
  return (
    <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/emails/layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/emails/layout.tsx src/test/emails/layout.test.ts
git commit -m "feat(email): shared branded EmailLayout + CtaButton + Pill"
```

---

### Task 3: Convert the dispatcher to .tsx + add the text fallback (builders unchanged)

**Files:**
- Rename + modify: `src/server/email.ts` → `src/server/email.tsx`

**Interfaces:**
- Produces: `dispatchEmail(to, subject, html, text?)` (internal). Public sender signatures unchanged.

This task ONLY renames the file and adds the optional `text` param threaded to both transports. The 6 builders keep emitting their current HTML strings (calling `dispatchEmail(to, subject, html)` with `text` omitted) so behavior/tests are unchanged. Templates get wired in Tasks 4–9.

- [ ] **Step 1: Rename the file**

Run:
```bash
git mv src/server/email.ts src/server/email.tsx
```
(Extensionless imports `@/server/email` resolve to the new `.tsx` — no caller changes.)

- [ ] **Step 2: Add the `text` parameter to `dispatchEmail`**

In `src/server/email.tsx`, replace the `dispatchEmail` function signature and both transport calls:

Change the signature line:
```ts
async function dispatchEmail(to: string, subject: string, html: string, text?: string) {
```
Change the Resend send call:
```ts
    const { data, error } = await resend.emails.send({ from: FROM, to: recipient, subject, html, text })
```
Change the nodemailer send call:
```ts
    const info = await transporter.sendMail({ from: sender, to: recipient, subject, html, text })
```

- [ ] **Step 3: Type-check and run the email tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/server/email.test.ts src/test/server/email-invite.test.ts`
Expected: PASS (existing behavior unchanged; `text` is `undefined` for now).

- [ ] **Step 4: Commit**

```bash
git add src/server/email.tsx
git commit -m "refactor(email): rename email.ts to .tsx and thread an optional text fallback"
```

---

### Task 4: Invitation template

**Files:**
- Create: `src/emails/invitation.tsx`
- Modify: `src/server/email.tsx` (`sendUserInvitationEmail` body)

**Interfaces:**
- Consumes: `EmailLayout`, `CtaButton` (Task 2); `EMAIL_BASE_URL` (Task 1).
- Produces: `InvitationEmail` (default export) from `@/emails/invitation`.

- [ ] **Step 1: Create the template**

Create `src/emails/invitation.tsx`:
```tsx
import { Heading, Text, Section } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface InvitationEmailProps {
  name: string
  tempPassword?: string
  existingIdentity: boolean
  federated?: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
  lang: Language
}

export default function InvitationEmail({
  name, tempPassword, existingIdentity, federated, assignments, lang,
}: InvitationEmailProps) {
  const fr = lang === "fr"
  const passwordCopy = federated
    ? (fr
        ? "Connectez-vous avec Google (« Se connecter avec Google ») en utilisant votre adresse @csquared.com. Aucun mot de passe n'est requis."
        : 'Sign in with Google ("Sign in with Google") using your @csquared.com address. No password is required.')
    : existingIdentity
    ? (fr
        ? "Utilisez votre mot de passe Keycloak existant. Si vous ne le connaissez pas, demandez à un administrateur de le réinitialiser dans Keycloak."
        : "Use your existing Keycloak password. If you do not know it, ask an administrator to reset it in Keycloak.")
    : (fr
        ? `Votre mot de passe temporaire est : ${tempPassword ?? "ChangeMe123!"}. Il pourra vous être demandé de le changer à la première connexion.`
        : `Your temporary password is: ${tempPassword ?? "ChangeMe123!"}. You may be asked to change it on first sign-in.`)

  return (
    <EmailLayout lang={lang} previewText={fr ? "Vous êtes invité à CSquared CMS" : "You're invited to CSquared CMS"}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${name},` : `Hi ${name},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Vous avez été invité à CSquared CMS." : "You have been invited to CSquared CMS."}
      </Text>
      <Text className="text-sm text-slate-700">{passwordCopy}</Text>
      <CtaButton href={`${EMAIL_BASE_URL}/login`}>
        {fr ? "Se connecter à CSquared CMS" : "Sign in to CSquared CMS"}
      </CtaButton>
      <Section className="mt-6">
        <Text className="text-sm font-medium text-slate-900">{fr ? "Vos accès :" : "Your access:"}</Text>
        {assignments.map((a, i) => (
          <Text key={i} className="my-1 text-sm text-slate-700">
            • {a.role} {fr ? "dans" : "in"} {a.opcoSlug}
          </Text>
        ))}
      </Section>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendUserInvitationEmail`**

In `src/server/email.tsx`, add near the top with the other imports:
```tsx
import { render } from "@react-email/render"
import InvitationEmail from "@/emails/invitation"
```
Replace the entire body of `sendUserInvitationEmail` (keep the signature) with:
```tsx
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
```
(The now-unused `escapeHtml` helper and the old `assignmentList`/`passwordCopy` locals are removed only if no other builder still uses them yet — leave `escapeHtml` in place until Task 8, whose builders are the last to reference it; remove it in Task 9's cleanup.)

- [ ] **Step 3: Run the invitation tests**

Run: `pnpm test src/test/server/email-invite.test.ts src/test/server/email.test.ts`
Expected: PASS — invitation HTML still matches `/Sign in with Google/i`, `/temporary password/i`, `/mot de passe temporaire/i`; other emails unchanged.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emails/invitation.tsx src/server/email.tsx
git commit -m "feat(email): branded invitation template"
```

---

### Task 5: Approval-request template

**Files:**
- Create: `src/emails/approval-request.tsx`
- Modify: `src/server/email.tsx` (`sendApprovalRequestEmail` body)

**Interfaces:**
- Produces: `ApprovalRequestEmail` (default export) from `@/emails/approval-request`.

- [ ] **Step 1: Create the template**

Create `src/emails/approval-request.tsx`:
```tsx
import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface ApprovalRequestEmailProps {
  approverName: string
  changeTitle: string
  requesterName: string
  riskLevel: string
  lang: Language
}

export default function ApprovalRequestEmail({
  approverName, changeTitle, requesterName, riskLevel, lang,
}: ApprovalRequestEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Approuver « ${changeTitle} »` : `Approve "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${approverName},` : `Hi ${approverName},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr ? "a soumis un changement à " : "submitted a "}
        <Pill tone={riskLevel}>{fr ? `risque ${riskLevel}` : `${riskLevel} risk`}</Pill>{" "}
        {fr ? "à approuver : " : "change to approve: "}
        <strong>{changeTitle}</strong>.
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/approvals`}>
        {fr ? "Examiner et approuver" : "Review & Approve"}
      </CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendApprovalRequestEmail`**

In `src/server/email.tsx`, add the import:
```tsx
import ApprovalRequestEmail from "@/emails/approval-request"
```
Replace the body of `sendApprovalRequestEmail` (keep the signature) with:
```tsx
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
```

- [ ] **Step 3: Run the email tests**

Run: `pnpm test src/test/server/email.test.ts`
Expected: PASS — subject matches `/Action Required/` (en) and `/Action requise/` (fr); fr HTML matches `/approbation|approuver/i` (the CTA "Examiner et approuver" satisfies it).

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emails/approval-request.tsx src/server/email.tsx
git commit -m "feat(email): branded approval-request template"
```

---

### Task 6: Status-change template

**Files:**
- Create: `src/emails/status-change.tsx`
- Modify: `src/server/email.tsx` (`sendStatusChangeEmail` body)

**Interfaces:**
- Produces: `StatusChangeEmail` (default export) from `@/emails/status-change`.

- [ ] **Step 1: Create the template**

Create `src/emails/status-change.tsx`:
```tsx
import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface StatusChangeEmailProps {
  name: string
  changeTitle: string
  status: string // already localized display value
  tone: string   // "approved" | "rejected" | "info"
  lang: Language
}

export default function StatusChangeEmail({
  name, changeTitle, status, tone, lang,
}: StatusChangeEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `« ${changeTitle} » : ${status}` : `"${changeTitle}": ${status}`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${name},` : `Hi ${name},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Votre demande de changement " : "Your change request "}
        <strong>{changeTitle}</strong>{" "}
        {fr ? "est maintenant : " : "is now: "}
        <Pill tone={tone}>{status}</Pill>
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes`}>
        {fr ? "Voir les changements" : "View Changes"}
      </CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendStatusChangeEmail`**

In `src/server/email.tsx`, add the import:
```tsx
import StatusChangeEmail from "@/emails/status-change"
```
Replace the body of `sendStatusChangeEmail` (keep the signature) with:
```tsx
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
```

- [ ] **Step 3: Run the email tests**

Run: `pnpm test src/test/server/email.test.ts`
Expected: PASS — status-change fr subject matches `/approuvé/i`.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emails/status-change.tsx src/server/email.tsx
git commit -m "feat(email): branded status-change template"
```

---

### Task 7: SLA-escalation template

**Files:**
- Create: `src/emails/sla-escalation.tsx`
- Modify: `src/server/email.tsx` (`sendSlaEscalationEmail` body)

**Interfaces:**
- Produces: `SlaEscalationEmail` (default export) from `@/emails/sla-escalation`.

- [ ] **Step 1: Create the template**

Create `src/emails/sla-escalation.tsx`:
```tsx
import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface SlaEscalationEmailProps {
  changeTitle: string
  changeId: string
  level: number
  riskLevel: string
  tier: string // already localized
  lang: Language
}

export default function SlaEscalationEmail({
  changeTitle, changeId, level, riskLevel, tier, lang,
}: SlaEscalationEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Dépassement de SLA : « ${changeTitle} »` : `SLA breach: "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        <Pill tone="sla">{fr ? `SLA niveau ${level}` : `SLA level ${level}`}</Pill>
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Le changement à " : "The "}
        <Pill tone={riskLevel}>{fr ? `risque ${riskLevel}` : `${riskLevel} risk`}</Pill>{" "}
        <strong>{changeTitle}</strong>{" "}
        {fr
          ? <>a dépassé son SLA d&apos;approbation et a été escaladé au niveau <strong>{tier}</strong>.</>
          : <>has breached its approval SLA and was escalated to <strong>{tier}</strong> level.</>}
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes/${changeId}`}>
        {fr ? "Examiner le changement" : "Review the change"}
      </CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendSlaEscalationEmail`**

In `src/server/email.tsx`, add the import:
```tsx
import SlaEscalationEmail from "@/emails/sla-escalation"
```
Replace the body of `sendSlaEscalationEmail` (keep the signature) with:
```tsx
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
```

- [ ] **Step 3: Run the email tests**

Run: `pnpm test src/test/server/email.test.ts`
Expected: PASS — sla fr subject matches `/SLA/`; fr HTML matches `/niveau groupe|escaladé/i` (body contains "escaladé"; with `level: 2` the tier is "groupe" and the sentence reads "au niveau groupe").

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emails/sla-escalation.tsx src/server/email.tsx
git commit -m "feat(email): branded SLA-escalation template"
```

---

### Task 8: Access-request template

**Files:**
- Create: `src/emails/access-request.tsx`
- Modify: `src/server/email.tsx` (`sendAccessRequestEmail` body)

**Interfaces:**
- Produces: `AccessRequestEmail` (default export) from `@/emails/access-request`.

- [ ] **Step 1: Create the template**

Create `src/emails/access-request.tsx`:
```tsx
import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface AccessRequestEmailProps {
  adminName: string
  requesterName: string
  opcoName: string
  lang: Language
}

export default function AccessRequestEmail({
  adminName, requesterName, opcoName, lang,
}: AccessRequestEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Demande d'accès : ${opcoName}` : `Access request: ${opcoName}`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${adminName},` : `Hi ${adminName},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr ? "a demandé l'accès à " : "requested access to "}
        <strong>{opcoName}</strong>.
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/access-requests`}>
        {fr ? "Examiner la demande" : "Review the request"}
      </CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendAccessRequestEmail`**

In `src/server/email.tsx`, add the import:
```tsx
import AccessRequestEmail from "@/emails/access-request"
```
Replace the body of `sendAccessRequestEmail` (keep the signature) with:
```tsx
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
```

- [ ] **Step 3: Type-check and run the email tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/server/email.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/emails/access-request.tsx src/server/email.tsx
git commit -m "feat(email): branded access-request template"
```

---

### Task 9: Emergency-alert template + remove dead helpers

**Files:**
- Create: `src/emails/emergency-alert.tsx`
- Modify: `src/server/email.tsx` (`sendEmergencyAlertEmail` body + remove now-unused `escapeHtml`)

**Interfaces:**
- Produces: `EmergencyAlertEmail` (default export) from `@/emails/emergency-alert`.

- [ ] **Step 1: Create the template**

Create `src/emails/emergency-alert.tsx`:
```tsx
import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface EmergencyAlertEmailProps {
  changeTitle: string
  changeId: string
  requesterName: string
  lang: Language
}

export default function EmergencyAlertEmail({
  changeTitle, changeId, requesterName, lang,
}: EmergencyAlertEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Changement d'urgence : « ${changeTitle} »` : `Emergency change: "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        <Pill tone="emergency">{fr ? "Urgence" : "Emergency"}</Pill>
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr
          ? <>a soumis un changement <strong>d&apos;urgence</strong> : <strong>{changeTitle}</strong>.</>
          : <>submitted an <strong>emergency</strong> change: <strong>{changeTitle}</strong>.</>}
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes/${changeId}`}>
        {fr ? "Examiner le changement" : "Review the change"}
      </CtaButton>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Rewire `sendEmergencyAlertEmail` and drop `escapeHtml`**

In `src/server/email.tsx`, add the import:
```tsx
import EmergencyAlertEmail from "@/emails/emergency-alert"
```
Replace the body of `sendEmergencyAlertEmail` (keep the signature) with:
```tsx
  const fr = opts.locale === "fr"
  const subject = fr
    ? `Changement d'urgence soumis : « ${opts.changeTitle} »`
    : `Emergency change submitted: "${opts.changeTitle}"`
  const el = (
    <EmergencyAlertEmail
      changeTitle={opts.changeTitle}
      changeId={opts.changeId}
      requesterName={opts.requesterName}
      lang={opts.locale ?? "en"}
    />
  )
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
```
Now delete the `escapeHtml` function (lines defining it) — no builder references it anymore. Verify with a grep:
```bash
grep -n "escapeHtml" src/server/email.tsx
```
Expected: no matches after deletion.

- [ ] **Step 3: Type-check and run the email tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/server/email.test.ts src/test/server/email-invite.test.ts`
Expected: PASS — emergency fr subject matches `/urgence/i`; no unused-variable / lint errors from a leftover `escapeHtml`.

- [ ] **Step 4: Commit**

```bash
git add src/emails/emergency-alert.tsx src/server/email.tsx
git commit -m "feat(email): branded emergency-alert template + drop escapeHtml"
```

---

### Task 10: Render smoke tests for all six + final verification

**Files:**
- Create: `src/test/emails/render.test.ts`

- [ ] **Step 1: Write the render test**

Create `src/test/emails/render.test.ts`:
```ts
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
  ["status", (lang: Language) => React.createElement(StatusChangeEmail, { name: "A", changeTitle: "T", status: "approved", tone: "approved", lang }), "/changes"],
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
```

- [ ] **Step 2: Run the render test**

Run: `pnpm test src/test/emails/render.test.ts`
Expected: PASS (12 tests — 6 templates × 2 locales).

- [ ] **Step 3: Full suite + type-check + build**

Run: `pnpm tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS — full suite green (including `email.test.ts`, `email-invite.test.ts`, `layout.test.ts`, `render.test.ts`), and `next build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/test/emails/render.test.ts
git commit -m "test(email): render smoke tests for all six templates in both locales"
```

---

## Self-Review Notes

- **Spec coverage:** deps + config → Task 1; layout + primitives → Task 2; dispatcher rename + `text` fallback → Task 3; six templates + rewiring → Tasks 4–9; `escapeHtml` removal → Task 9; render tests + final verify → Task 10. All spec sections mapped.
- **Type consistency:** `EmailLayout({lang, previewText, children})`, `CtaButton({href, children})`, `Pill({tone, children})` defined in Task 2, consumed identically in Tasks 4–9. Every template is a default export consumed by the matching `email.tsx` builder and the render test. `render`/`render(..., {plainText:true})` used uniformly.
- **Test-phrase preservation:** `email.test.ts` / `email-invite.test.ts` assertions each map to a template that preserves the phrase — approval fr CTA "Examiner et approuver" (`approuver`), SLA body "escaladé"/"au niveau groupe", status fr subject "approuvé", invitation "Sign in with Google" / "mot de passe temporaire" / "temporary password". Subjects stay in `email.tsx`.
- **Ordering:** Task 3 (rename to `.tsx`) precedes any JSX in the dispatcher; `escapeHtml` removal deferred to Task 9 (last builder to stop using it), avoiding an unused-symbol error mid-sequence.
