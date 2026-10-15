# CMS sign-in: Google only (Keycloak operator steps)

The CMS signs people in with Google `@csquared.com` accounts only. The app already
refuses anything else (`signIn` callback in `src/auth.config.ts`). This Keycloak setting
makes sure the CMS never shows a password form, even when someone types the Keycloak
address by hand.

Realm `csquared` on `id.csquarednet.com` is shared with the DMP and other apps.
Everything below is on the `csquared-cms` client or a new, unattached flow. Do not change
the realm's own browser flow.

## Before you start

List the CMS's Keycloak accounts with no Google link (Users → user → Identity provider
links). A real `@csquared.com` mailbox links itself on its first Google sign-in (silently
once `docs/keycloak-first-broker-login-autolink.md` is applied, otherwise through an
emailed link). An address with no mailbox loses CMS access once this is on; emergency
access is the Keycloak admin console.

## 1. Create the flow

1. Authentication → **Create flow**. Name `cms-google-only`, type **Basic flow**. Create.
2. **Add execution** → **Identity Provider Redirector**. Requirement **Required**.
3. Its ⚙ settings: alias `cms-google-csquared`, **Default Identity Provider**
   `google-csquared`. Save.

No Cookie step, on purpose: a Keycloak session started elsewhere (a DMP password
sign-in) must not carry into the CMS.

## 2. Attach it to the CMS client only

Clients → `csquared-cms` → **Advanced** → *Authentication flow overrides* →
**Browser flow** = `cms-google-only`. Save. It takes effect at once; no restart.

## 3. Check

- Open `https://id.csquarednet.com/realms/csquared/protocol/openid-connect/auth?client_id=csquared-cms&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fcms.csquarednet.com%2Fapi%2Fauth%2Fcallback%2Fkeycloak`
  in a private window. It must go straight to Google and never show a password form.
- Sign in to https://cms.csquarednet.com with your own account, sign out, and sign in again.
- Try a non-`@csquared.com` Google account: Google refuses it, or the CMS shows
  "Access refused".

## Undo

Clients → `csquared-cms` → Advanced → clear the **Browser flow** override. Save.

## Also required

`google-csquared` keeps **Trust Email = ON** and hosted domain `csquared.com`, and its
first login flow override is `cms-google-autolink`
(see `docs/keycloak-first-broker-login-autolink.md`).
