# CMS first Google sign-in: link existing accounts silently (Keycloak operator steps)

Onboarding creates each user's Keycloak account before they ever sign in (with no
password). On that user's first Google sign-in, Keycloak's default **first broker login**
flow does **not** link the Google identity to the existing account by itself. It stops at
"Account already exists", the user clicks **Add to existing account**, and Keycloak emails
them a link to confirm (seen in prod on 15 Oct 2026). It works, but it is an extra screen
and an inbox trip for every user, once.

This change makes that first sign-in link silently. It is set on the `google-csquared`
identity provider only. The DMP signs in through `social-google`, so it is not affected,
and the realm's own first broker login flow stays as it is.

Linking by email is safe here only because Google already refuses accounts outside the
CSquared Workspace (`Error 403: org_internal`), so only a Google-verified `@csquared.com`
identity can claim the matching Keycloak account.

## Before you start

Identity providers → **google-csquared**: **Trust Email** is ON and the hosted domain is
`csquared.com`.

## 1. Create the flow

1. Authentication → Flows → **first broker login** → ⋮ → **Duplicate**. Name
   `cms-google-autolink`.
2. In the copy, open the **User creation or linking** sub-flow:
   - **Create User If Unique**: **Alternative** (as it is).
   - **Handle Existing Account**: **Disabled**.
   - **Add step** → **Automatically set existing user**: **Alternative**.

## 2. Attach it to google-csquared only

Identity providers → **google-csquared** → *Advanced settings* → **First login flow
override** = `cms-google-autolink`. Save. It takes effect at once.

## 3. Check

Use an onboarded `@csquared.com` user who has never signed in with Google (Users → user →
*Identity provider links* is empty). Sign in at https://cms.csquarednet.com. Expected: no
"Account already exists" screen and no email; the user lands in the CMS, and the user's
*Identity provider links* now shows `google-csquared`.

## Undo

Identity providers → **google-csquared** → **First login flow override** =
`first broker login`. Save. Users then get the email-confirm step again.

## Related

- App side: `createOrFindKeycloakUser` in `src/server/keycloak.ts` creates the account
  enabled, email-verified and with no password.
- Google-only browser flow: `docs/keycloak-cms-google-only-flow.md`.
