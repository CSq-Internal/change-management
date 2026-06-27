# Enabling Google profile avatars (Keycloak operator steps)

The app already inherits a user's avatar from the standard OIDC `picture` claim:
`auth.config.ts` reads `profile.picture` → `token.picture`, `sessionFromToken`
copies it to `session.user.image`, and `app-shell.tsx` renders it (falling back to
the user's initials). **No app changes are needed** — avatars light up as soon as
Keycloak puts `picture` in the `csquared-cms` token.

Because users sign in via the brokered Google IdP, two pieces of Keycloak config on
`id.csquarednet.com` (realm `csquared`) are required:

## 1. Import Google's picture into a user attribute (Google IdP mapper)

Identity Providers → **google-csquared** → Mappers → **Add mapper**

- Name: `picture`
- Mapper type: **Attribute Importer**
- Claim (in external token): `picture`
- User Attribute Name: `picture`

This copies Google's `picture` URL onto the federated user's `picture` attribute on
each login.

## 2. Expose the attribute as a `picture` token claim (client mapper)

Clients → **csquared-cms** → Client scopes → `csquared-cms-dedicated` → **Add mapper → By configuration → User Attribute**

- Name: `picture`
- User Attribute: `picture`
- Token Claim Name: `picture`
- Claim JSON Type: `String`
- Add to ID token: **On**
- Add to userinfo: **On**

(If a built-in `picture` mapper already exists on the default `profile` client scope,
it may be enough on its own once step 1 populates the attribute.)

## Verify

Sign in with a `@csquared.com` Google account that has a profile photo; the avatar in
the top bar should show the Google photo instead of initials. Users without a photo
(or before this config) keep clean initials.
