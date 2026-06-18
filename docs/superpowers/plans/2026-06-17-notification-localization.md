# Notification Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize all outbound notifications (in-app, email, Google Chat) and the invite email into the recipient's language, falling back to the change's OpCo locale, then English.

**Architecture:** Add a per-user `User.locale` column. `notifyEvent` resolves each recipient's locale (`User.locale ?? OpCo.locale ?? "en"`) and threads it into the now locale-aware pure copy builders (`notificationContent`, `chatMessageText`) and the six email senders. The Keycloak `locale` claim seeds `User.locale` on first sign-in; the in-app language toggle persists it via a new `setMyLocale` action. No notify call sites change — resolution is internal to `notifyEvent`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (`@prisma/adapter-pg`), NextAuth v5, Vitest, Zustand. Source spec: `docs/superpowers/specs/2026-06-16-notification-localization-design.md`.

**Branch:** Create a feature branch off `dev` (e.g. `feat/notification-localization`) before Task 1. Do NOT work on `dev` directly. The `User.locale` migration is applied to local dev DB during the plan; the **production Neon migration is applied separately by the operator after merge** (`pnpm prisma migrate deploy`).

---

## Conventions used in this plan

- `Language` is the existing type from `@/lib/i18n` (`"en" | "fr"`).
- `coerceLocale(v: string | null | undefined): Language` returns `"fr"` only when `v === "fr"`, otherwise `"en"`. It is defined once in `src/lib/i18n.ts` (pure, edge-safe) and imported everywhere it is needed — deliberately NOT in `src/server/notify.ts`, so that importing it into `auth-callbacks.ts`/`users.ts` does not transitively pull the email deps (`resend`, `nodemailer`) into those paths.
- Run a single test file with: `pnpm vitest run <path>`.
- Run type-check with: `pnpm tsc --noEmit` (expected: no output).

---

## Task 1: Add `User.locale` column + migration

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, after line 60 `name String?`)
- Create: `prisma/migrations/<timestamp>_add_user_locale/migration.sql` (generated)

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, inside `model User { ... }`, add the `locale` field directly after the `name` line:

```prisma
model User {
  id           String   @id @default(cuid())
  keycloakId   String   @unique
  email        String   @unique
  name         String?
  locale       String   @default("en")
  isActive     Boolean  @default(true)
```

- [ ] **Step 2: Create and apply the migration against the local dev DB**

The project uses a local Postgres via docker-compose. `prisma.config.ts` reads `DATABASE_URL`. Pass it inline (see `reference_local_dev_stack` runbook for the exact local URL):

Run: `DATABASE_URL='<local-dev-postgres-url>' pnpm prisma migrate dev --name add_user_locale`
Expected: a new migration folder is created, applied, and `✔ Generated Prisma Client` prints.

- [ ] **Step 3: Verify the client typings include `locale`**

Run: `pnpm tsc --noEmit`
Expected: no output (the field is now on the generated `User` type; nothing references it yet so nothing breaks).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(notify): add User.locale column for notification localization"
```

---

## Task 2: Localize the pure copy builders

**Files:**
- Modify: `src/lib/notifications.ts` (`notificationContent`, `chatMessageText`)
- Test: `src/test/lib/notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these to `src/test/lib/notifications.test.ts`. Update the existing import line to keep `Language` usage local (no import needed — `'fr'`/`'en'` are string literals).

```ts
describe('notificationContent localization', () => {
  it('returns English copy when locale="en"', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}, 'en').title).toBe('Change approved')
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }, 'en').body).toMatch(/breached its SLA/)
  })
  it('returns French copy when locale="fr"', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}, 'fr').title).toBe('Changement approuvé')
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }, 'fr').body).toMatch(/SLA dépassé/)
    expect(notificationContent('emergency_submitted', 'Core upgrade', { requesterName: 'Ada' }, 'fr').body).toMatch(/Ada/)
  })
})

describe('chatMessageText localization', () => {
  it('returns English chat copy when locale="en"', () => {
    expect(chatMessageText('change_approved', 'Core upgrade', {}, 'en')).toMatch(/Change approved/)
  })
  it('returns French chat copy when locale="fr"', () => {
    expect(chatMessageText('change_approved', 'Core upgrade', {}, 'fr')).toMatch(/Changement approuvé/)
    expect(chatMessageText('sla_escalated', 'Core upgrade', { level: 3 }, 'fr')).toMatch(/niveau 3/)
  })
})
```

