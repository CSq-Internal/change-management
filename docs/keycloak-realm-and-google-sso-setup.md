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
- Valid post-logout redirect URIs: `https://csq-cms.vercel.app/*` (+ localhost).
- Web origins: `+`.
- Credentials tab → copy secret → Vercel `KEYCLOAK_CLIENT_SECRET`.

## 2. Admin (provisioning) client — `csquared-cms-admin`
- Client authentication: **On**. Standard flow: **Off**. Service accounts roles: **On**.
- Service-account roles → assign `realm-management → manage-users` (required);
  `view-users`, `query-users` (recommended). `manage-organizations` optional (best-effort).
- Credentials tab → secret → Vercel `KEYCLOAK_ADMIN_CLIENT_SECRET`.

## 3. CMS client roles (scoped to this app)
- On the `csquared-cms` client → **Roles** → create `group_admin` and `group_auditor`.
- These are *client* roles, so they don't collide with other apps in the shared realm.
- Per-OpCo roles (requester/approver/auditor/admin) are stored in the app DB — NOT here.

## 4. Put client roles into the ID token (required)
By default Keycloak adds roles to the **access token only**. NextAuth reads the **ID token**,
so add a dedicated mapper on this client:
- `csquared-cms` client → **Client scopes** → `csquared-cms-dedicated` → **Add mapper** →
  **By configuration** → **User Client Role**.
  - Client ID: `csquared-cms`
  - Token Claim Name: `resource_access.${client_id}.roles`
  - Claim JSON Type: `String`, **Multivalued: On**
  - **Add to ID token: On**, **Add to userinfo: On**, Add to access token: On
- Result: the token carries `resource_access["csquared-cms"].roles = ["group_admin", …]`,
  which `auth.config.ts` reads into `session.user.realmRoles`.

## 5. Bootstrap admin user
- Create user `devops@csquared.com`, **Email verified: On**, set a password.
- Assign the `csquared-cms` client role `group_admin`. This alone yields group tier on
  first login (the app links the DB user by verified email; no DB seeding needed).

## 6. Google SSO — brokered, restricted to csquared.com

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

## 7. Vercel env (re-verify) + redeploy
- `KEYCLOAK_ISSUER=https://id.csquarednet.com/realms/csquared`
- `KEYCLOAK_CLIENT_ID=csquared-cms`, `KEYCLOAK_CLIENT_SECRET=…`
- `KEYCLOAK_ADMIN_CLIENT_ID=csquared-cms-admin`, `KEYCLOAK_ADMIN_CLIENT_SECRET=…`
- `NEXTAUTH_SECRET=…`, `NEXTAUTH_URL=https://csq-cms.vercel.app`, `AUTH_TRUST_HOST=true`
- `EMAIL_FROM=<sender>@csquarednet.com` (Resend-verified domain)
- Env changes require a redeploy.

## 8. Production DB
Ensure prod Postgres is migrated (`prisma migrate deploy`) and has the OpCos. The bootstrap
admin works without DB seeding (email link + `group_admin` client role → group tier).
