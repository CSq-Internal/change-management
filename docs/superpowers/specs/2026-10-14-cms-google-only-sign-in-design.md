# CMS sign-in: one branded page, Google `@csquared.com` only

**Date:** 2026-10-14
**Branch:** `feat/cms-google-only-sign-in` (off `dev`)
**Status:** Design, awaiting review
**Replaces:** "sub-project B (login theme)" from the 2026-10-08 session, and the invite section of
`2026-10-08-db-group-roles-provisioning-design.md` (branch `feat/db-group-roles`, not built).

## Context

Today a CMS user sees two screens. `/login` (`src/app/login/page.tsx`) is a plain card with two
buttons: "Continue with Google", which sends `kc_idp_hint=google-csquared` and goes straight to
Google, and "Sign in", which lands on Keycloak's stock page ("Sign in to csquared") with a password
form and a second Google button for a different IdP (`google`, the DMP's).

The DMP solved its sign-in with a custom Keycloak login theme (`~/csq-dmp/infra/keycloak/themes/csquared`).
The CMS does not copy it. The CMS is internal only and every user has an `@csquared.com` Google
account, so there is nothing for a Keycloak page to ask. One branded page in the app is enough.

Facts checked on 2026-10-14:

- `id.csquarednet.com`, realm `csquared`, is shared with the DMP and other apps. Realm settings
  move every app at once, so all Keycloak changes here are on the `csquared-cms` client only.
- `kc_idp_hint=google-csquared` on the `csquared-cms` client returns a 303 to
  `/broker/google-csquared/login`. The IdP exists and is hidden on the login page.
- The stock page for `csquared-cms` shows only `social-google`.
- Nothing in `src/` checks the email domain today. The strings `auth.error.domain*` exist unused.

## Goal

- A CMS user sees one branded screen, then Google. No password form exists for the CMS anywhere.
- Only verified `@csquared.com` accounts get in.
- Nothing changes for DMP users or any other app on the realm.

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| Where the branded screen lives | The CMS's own `/login` page | A CMS Keycloak theme: needs SSH, a Keycloak restart that also blocks DMP sign-in, and would hold one button |
| Allowed accounts | Exactly `@csquared.com`, verified email | A list of domains: the owner confirmed every CMS user is on `@csquared.com` |
| Layout | Two panels: navy brand panel left, sign-in right; header bar on phones | Centred card; card on a full brand background |
| Password sign-in | Removed and refused | Hidden behind a second button (the DMP's model, which serves contractors) |

## 1. The sign-in page

`src/app/login/page.tsx` is redesigned as the agreed layout B (mockup in
`.superpowers/brainstorm/`, not committed).

**Desktop and tablet (768px and wider):** two columns.

- Left, the brand panel, navy gradient (`#0a3d91` to `#072b66`), white text:
  - `csquared-icon.png` and "CSquared".
  - Eyebrow in cyan (`#7fd0ff`): "CHANGE MANAGEMENT SYSTEM".
  - Headline: "Every network change, raised, approved and recorded."
  - Three rows, each an icon, a title and a line:
    - "Raise a change": "One form for every OpCo and infrastructure type"
    - "CAB approval": "Routed to the right approvers, with separation of duties"
    - "Audit-ready": "Every decision and review kept for ISO 27001"
  - Footer: "Ghana · Uganda · Liberia · Mauritius · DRC · Togo · Group".
- Right, the sign-in column:
  - EN/FR pill switch, top right, bound to the existing Zustand `language`.
  - "Sign in", then "Use your CSquared Google account to continue."
  - The error banner, when there is one (below).
  - One button, "Sign in with Google", with the Google mark.
  - "For CSquared staff only. Only @csquared.com accounts can sign in."

**Phones (under 768px):** the brand panel becomes a navy header bar ("CSquared · Change
Management"); the sign-in column fills the screen. No horizontal scroll.

**Button:** `signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })`, exactly
today's Google call. The password button and its handler are removed.

**Banners** read `?error=`:

| `error` | Banner (EN) |
|---|---|
| `AccessDenied` | "Access refused": "Only @csquared.com accounts can sign in." |
| any other value | today's "Sign-in didn't complete": "Your sign-in expired or was started in another tab. Please sign in again." |

French strings are added for every new key, with the brand names ("CSquared") left in English.
French headline: "Chaque changement réseau, demandé, approuvé et tracé." Eyebrow: "SYSTÈME DE
GESTION DES CHANGEMENTS". Button: "Se connecter avec Google". Refusal: "Accès refusé": "Seuls les
comptes @csquared.com peuvent se connecter."

i18n keys that only served the password form (`auth.or`, `auth.email`, `auth.password`,
`auth.showPassword`, `auth.hidePassword`, `auth.submit`, `auth.passwordRequirements`,
`auth.error.policy*`, `auth.error.missing*`, `auth.error.failed*`) are removed if nothing else uses
them. `auth.error.domain*` is reused for the refusal banner.

**Unchanged:** `src/proxy.ts` still sends signed-out requests to `/login` and signed-in ones away
from it. Sign-out still lands on `/login`; the page never redirects to Google by itself, which would
sign the person straight back in. The self-registration access request still applies to an
`@csquared.com` person with no CMS account.

## 2. Two locks

### Lock 1: Keycloak sends every CMS sign-in to Google (configuration)

On realm `csquared`:

1. Authentication → Create flow `cms-google-only` (basic flow).
2. Add the execution **Identity Provider Redirector**, requirement **Required**, config alias
   `cms-google-csquared`, **Default Identity Provider** = `google-csquared`.
3. Clients → `csquared-cms` → Advanced → Authentication flow overrides → **Browser flow** =
   `cms-google-only`. Save.

No Cookie step: a Keycloak session started elsewhere (for example a DMP password sign-in) does not
carry into the CMS. People stay signed in to Google, so this costs at most an account-picker click.

Rollback: clear the Browser flow override on `csquared-cms`. Takes effect immediately, no restart.
Realm-level flows and every other client are untouched.

The `google-csquared` IdP must keep **Trust Email = ON** and its hosted domain `csquared.com`
(`docs/keycloak-first-broker-login-autolink.md`).

The steps go in a new `docs/keycloak-cms-google-only-flow.md` and are linked from
`deploy/PROD-RUNBOOK.md`.

### Lock 2: the app refuses anything else (code)

A `signIn` callback in `src/auth.config.ts` (edge-safe, no DB import) admits a sign-in only when the
Keycloak profile has `email_verified === true` and an email that, lowercased and trimmed, ends in
`@csquared.com`. The comparison is on the full suffix including `@`, so `x@csquared.com.evil.io`
and `x@notcsquared.com` are refused. Otherwise it returns `false`, which Auth.js turns into
`/login?error=AccessDenied`.

The domain rule is one small pure function in `src/lib/` (`isAllowedSignInEmail`), shared with
onboarding (section 3) so the two can never disagree.

A refusal is logged through the existing `logger.error` path, so it reaches the prod alert.

## 3. Onboarding without passwords

`onboardUser` (`src/server/actions/users.ts`) and its callers:

- Refuse an email that fails `isAllowedSignInEmail`, before any Keycloak call, with
  "Only @csquared.com addresses can be onboarded."
- `createOrFindKeycloakUser(email, name)` creates the account with no `credentials`. The first
  Google sign-in links to it by verified email (first-broker-login auto-link).
- An adopted account is still enabled and email-verified, but its password is never reset.
  `resetKeycloakPassword` is deleted. This also stops a CMS re-invite from changing the password a
  person uses for the DMP.
- Removed: the `tempPassword` input on `onboardUser`, the field in
  `src/app/(dashboard)/users/onboard-wizard.tsx`, both `"ChangeMe123!"` fallbacks, and the
  `tempPassword` parameter of the invitation email.
- `src/emails/invitation.tsx` (EN and FR): the temporary-password block goes. Every invite says to
  sign in with Google using the invited address, with the CMS link. The `federated` /
  `existingIdentity` branches that only chose between password and Google copy collapse.

The 2026-10-08 provisioning spec gets a dated note that its `inviteIdentity` /
`execute-actions-email` invite section is superseded by this design.

## 4. Testing

Tests are written first (Vitest, run with `--exclude '.claude/**'`).

- **`src/app/login/page.test.tsx`:** one Google button and no password control; clicking calls
  `signIn` with `kc_idp_hint: "google-csquared"`; `?error=AccessDenied` shows the refusal banner;
  any other `error` shows the expired banner; no `error` shows none; French renders the French
  strings and no English ones.
- **`isAllowedSignInEmail`:** admits `a@csquared.com` and `A@CSquared.com `; refuses
  `a@csquared.com.evil.io`, `a@notcsquared.com`, `a@sub.csquared.com`, empty and missing.
- **`signIn` callback:** admits a verified `@csquared.com` profile; refuses an unverified one and
  another domain.
- **Onboarding** (`users-authz`, `users-reconcile`, email tests updated): no password is created or
  reset on the new and adopted paths; another domain is refused before Keycloak is called; the
  invitation email has no password block in either language.
- **Browser** (Playwright MCP against `pnpm dev`): desktop 1440px, tablet 820px, phone 390px, in
  English and French, with no error, `AccessDenied` and an expired-sign-in error. Google itself is
  only exercised on prod.

The phase gate applies: `pnpm test` green, `pnpm tsc --noEmit` clean, lint clean, deslop.

## 5. Rollout

1. Ship the app change through feature → `dev` → `prod`, after this week's training waves or
   between them. Today's Google path is unchanged, so it is safe on its own.
2. Before Lock 1, list the CMS's Keycloak accounts that have no Google link (Users → each user →
   Identity provider links, or the users list). A real `@csquared.com` mailbox links on its first
   Google sign-in. An address with no mailbox, such as the seeded `devops@csquared.com` if it has
   none, loses CMS access; break-glass is the Keycloak admin console.
3. Apply Lock 1 (section 2).
4. Smoke test on prod with the owner's account: sign in, sign out, a non-`@csquared.com` Google
   account is refused, and the hand-typed auth URL
   (`/realms/csquared/protocol/openid-connect/auth?client_id=csquared-cms&…`) goes to Google and
   never renders a password form.
5. Update `CLAUDE.md` (Auth paragraph) and the seeded-admin line: CMS sign-in is Google-only.

## Out of scope

- A Keycloak theme for the CMS. Keycloak's own error pages (an expired broker link, a failed Google
  link) stay stock. They are rare, and a theme can follow later if they turn out to matter.
- The realm-wide email theme, the DMP's theme and clients, and the `google` IdP.
- Moving group roles into the DB (the rest of the 2026-10-08 spec).