Also update the **existing** `notificationContent`/`chatMessageText` tests in this file to pass a locale arg (append `, 'en'` to each call), since the signature is changing. Existing calls to update:
- line ~10-14: the five `notificationContent(...)` calls → add `, 'en'` before the closing `)`.
- line ~31: `chatMessageText('emergency_submitted', 'Core upgrade', {})` → `chatMessageText('emergency_submitted', 'Core upgrade', {}, 'en')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/lib/notifications.test.ts`
Expected: FAIL — `notificationContent`/`chatMessageText` currently take 3 args; new calls pass a 4th and assertions on French strings fail.

- [ ] **Step 3: Implement the localized builders**

Replace `notificationContent` and `chatMessageText` in `src/lib/notifications.ts` with these. Add the `Language` import at the top.

```ts
// at top of file, after the existing header comment:
import type { Language } from "@/lib/i18n"
```

```ts
export function notificationContent(
  type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language
): { title: string; body: string } {
  if (locale === "fr") {
    switch (type) {
      case "approval_requested":
        return { title: "Approbation requise", body: `« ${changeTitle} » nécessite votre approbation.` }
      case "change_approved":
        return { title: "Changement approuvé", body: `« ${changeTitle} » a été approuvé.` }
      case "change_rejected":
        return { title: "Changement rejeté", body: `« ${changeTitle} » a été rejeté.` }
      case "sla_escalated":
        return { title: "SLA dépassé", body: `« ${changeTitle} » a dépassé son SLA (niveau ${ctx.level ?? 1}).` }
      case "emergency_submitted":
        return { title: "Changement d'urgence", body: `${ctx.requesterName ?? "Quelqu'un"} a soumis le changement d'urgence « ${changeTitle} ».` }
    }
  }
  switch (type) {
    case "approval_requested":
      return { title: "Approval requested", body: `"${changeTitle}" needs your approval.` }
    case "change_approved":
      return { title: "Change approved", body: `"${changeTitle}" was approved.` }
    case "change_rejected":
      return { title: "Change rejected", body: `"${changeTitle}" was rejected.` }
    case "sla_escalated":
      return { title: "SLA breached", body: `"${changeTitle}" breached its SLA (level ${ctx.level ?? 1}).` }
    case "emergency_submitted":
      return { title: "Emergency change", body: `${ctx.requesterName ?? "Someone"} submitted emergency change "${changeTitle}".` }
  }
}
```

```ts
export function chatMessageText(type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language): string {
  if (locale === "fr") {
    switch (type) {
      case "emergency_submitted": return `🚨 Changement d'urgence soumis : « ${changeTitle} »`
      case "sla_escalated": return `⏰ SLA dépassé (niveau ${ctx.level ?? 1}) : « ${changeTitle} »`
      case "change_approved": return `✅ Changement approuvé : « ${changeTitle} »`
      case "change_rejected": return `❌ Changement rejeté : « ${changeTitle} »`
      case "approval_requested": return `📋 Approbation requise : « ${changeTitle} »`
    }
  }
  switch (type) {
    case "emergency_submitted": return `🚨 Emergency change submitted: "${changeTitle}"`
    case "sla_escalated": return `⏰ SLA breached (level ${ctx.level ?? 1}): "${changeTitle}"`
    case "change_approved": return `✅ Change approved: "${changeTitle}"`
    case "change_rejected": return `❌ Change rejected: "${changeTitle}"`
    case "approval_requested": return `📋 Approval requested: "${changeTitle}"`
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/lib/notifications.test.ts`
Expected: PASS (all suites in the file).

Note: `src/server/notify.ts` will now fail type-check because it calls these with 3 args — that is fixed in Task 4. Do not run `pnpm tsc --noEmit` as a gate here; the per-file vitest run is the gate for this task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/test/lib/notifications.test.ts
git commit -m "feat(notify): localize notificationContent and chatMessageText"
```

---

## Task 3: Localize the email senders

**Files:**
- Modify: `src/server/email.ts` (all 6 `send*Email` functions)
- Create: `src/test/server/email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/email.test.ts`. It mocks `resend`, sets `RESEND_API_KEY` per test, and uses `vi.resetModules()` + dynamic import so the module-level Resend client picks up the env (static imports are hoisted above plain assignments, so a dynamic import is required for correct ordering).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => {
  vi.resetModules()
  send.mockClear()
  process.env.RESEND_API_KEY = 're_test'
})

const lastSubject = () => send.mock.calls[0][0].subject as string
const lastHtml = () => send.mock.calls[0][0].html as string

describe('email localization', () => {
  it('approval request: English subject when locale=en', async () => {
    const { sendApprovalRequestEmail } = await import('@/server/email')
    await sendApprovalRequestEmail({ to: 'a@x.com', approverName: 'Ada', changeTitle: 'Upgrade', requesterName: 'Bob', riskLevel: 'high', changeId: 'c1', locale: 'en' })
    expect(lastSubject()).toMatch(/Action Required/)
  })

  it('approval request: French subject when locale=fr', async () => {
    const { sendApprovalRequestEmail } = await import('@/server/email')
    await sendApprovalRequestEmail({ to: 'a@x.com', approverName: 'Ada', changeTitle: 'Mise à niveau', requesterName: 'Bob', riskLevel: 'high', changeId: 'c1', locale: 'fr' })
    expect(lastSubject()).toMatch(/Action requise/)
    expect(lastHtml()).toMatch(/approbation|approuver/i)
  })

  it('status change: localizes the status word in French', async () => {
    const { sendStatusChangeEmail } = await import('@/server/email')
    await sendStatusChangeEmail({ to: 'a@x.com', name: 'Ada', changeTitle: 'Upgrade', newStatus: 'approved', locale: 'fr' })
    expect(lastSubject()).toMatch(/approuvé/i)
  })

  it('sla escalation: French subject when locale=fr', async () => {
    const { sendSlaEscalationEmail } = await import('@/server/email')
    await sendSlaEscalationEmail({ to: 'a@x.com', changeTitle: 'Upgrade', changeId: 'c1', level: 2, riskLevel: 'high', locale: 'fr' })
    expect(lastSubject()).toMatch(/SLA/)
    expect(lastHtml()).toMatch(/niveau groupe|escaladé/i)
  })

  it('emergency alert: French subject when locale=fr', async () => {
    const { sendEmergencyAlertEmail } = await import('@/server/email')
    await sendEmergencyAlertEmail({ to: 'a@x.com', changeTitle: 'Upgrade', changeId: 'c1', requesterName: 'Bob', locale: 'fr' })
    expect(lastSubject()).toMatch(/urgence/i)
  })

  it('invitation: French subject when locale=fr', async () => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({ to: 'a@x.com', name: 'Ada', tempPassword: 'ChangeMe123!', existingIdentity: false, assignments: [{ opcoSlug: 'drc', role: 'requester' }], locale: 'fr' })
    expect(lastSubject()).toMatch(/invité/i)
    expect(lastHtml()).toMatch(/mot de passe temporaire/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/test/server/email.test.ts`
Expected: FAIL — the `send*Email` functions don't accept `locale` yet and produce English subjects.

- [ ] **Step 3: Implement localized senders**

In `src/server/email.ts`, add the `Language` import at the top (after the existing imports):

```ts
import type { Language } from "@/lib/i18n"
```

Replace the **six** send functions (from `sendUserInvitationEmail` through `sendEmergencyAlertEmail`) with the following. Keep `dispatchEmail`, `escapeHtml`, `resolveRecipient`, `FROM`, `BASE` unchanged.

```ts
export async function sendUserInvitationEmail(opts: {
  to: string
  name: string
  tempPassword?: string
  existingIdentity: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
  locale?: Language
}) {
  const fr = opts.locale === "fr"
  const assignmentList = opts.assignments
    .map((a) => `<li>${escapeHtml(a.role)} ${fr ? "dans" : "in"} ${escapeHtml(a.opcoSlug)}</li>`)
    .join("")
  const passwordCopy = opts.existingIdentity
    ? (fr
        ? "<p>Utilisez votre mot de passe Keycloak existant. Si vous ne le connaissez pas, demandez à un administrateur de le réinitialiser dans Keycloak.</p>"
        : "<p>Use your existing Keycloak password. If you do not know it, ask an administrator to reset it in Keycloak.</p>")
    : (fr
        ? `<p>Votre mot de passe temporaire est : <strong>${escapeHtml(opts.tempPassword ?? "ChangeMe123!")}</strong></p><p>Il pourra vous être demandé de le changer à la première connexion.</p>`
        : `<p>Your temporary password is: <strong>${escapeHtml(opts.tempPassword ?? "ChangeMe123!")}</strong></p><p>You may be asked to change it on first sign-in.</p>`)

  await dispatchEmail(
    opts.to,
    fr ? "Vous êtes invité à CSquared CMS" : "You're invited to CSquared CMS",
    fr
      ? `<p>Bonjour ${escapeHtml(opts.name)},</p>
<p>Vous avez été invité à CSquared CMS.</p>
<p><a href="${BASE}/login">Se connecter à CSquared CMS</a></p>
${passwordCopy}
<p>Vos accès :</p>
<ul>${assignmentList}</ul>`
      : `<p>Hi ${escapeHtml(opts.name)},</p>
<p>You have been invited to CSquared CMS.</p>
<p><a href="${BASE}/login">Sign in to CSquared CMS</a></p>
${passwordCopy}
<p>Your access:</p>
<ul>${assignmentList}</ul>`
  )
}

export async function sendApprovalRequestEmail(opts: {
  to: string; approverName: string; changeTitle: string
  requesterName: string; riskLevel: string; changeId: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  await dispatchEmail(
    opts.to,
    fr ? `Action requise : approuver « ${opts.changeTitle} »` : `Action Required: Approve "${opts.changeTitle}"`,
    fr
      ? `<p>Bonjour ${opts.approverName},</p>
<p><strong>${opts.requesterName}</strong> a soumis un changement à <strong>risque ${opts.riskLevel}</strong> : <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/approvals">Examiner et approuver</a></p>`
      : `<p>Hi ${opts.approverName},</p>
<p><strong>${opts.requesterName}</strong> submitted a <strong>${opts.riskLevel} risk</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/approvals">Review &amp; Approve</a></p>`
  )
}

export async function sendStatusChangeEmail(opts: {
  to: string; name: string; changeTitle: string; newStatus: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const statusFr: Record<string, string> = { approved: "approuvé", rejected: "rejeté" }
  const status = fr ? (statusFr[opts.newStatus] ?? opts.newStatus) : opts.newStatus
  await dispatchEmail(
    opts.to,
    fr ? `Changement « ${opts.changeTitle} » mis à jour : ${status}` : `Change "${opts.changeTitle}" updated: ${status}`,
    fr
      ? `<p>Bonjour ${opts.name},</p>
<p>Votre demande de changement <strong>${opts.changeTitle}</strong> est maintenant : <strong>${status}</strong>.</p>
<p><a href="${BASE}/changes">Voir les changements</a></p>`
      : `<p>Hi ${opts.name},</p>
<p>Your change request <strong>${opts.changeTitle}</strong> is now: <strong>${status}</strong>.</p>
<p><a href="${BASE}/changes">View Changes</a></p>`
  )
}

export async function sendSlaEscalationEmail(opts: {
  to: string; changeTitle: string; changeId: string; level: number; riskLevel: string; locale?: Language
}) {
  const fr = opts.locale === "fr"
  const tier = fr
    ? (opts.level >= 2 ? "groupe" : "administrateur OpCo")
    : (opts.level >= 2 ? "group" : "OpCo admin")
  await dispatchEmail(
    opts.to,
    fr ? `Dépassement de SLA (niveau ${opts.level}) : « ${opts.changeTitle} »` : `SLA breach (level ${opts.level}): "${opts.changeTitle}"`,
    fr
      ? `<p>Le changement à <strong>risque ${opts.riskLevel}</strong> <strong>${opts.changeTitle}</strong> a dépassé son SLA d'approbation et a été escaladé au niveau <strong>${tier}</strong>.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Examiner le changement</a></p>`
      : `<p>The <strong>${opts.riskLevel} risk</strong> change <strong>${opts.changeTitle}</strong> has breached its approval SLA and was escalated to <strong>${tier}</strong> level.</p>
<p><a href="${BASE}/changes/${opts.changeId}">Review the change</a></p>`
  )
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/test/server/email.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/email.ts src/test/server/email.test.ts
git commit -m "feat(notify): localize all email senders (subject + body)"
```

---

## Task 4: Resolve per-recipient locale in `notifyEvent`

**Files:**
- Modify: `src/server/notify.ts`
- Test: `src/test/server/notify.test.ts`

- [ ] **Step 1: Update the existing test's mock DB and add precedence tests**

In `src/test/server/notify.test.ts`, extend `mockDb` to include the new reads `notifyEvent` will perform, and reset them in `beforeEach`:

```ts
const mockDb = {
  notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
  notification: { create: vi.fn().mockResolvedValue({}) },
  chatWebhook: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findMany: vi.fn().mockResolvedValue([]) },
  opCo: { findUnique: vi.fn().mockResolvedValue({ locale: 'en' }) },
}
```

In `beforeEach`, after the existing resets, add:

```ts
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.opCo.findUnique.mockResolvedValue({ locale: 'en' })
```

Then add these tests inside `describe('notifyEvent', ...)`:

```ts
  it('uses the recipient User.locale (fr) even when the OpCo is en', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'u1', locale: 'fr' }])
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'en' })
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Changement approuvé' }) })
    )
  })

  it('falls back to the OpCo locale when the user has none', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'u1', locale: null }])
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'fr' })
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Changement approuvé' }) })
    )
  })

  it('broadcasts chat in the OpCo locale', async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'fr' })
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: 'https://chat.googleapis.com/x', opcoId: 'opco-1' }])
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1].body)
    expect(body.text).toMatch(/Changement approuvé/)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/test/server/notify.test.ts`
Expected: FAIL — `notifyEvent` does not resolve locale yet; in-app titles are English and chat text is English.

- [ ] **Step 3: Implement locale resolution**

Edit `src/server/notify.ts`:

(a) First define `coerceLocale` in `src/lib/i18n.ts` (pure, edge-safe — so auth/user paths can import it without pulling email deps). Add it right after the `Language` type and the `t` export:

```ts
// in src/lib/i18n.ts
export function coerceLocale(v: string | null | undefined): Language {
  return v === "fr" ? "fr" : "en"
}
```

Then import both `Language` and `coerceLocale` into `src/server/notify.ts` (after the existing imports):

```ts
import { coerceLocale, type Language } from "@/lib/i18n"
```

(b) Change `emailFor` to accept and forward a `locale`:

```ts
function emailFor(type: NotifyEventType, r: NotifyRecipient, change: { id: string; title: string }, ctx: NotifyContext, locale: Language): Promise<unknown> {
  switch (type) {
    case "approval_requested":
      return sendApprovalRequestEmail({ to: r.email, approverName: r.name ?? r.email, changeTitle: change.title, requesterName: ctx.requesterName ?? "", riskLevel: ctx.riskLevel ?? "", changeId: change.id, locale })
    case "change_approved":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "approved", locale })
    case "change_rejected":
      return sendStatusChangeEmail({ to: r.email, name: r.name ?? r.email, changeTitle: change.title, newStatus: "rejected", locale })
    case "sla_escalated":
      return sendSlaEscalationEmail({ to: r.email, changeTitle: change.title, changeId: change.id, level: ctx.level ?? 1, riskLevel: ctx.riskLevel ?? "", locale })
    case "emergency_submitted":
      return sendEmergencyAlertEmail({ to: r.email, changeTitle: change.title, changeId: change.id, requesterName: ctx.requesterName ?? "", locale })
  }
}
```

(c) In `notifyEvent`, after `const prefs = await loadPrefs(...)`, resolve the locale map and OpCo locale; then thread the per-recipient locale into the in-app + email calls, and the OpCo locale into chat. Replace the body from `const tasks ...` through the end:

```ts
  const recipientIds = recipients.map((r) => r.userId)
  const [users, opco] = await Promise.all([
    recipientIds.length
      ? db.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, locale: true } })
      : Promise.resolve([] as { id: string; locale: string | null }[]),
    db.opCo.findUnique({ where: { id: change.opcoId }, select: { locale: true } }),
  ])
  const userLocale = new Map(users.map((u) => [u.id, u.locale]))
  const opcoLocale = coerceLocale(opco?.locale)

  const tasks: Promise<unknown>[] = []
  for (const r of recipients) {
    const locale = coerceLocale(userLocale.get(r.userId) ?? opco?.locale)
    if (isChannelEnabled(prefs, r.userId, type, "in_app")) {
      const { title, body } = notificationContent(type, change.title, ctx, locale)
      tasks.push(db.notification.create({ data: { userId: r.userId, type, title, body, changeId: change.id } }))
    }
    if (isChannelEnabled(prefs, r.userId, type, "email")) {
      tasks.push(emailFor(type, r, change, ctx, locale))
    }
  }

  if (CHAT_BROADCAST_TYPES.includes(type)) {
    const hooks = await db.chatWebhook.findMany({ where: { isActive: true, OR: [{ opcoId: change.opcoId }, { opcoId: null }] } })
    const text = chatMessageText(type, change.title, ctx, opcoLocale)
    for (const h of hooks) tasks.push(postToChat(h.url, text))
  }

  await Promise.allSettled(tasks)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/test/server/notify.test.ts`
Expected: PASS (all suites, including the original ones).

- [ ] **Step 5: Type-check the whole project**

Run: `pnpm tsc --noEmit`
Expected: no output (Task 2's 3-arg callers are now fixed; all senders accept `locale`).

- [ ] **Step 6: Commit**

```bash
git add src/server/notify.ts src/test/server/notify.test.ts
git commit -m "feat(notify): resolve per-recipient locale in notifyEvent"
```

---

## Task 5: Localize the invite email in `onboardUser`

**Files:**
- Modify: `src/server/actions/users.ts` (`onboardUser`, lines ~93-103)
- Test: `src/test/actions/users-authz.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/test/actions/users-authz.test.ts` and confirm how it mocks `@/server/email` and `@/server/db` (follow the file's existing pattern — it already exercises `onboardUser`). Add a test asserting the resolved locale is passed to `sendUserInvitationEmail`, based on the first assignment's OpCo locale. The DB mock must return an OpCo with `locale: 'fr'` for the assigned slug.

Concretely, ensure the email module mock captures the invitation call (add `sendUserInvitationEmail: vi.fn()` to the existing `vi.mock('@/server/email', ...)` if not present), the OpCo lookup used for locale resolution returns `{ ..., locale: 'fr' }`, and add:

```ts
it('sends the invitation in the assigned OpCo locale', async () => {
  // arrange: caller authorized to assign requester@drc; OpCo "drc" has locale "fr"
  await onboardUser({ name: 'Ada', email: 'ada@csquared.com', tempPassword: 'ChangeMe123!', assignments: [{ opcoSlug: 'drc', role: 'requester' }] })
  expect(emailMock.sendUserInvitationEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'ada@csquared.com', locale: 'fr' })
  )
})
```

(Match `emailMock` to whatever handle the file already uses for the mocked email module; if the file imports `* as email`, use `email.sendUserInvitationEmail`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts`
Expected: FAIL — `onboardUser` does not pass `locale` yet.

