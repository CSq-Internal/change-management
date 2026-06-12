# v2 — Google Workspace integration (SSO domain restriction + profile enrichment)

**Date:** 2026-06-12
**Type:** Backlog brief / v2 candidate (not an implementation spec)
**Status:** Deferred to v2.0. Needs its own brainstorming → spec → plan cycle before build.

## Why this exists

CSquared CMS is an internal tool. Two related goals surfaced during the pre-production
review of the `/settings/profile` page:

1. **Access control** — only people with `@csquared.com` Google Workspace accounts should be
   able to sign in.
2. **Profile data** — the profile page should show real account info instead of an editable
   stub. For the MVP demo the page was reduced to a **read-only card** (name, email, OpCo &
   role from the NextAuth session, password/MFA deep-linked to the Keycloak Account Console).
   Pulling richer fields (job title, location/office) from Workspace is the v2 increment.

## Key architectural fact

The app **never talks to Google for auth** — it is a pure OIDC client of **Keycloak**
(`src/auth.config.ts`, single Keycloak provider; session name/email come from Keycloak ID-token
claims via `src/lib/auth-callbacks.ts`). Therefore Google Workspace integration happens at the
**Keycloak layer** (identity brokering), not in the Next.js auth code. There is no "Sign in with
Google" wiring to add in the app.

## Two tiers of profile data

| Tier | Fields | Source | Work required |
|------|--------|--------|---------------|
| 1 | name, email, photo, given/family name, locale | Standard Google OIDC claims | **Keycloak only** — IdP mappers copy claims into the token/session; the app already renders name + email. |
| 2 | job title, department, office/location, manager, phone | Google Workspace **Directory (Admin SDK)** — *not* in the OIDC token | **App-side** — Admin SDK Directory API (or People API) via the existing Drive service account (`GOOGLE_SERVICE_ACCOUNT_KEY`) **with domain-wide delegation** + `admin.directory.user.readonly` scope (Workspace super-admin grant). |

The empty "Job title" / "Location" inputs that were removed from the profile stub are exactly
Tier-2 fields — they require the Admin SDK, separate from Keycloak.

## Domain restriction (`@csquared.com` only)

Enforced at Keycloak (the correct gate):
1. Add **Google** as an Identity Provider in the realm (backed by a Google Cloud OAuth client).
2. Set the **hosted-domain (`hd`) parameter = `csquared.com`** so Google rejects non-Workspace
   accounts at the consent screen.
3. Add a **domain check on first-broker-login** to reject any non-csquared email that slips through.
4. *(Optional defense-in-depth)* reject non-`@csquared.com` emails in the `enrichedJwt` callback
   (`src/lib/auth-callbacks.ts`) — cheap, but Keycloak remains the real gate.

## Scope, size, dependencies

- **Tier 1 + domain restriction (SSO):** Keycloak realm config only. **Size: S–M.**
  Dependencies: a Google Cloud OAuth app; Workspace admin to set `hd`; touches the org's
  **production Keycloak realm** (handle with care — do not reconfigure right before a demo).
- **Tier 2 (directory enrichment of the profile page):** Admin SDK call + display wiring.
  **Size: M.** Dependencies: domain-wide delegation on the service account + Admin SDK scope
  (Workspace super-admin); a decision on caching vs. live fetch per profile view.

## Verdict

**v2 candidate — defer.** Real infrastructure work spanning production Keycloak and Google
Workspace admin; not a pre-demo change. Recommended order when greenlit: ship Tier 1 + domain
restriction first (the access-control goal), then Tier 2 directory enrichment as a follow-on.
The read-only profile card shipped for the demo stays correct after Tier 1 lands and can be
extended with Tier-2 fields without rework.

## Related

- v2 triage backlog: `docs/superpowers/specs/2026-06-08-v2-mockup-pages-triage.md`
  (Brief 3 `/settings/security` already resolved to a Keycloak Account-Console deep-link, which
  the shipped profile card now links to).
- Workplan: add to Phase 12 (v2.0).
