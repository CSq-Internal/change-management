# Re-invited SSO users: first-broker-login auto-link (Keycloak operator steps)

When the app DB is wiped but Keycloak is not, re-inviting a user adopts the existing
Keycloak account (the app does this automatically — see Part B of the V3 auth-flow pass).
For **Google-SSO** users to then sign in cleanly, Keycloak's brokered login must **link the
incoming Google identity to the pre-existing account by verified email** instead of stopping
with "an account already exists." Otherwise the user hits a manual link/verify prompt — the
"can't sign in" symptom.

This is realm config on `id.csquarednet.com`, realm `csquared`. No app change is needed.

## 1. Trust the Google IdP's email

Identity Providers → **google-csquared** → ensure **Trust Email = ON**.
(Already set during the self-registration work — confirm it's still on.) This makes brokered
emails arrive verified, which is what lets Keycloak auto-link by email.

## 2. Ensure the First Broker Login flow auto-links

Authentication → Flows → **First broker login**:

- The flow's *Detect existing broker user* / **"Confirm link existing account"** step should
  resolve a match by email automatically rather than requiring the user to re-authenticate or
  re-verify. With Trust Email ON, the built-in flow links the verified email automatically.
- If your realm uses a customized first-broker-login flow, either:
  - keep the default flow for `google-csquared`, **or**
  - make a copy and set the *Verify existing account by Email* / link step so a verified
    email auto-links (no user prompt).

> The default Keycloak first-broker-login flow already auto-links when the incoming email is
> verified and matches an existing user. The main failure mode is Trust Email being OFF or a
> customized flow that forces re-verification — check those first.

## 3. Verify

1. Pick a test `@csquared.com` user that already exists in Keycloak.
2. Remove (or simulate the absence of) their app DB row, then re-invite them from
   **User Management → Onboard User**.
3. Sign in with **Sign in with Google** as that user.
4. Expected: Keycloak links to the existing account silently and the user lands
   authenticated — no "account already exists" / manual-link prompt. The app's invite-time
   reconcile has already ensured the account is enabled + email-verified.

## Related

- App-side reconcile: `onboardUser` in `src/server/actions/users.ts` (federated detection,
  enable+verify, password reset for password users).
- Avatar inheritance operator doc: `docs/keycloak-google-picture-mapper.md`.
- Design: `docs/superpowers/specs/2026-06-27-v3-auth-flow-pass-design.md`.