- [ ] **Step 3: Implement locale resolution in `onboardUser`**

In `src/server/actions/users.ts`, just before the `sendUserInvitationEmail` call (currently line ~93), resolve the invite locale from the first assignment's OpCo, then pass it. The transaction already proves the OpCo exists, but we resolve independently here (send is outside the tx). Import `coerceLocale` at the top:

```ts
import { coerceLocale } from "@/lib/i18n"
```

Then change the invite block:

```ts
  let inviteLocale: "en" | "fr" = "en"
  const firstSlug = input.assignments[0]?.opcoSlug
  if (firstSlug) {
    const opco = await db.opCo.findUnique({ where: { slug: firstSlug }, select: { locale: true } })
    inviteLocale = coerceLocale(opco?.locale)
  }

  try {
    await sendUserInvitationEmail({
      to: input.email,
      name: input.name,
      tempPassword: input.tempPassword || "ChangeMe123!",
      existingIdentity: !!existing || !createdKeycloakIdentity,
      assignments: input.assignments,
      locale: inviteLocale,
    })
  } catch (err) {
    console.warn(`[onboardUser] invitation email failed for ${input.email}:`, err)
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/test/actions/users-authz.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/users.ts src/test/actions/users-authz.test.ts
git commit -m "feat(notify): localize the invitation email by assigned OpCo locale"
```

