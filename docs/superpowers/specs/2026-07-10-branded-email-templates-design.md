# Branded React Email templates

**Date:** 2026-07-10
**Status:** Approved — ready for implementation plan
**Area:** Transactional email (`src/server/email.ts`)

## Problem

The 6 transactional emails (invitation, approval request, status change, SLA escalation,
access request, emergency alert) are sent as bare `<p>`/`<ul>` HTML with no wrapper,
branding, or styling — they render as unstyled text. They already go out as `html` via
Resend, with a nodemailer/SMTP fallback that also takes an HTML string; all are bilingual
(FR/EN).

## Goal

Replace the ad-hoc HTML strings with **branded, well-styled React Email templates** sharing
one layout (logo on a brand-blue header band, white card body, brand-blue CTA button,
muted footer). Keep every sender's public signature, keep FR/EN, keep both transports
working, and add a plain-text multipart fallback for deliverability.

## Non-goals

- No new email *types* and no content/wording changes beyond styling + the plain-text
  fallback (preserve today's copy — existing tests assert on key phrases).
- No dark-mode-specific CSS (renders as the light design across clients).
- No change to when/where emails are triggered (callers untouched).
- Not adopting Resend-hosted templates or Broadcasts (transactional email stays code-defined).

## Approach

React Email (chosen over a hand-rolled HTML wrapper): component templates rendered to an
HTML **string** server-side and passed to both transports — so the nodemailer fallback keeps
working (Resend's `react:` prop would only work for Resend).

### Dependencies
- Runtime: `@react-email/components` (Html/Head/Body/Container/Section/Heading/Text/Button/
  Img/Preview/Tailwind + `pixelBasedPreset`), `@react-email/render` (`render`).
- Dev (optional): `react-email` for the `email dev` preview server. Not required to build/run.

### Rendering integration (`src/server/email.ts`)
`dispatchEmail` gains an optional `text` parameter:
```ts
async function dispatchEmail(to: string, subject: string, html: string, text?: string)
```
- Resend path: `resend.emails.send({ from, to, subject, html, text })`.
- nodemailer path: `transporter.sendMail({ from, to, subject, html, text })`.
- `text` is omittable; when omitted both transports still work (Resend auto-derives text;
  nodemailer sends html-only). The builders always supply it.

Each of the 6 exported functions keeps its **exact current signature and subject strings**,
and its body shrinks to: resolve locale → compute subject → render its component to html +
text → `dispatchEmail`:
```ts
const el = <ApprovalRequestEmail {...props} lang={locale} />
const html = await render(el)
const text = await render(el, { plainText: true })
await dispatchEmail(opts.to, subject, html, text)
```
`escapeHtml` is removed — React Email escapes interpolated values automatically.

### Shared layout + primitives (`src/emails/layout.tsx`)
- `EmailLayout({ lang, previewText, children })` → `Html lang` + `Head` + `Preview` +
  `Tailwind`(pixelBasedPreset) + `Body` wrapping:
  - **Header:** full-width band `bg-[#0a3d91]`, centered `<Img src={`${BASE}/csquared-icon.png`}
    alt="CSquared" width={40} height={40}>`.
  - **Card:** white `Container` with rounded border, padding, holding `children`.
  - **Footer:** muted small text — "CSquared Change Management System" + an automated-message
    / do-not-reply line (localized by `lang`).
  - The logo/base URL and brand color live in a tiny shared module `src/emails/config.ts`
    (`EMAIL_BASE_URL = NEXTAUTH_URL ?? "http://localhost:3000"`, `BRAND = "#0a3d91"`),
    imported by both `layout.tsx` and `email.ts` — avoiding a cycle where the components
    would otherwise import `BASE` from `email.ts` (which imports the components).
- `CtaButton({ href, children })` → brand-blue rounded `Button` (`bg-[#0a3d91] text-white`).
- `Pill({ tone, children })` → small inline badge; `tone` ∈ `emergency|high|sla|approved|
  rejected|info` mapped to bg/text colors (red / red / amber / green / red / slate).

### Six template components (`src/emails/*.tsx`)
`invitation.tsx`, `approval-request.tsx`, `status-change.tsx`, `sla-escalation.tsx`,
`access-request.tsx`, `emergency-alert.tsx`. Each:
- Takes typed props (the same data the current builder interpolates) + `lang: Language`.
- Holds its **FR/EN body copy**, preserving today's wording — specifically the phrases the
  tests assert must survive in the rendered HTML: `approuver`/`approbation`,
  `niveau groupe`/`escaladé`, `mot de passe temporaire`.
- Composes `EmailLayout` + `Heading` + 1–2 `Text` paragraphs + a `CtaButton` (Review &
  Approve / Sign in / View Changes / Review the change / Review the request), plus:
  - invitation: the assignments `<ul>` and the password/federated/existing-identity copy
    variants (all three preserved).
  - approval-request / emergency-alert / sla-escalation: a `Pill` for risk level / SLA level.
  - status-change: a `Pill` for approved/rejected.

Subjects remain in the `email.ts` builders (one line each; tests import the senders and
assert subjects there).

## File structure

| File | Responsibility |
|------|----------------|
| `src/emails/config.ts` (new) | `EMAIL_BASE_URL`, `BRAND` — shared by layout + email.ts |
| `src/emails/layout.tsx` (new) | `EmailLayout`, `CtaButton`, `Pill` |
| `src/emails/invitation.tsx` (new) | invitation template |
| `src/emails/approval-request.tsx` (new) | approval-request template |
| `src/emails/status-change.tsx` (new) | status-change template |
| `src/emails/sla-escalation.tsx` (new) | SLA-escalation template |
| `src/emails/access-request.tsx` (new) | access-request template |
| `src/emails/emergency-alert.tsx` (new) | emergency-alert template |
| `src/server/email.ts` (modify) | thin dispatch layer; render components; `text` param |
| `package.json` (modify) | add react-email deps |

## Error handling

Unchanged posture: sends stay best-effort. `dispatchEmail` still logs (not throws) on a
Resend error so a mail problem never breaks the calling flow. `render` runs before dispatch;
if a template ever threw during render it would surface in the calling action — the render
test (below) guards against that for all six in both locales.

## Testing

- **Existing** `email.test.ts` + `email-invite.test.ts` stay green: same subjects, and the
  rendered HTML still contains the asserted FR phrases. Verify each assertion against actual
  rendered output; preserve wording (adjust a template's copy, never the test, if a phrase
  drifts).
- **New** `src/test/emails/render.test.ts`: for each of the 6 templates, for `lang` in
  `['en','fr']` — `render(<T .../>)` returns a non-empty HTML string containing the CTA
  `href` and the logo `src`; `render(<T .../>, { plainText: true })` returns non-empty text.
- Full suite (`pnpm test`) stays green; `pnpm tsc --noEmit` and `pnpm build` clean.

## Rollout notes

- Pure code change; no migration, no env changes. The logo is the app's existing public
  asset at `${NEXTAUTH_URL}/csquared-icon.png` (prod: `https://cms.csquarednet.com/...`).
- `render` is async in current React Email — always `await` it.
