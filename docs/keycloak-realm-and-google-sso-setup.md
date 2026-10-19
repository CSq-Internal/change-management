# Keycloak realm + Google SSO setup (csquared-cms)

The CMS authenticates against the **shared internal realm `csquared`** on
`https://id.csquarednet.com`. CMS is one client (`csquared-cms`) in that realm — do not
create a CMS-specific realm. User identities are `@csquared.com` (Google Workspace);
hosting/IdP live on `csquarednet.com`.

## 1. App login client — `csquared-cms`
- Client authentication: **On** (confidential). Standard flow: **On** (auth code + PKCE).
- Valid redirect URIs:
  - `https://csq-cms.vercel.app/api/auth/callback/keycloak`
  - `http://localhost:3000/api/auth/callback/keycloak`
- Valid post-logout redirect URIs: `https://csq-cms.vercel.app/*` (+ `http://localhost:3000/*`).
  In prod this must include `https://cms.csquarednet.com/*`: Log out sends the user to
  Keycloak's end-session endpoint with `post_logout_redirect_uri=<app>/login`, and Keycloak
  rejects a URI not listed here (the user would see a Keycloak error instead of signing out).
- Web origins: `+`.
- Credentials tab → copy secret → Vercel `KEYCLOAK_CLIENT_SECRET`.

## 2. Admin (provisioning) client — `csquared-cms-admin`
- Client authentication: **On**. Standard flow: **Off**. Service accounts roles: **On**.
- Service-account roles → assign `realm-management → manage-users` (required);
  `view-users`, `query-users` (recommended). `manage-organizations` optional (best-effort).
- Credentials tab → secret → Vercel `KEYCLOAK_ADMIN_CLIENT_SECRET`.

## 3. Group roles live in the CMS

`group_admin` and `group_auditor` are not Keycloak roles. A group admin grants them in the CMS
(Users → Edit user → Group role), and every change is in the admin audit log. Keycloak holds
only the account. Do not add client roles or a client-role mapper to `csquared-cms`.

## 4. Bootstrap admin user
- Create user `devops@csquared.com`, **Email verified: On**, set a password.
- Sign in once, then mark the account as group admin in the database:
  `UPDATE "User" SET "isGroupAdmin" = true WHERE email = '<email>';`. After that, grant
  further group roles from the Users page.

## 5. Google SSO — brokered, restricted to csquared.com

### Google Cloud (project owned by the csquared.com Workspace org)
- OAuth consent screen: **Internal** (primary domain boundary — only `csquared.com` consent).
- Create a **new** OAuth 2.0 client, type **Web application** (do not reuse a shared client).
- Authorized redirect URI:
  `https://id.csquarednet.com/realms/csquared/broker/google/endpoint`
- No extra Google APIs needed (basic OpenID/email/profile).

### Keycloak (realm-level Identity Provider — all internal apps inherit it)
- Realm `csquared` → **Identity Providers** → **Google**.
- Paste the Google client ID + secret.
- Set **Hosted Domain** = `csquared.com` (the `hd` hint).
- First-broker-login: add/keep a flow that **rejects** any brokered email not ending in
  `@csquared.com` (defense in depth behind Internal consent + `hd`).

## 6. Vercel env (re-verify) + redeploy
- `KEYCLOAK_ISSUER=https://id.csquarednet.com/realms/csquared`
- `KEYCLOAK_CLIENT_ID=csquared-cms`, `KEYCLOAK_CLIENT_SECRET=…`
- `KEYCLOAK_ADMIN_CLIENT_ID=csquared-cms-admin`, `KEYCLOAK_ADMIN_CLIENT_SECRET=…`
- `NEXTAUTH_SECRET=…`, `NEXTAUTH_URL=https://csq-cms.vercel.app`, `AUTH_TRUST_HOST=true`
- `EMAIL_FROM=<sender>@csquarednet.com` (Resend-verified domain)
- Env changes require a redeploy.

## 7. Production DB
Ensure prod Postgres is migrated (`prisma migrate deploy`) and has the OpCos. The bootstrap
admin needs no DB seeding beyond step 4 (email link; group tier comes from `User.isGroupAdmin`).