---

## Task 6: Seed `User.locale` from the Keycloak claim at first sign-in

**Files:**
- Modify: `src/lib/auth-callbacks.ts` (`enrichedJwt`, the upsert create branch)
- Test: `src/test/auth-enrichment.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/test/auth-enrichment.test.ts`, add tests asserting a new linked user gets `locale` from `profile.locale`, and that the locale is **not** written when linking an already-existing email (update branch must not overwrite). Add to the `describe('auth enrichment', ...)` block:

```ts
  it('seeds User.locale from the profile.locale claim when creating/linking', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'sub-fr', email: 'pierre@csquared.com', email_verified: true, name: 'Pierre', locale: 'fr' },
    })
    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'pierre@csquared.com' },
      update: { keycloakId: 'sub-fr' },
      create: { keycloakId: 'sub-fr', email: 'pierre@csquared.com', name: 'Pierre', locale: 'fr' },
    })
  })

  it('defaults locale to en when the claim is absent', async () => {
    userFindUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])
    await enrichedJwt({
      token: {}, user: {}, account,
      profile: { sub: 'sub-x', email: 'sam@csquared.com', email_verified: true, name: 'Sam' },
    })
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ locale: 'en' }) })
    )
  })
```

Note: the `update` branch deliberately omits `locale` so an explicit in-app choice is never clobbered on a later sign-in.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts`
Expected: FAIL — `create` currently has no `locale`.

- [ ] **Step 3: Implement the seed**

In `src/lib/auth-callbacks.ts`, extend the profile type and the `create` payload. Add `coerceLocale` import:

```ts
import { coerceLocale } from "@/lib/i18n"
```

Update the profile destructure and upsert (inside `if (!existing) { ... }`):

```ts
      const p = (profile ?? {}) as {
        email?: string
        email_verified?: boolean
        name?: string
        preferred_username?: string
        locale?: string
      }
      if (p.email && p.email_verified) {
        await db.user.upsert({
          where: { email: p.email },
          update: { keycloakId: sub },
          create: { keycloakId: sub, email: p.email, name: p.name ?? p.preferred_username ?? null, locale: coerceLocale(p.locale) },
        })
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts`
Expected: PASS (all suites — the existing link test still matches because its profile has no `locale`, so `create.locale === 'en'`; update that test's expected `create` object to include `locale: 'en'` if it asserts the full object).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-callbacks.ts src/test/auth-enrichment.test.ts
git commit -m "feat(notify): seed User.locale from Keycloak locale claim at sign-in"
```

---

## Task 7: Persist the in-app language choice via `setMyLocale`

**Files:**
- Modify: `src/server/actions/notifications.ts` (add `setMyLocale`)
- Modify: `src/components/app-shell.tsx` (Preferences `<select onChange>`, line ~569)
- Test: `src/test/actions/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/test/actions/notifications.test.ts`, add a `user.update` spy to `mockDb` and a test. Update `mockDb.user` to:

```ts
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }), update: vi.fn().mockResolvedValue({}) },
```

Then add:

```ts
import { setMyLocale } from '@/server/actions/notifications'

describe('setMyLocale', () => {
  it('updates the current user locale by keycloakId', async () => {
    await setMyLocale('fr')
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { keycloakId: 'kc-me' }, data: { locale: 'fr' },
    })
  })

  it('coerces unknown values to en and never throws', async () => {
    await expect(setMyLocale('xx' as 'en' | 'fr')).resolves.toBeUndefined()
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { keycloakId: 'kc-me' }, data: { locale: 'en' },
    })
  })
})
```

(The existing `setMyLocale` import can be merged into the existing `import { getNavCounts, markAllNotificationsRead } from '@/server/actions/notifications'` line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/test/actions/notifications.test.ts`
Expected: FAIL — `setMyLocale` is not exported.

- [ ] **Step 3: Implement `setMyLocale`**

In `src/server/actions/notifications.ts`, add the import and the action. Reuse `coerceLocale`:

```ts
import { coerceLocale, type Language } from "@/lib/i18n"
```

```ts
// Best-effort: records the UI language choice for server-side notification copy.
// Never throws — a failure must not block the instant client-side language switch.
export async function setMyLocale(locale: Language): Promise<void> {
  try {
    const session = await getAppSession()
    const db = getPrisma()
    await db.user.update({ where: { keycloakId: session.keycloakId }, data: { locale: coerceLocale(locale) } })
  } catch (err) {
    console.warn("[setMyLocale] failed to persist locale:", err)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/test/actions/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the select to fire `setMyLocale`**

In `src/components/app-shell.tsx`, add `setMyLocale` to the existing import from `@/server/actions/notifications` (line 9):

```ts
import { getNavCounts, setMyLocale } from "@/server/actions/notifications"
```

Update the Preferences language `<select onChange>` (line ~569) to also persist the choice (fire-and-forget; the Zustand `setLanguage` still drives the live UI instantly):

```tsx
                  onChange={(event) => {
                    const lang = event.target.value as "en" | "fr"
                    setLanguage(lang)
                    void setMyLocale(lang)
                  }}
```

- [ ] **Step 6: Verify build + type-check**

Run: `pnpm tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/notifications.ts src/components/app-shell.tsx src/test/actions/notifications.test.ts
git commit -m "feat(notify): persist UI language choice via setMyLocale"
```

---

## Final verification (after all tasks)

- [ ] **Run the full suite (excluding the Docker integration test):**

Run: `pnpm vitest run --exclude '**/integration/**'`
Expected: all tests pass.

- [ ] **Lint + type-check:**

Run: `pnpm lint` (0 errors) and `pnpm tsc --noEmit` (no output).

- [ ] **Build:**

Run: `pnpm build`
Expected: `prisma generate` + `next build` complete without error.

---

## Post-merge operator step (NOT part of code tasks)

After the branch is merged to `dev` and deployed, apply the migration to production Neon:

```bash
DATABASE_URL='<prod-neon-url>' pnpm prisma migrate deploy
```

The column has `@default("en")`, so existing rows backfill safely. New sign-ins seed from the Keycloak claim; users can override via Preferences.

---

## Self-review notes (author)

- **Spec coverage:** §1 schema → Task 1; §2 notify resolution → Task 4; §3 localized templates → Task 2; §4 localized emails + invite → Tasks 3 & 5; §5 seed from Keycloak → Task 6; §6 persist in-app choice → Task 7. All covered.
- **Type consistency:** `coerceLocale` defined once in `src/lib/i18n.ts` (pure/edge-safe) and imported by `notify.ts`, `users.ts`, `auth-callbacks.ts`, `notifications.ts`. `Language` always from `@/lib/i18n`. All six email senders gain an optional `locale?: Language`. `notificationContent`/`chatMessageText` gain a **required** trailing `locale: Language` (every caller updated in Tasks 2 & 4 and the test files).
- **Cross-task ordering:** Task 2 leaves `notify.ts` temporarily type-broken (3-arg callers); Task 4 fixes it. The full `pnpm tsc --noEmit` gate is therefore in Task 4, not Task 2 — called out explicitly in Task 2 Step 4.
