# Notification Localization (i18n for alerts) — Design

**Date:** 2026-06-16
**Status:** Draft — awaiting user review

## Goal

Localize all outbound notifications (in-app, email, Google Chat) and the invite email into
the recipient's language, falling back to the change's OpCo locale, then English — so
francophone OpCos (DRC, Togo) and French-preferring users receive French alerts instead of
the current English-only output.

## Background

The UI is fully bilingual via `t(language, key)` (`src/lib/i18n.ts`, `Language = "en" | "fr"`),
with the choice held client-side (Zustand + `localStorage`). But notification content is
**hardcoded English** in `src/lib/notifications.ts` (`notificationContent`, `chatMessageText`)
and `src/server/email.ts` (6 send functions), takes no locale, and ignores `OpCo.locale`
(which already distinguishes `fr` OpCos). There is no server-visible per-user language today.

## Decision (locked in brainstorming)

Language is resolved **per recipient**:
```
locale = recipient User.locale  ??  change.OpCo.locale  ??  "en"
```
- In-app notifications and emails are generated per recipient in their language.
- Google Chat posts to a channel (no single recipient) → use the change's **OpCo locale**.
- Seed `User.locale` from the Keycloak `locale` claim at first sign-in (in scope).
- Localize the invite email by the invited user's assigned OpCo locale (in scope).

## Architecture — change is confined to a few units

`notifyEvent` already receives `change.opcoId` and the recipient list, so **no call sites
change**. `notifyEvent` resolves locales internally.

### 1. Schema — `User.locale`
Add to `model User` (`prisma/schema.prisma`):
```prisma
  locale  String  @default("en")
```
Migration: `add_user_locale`. Values constrained in app code to `"en" | "fr"` (DB stays a
plain String for forward-compatibility).

### 2. Locale resolution in `notifyEvent` (`src/server/notify.ts`)
- Before the dispatch loop:
  - `const users = await db.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, locale: true } })` → `Map<userId, locale>`.
  - `const opco = await db.opCo.findUnique({ where: { id: change.opcoId }, select: { locale: true } })` → `opcoLocale`.
- Helper `coerceLocale(v): Language` → returns `"fr"` if `v === "fr"`, else `"en"` (guards bad/legacy values).
- Per recipient: `const locale = coerceLocale(userMap.get(r.userId) ?? opcoLocale ?? "en")`.
  - in-app: `notificationContent(type, change.title, ctx, locale)`.
  - email: `emailFor(type, r, change, ctx, locale)`.
- Chat (broadcast): `chatMessageText(type, change.title, ctx, coerceLocale(opcoLocale ?? "en"))`.

### 3. Localized templates (`src/lib/notifications.ts`, pure, already unit-tested)
- `notificationContent(type, changeTitle, ctx, locale: Language)` and
  `chatMessageText(type, changeTitle, ctx, locale: Language)` gain a trailing `locale` arg.
- Keep templates inline as per-locale literals (they interpolate `changeTitle`, `ctx.level`,
  `ctx.requesterName`), rather than forcing the flat `t()` map to do interpolation.
- French strings for all 5 event types in both functions. Examples:
  - `sla_escalated` fr title: `"SLA dépassé"`, body: `"« ${changeTitle} » a dépassé son SLA (niveau ${ctx.level ?? 1})."`
  - chat fr `sla_escalated`: `⏰ SLA dépassé (niveau ${level}) : « ${changeTitle} »`

### 4. Localized emails (`src/server/email.ts`, 6 functions)
- Each `send*Email` gains `locale: Language` and localizes its **subject + HTML body**
  (including the CTA link text). The `${BASE}` URLs are unchanged.
- `emailFor` in `notify.ts` passes the resolved per-recipient locale through.
- **Invite email** (`sendUserInvitationEmail`): gains `locale`. `onboardUser`
  (`src/server/actions/users.ts`) resolves it from the invited user's **first assigned OpCo's
  locale** (assignments are known there) and passes it in; defaults `"en"` if no assignment.

### 5. Seed `User.locale` from Keycloak at login (`src/lib/auth-callbacks.ts`)
- In `enrichedJwt`, the OIDC `profile` may carry a `locale` claim. On the **create** branch of
  the user upsert (new/linked user), set `locale: coerceLocale(profile.locale)`. Do **not**
  overwrite on the update branch or for already-linked users — an explicit in-app choice wins.

### 6. Persist the in-app language choice (`src/components/app-shell.tsx` + new action)
- New server action `setMyLocale(locale: Language)` (in `src/server/actions/notifications.ts`,
  alongside `meId`): `db.user.update({ where: { keycloakId: session.keycloakId }, data: { locale } })`.
  Best-effort — wrap so a failure never blocks the UI language switch.
- In the Preferences `<select onChange>` (app-shell.tsx ~line 569), after `setLanguage(value)`,
  also fire `setMyLocale(value)` (fire-and-forget). Zustand/localStorage still drive the live UI
  instantly; the action only records the choice for server-side notifications.

## Testing

- **`src/test/lib/notifications.test.ts`** — extend: each of the 5 types returns French
  `title`/`body` when `locale="fr"` and English when `"en"`; same for `chatMessageText`.
- **Notify resolution** — a focused test (mock prisma) asserting precedence: a recipient with
  `locale="fr"` gets French content even when the OpCo is `en`; a recipient with no locale set
  falls back to the OpCo locale; unknown/legacy value coerces to `en`.
- **`setMyLocale`** — updates the current user's row by `keycloakId`.
- **`src/test/auth-enrichment.test.ts`** — a new user with `profile.locale="fr"` is created with
  `locale: "fr"`; an existing/linked user's locale is **not** overwritten.
- Email functions: assert the `fr` branch produces a French subject (light assertion; emails are
  best-effort and not deeply snapshot-tested).

## Out of scope
- Languages beyond `en`/`fr` (the app's current set).
- A user-facing "notification language" separate from the UI language (we reuse the one choice).
- Localizing the PDF evidence document and other report exports (separate effort if wanted).
- Per-OpCo Chat webhook language override (chat uses OpCo locale, which is sufficient).

## Risks / notes
- `profile.locale` presence depends on the Keycloak user having a locale set; absent → `en`
  default, corrected as soon as the user picks a language in Preferences. Acceptable.
- Email localization doubles the template strings in `email.ts`; kept inline per-locale for
  clarity since there are only two languages and few templates.
