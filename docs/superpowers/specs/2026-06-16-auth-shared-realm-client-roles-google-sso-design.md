# Auth Modernization: Shared Realm + Client Roles + Google SSO — Design

**Date:** 2026-06-16
**Status:** Draft — awaiting user review

## Goal

Re-establish working authentication for the production deployment on a shared,
multi-app Keycloak realm; scope CMS roles to the CMS client (not the whole realm);
and ship the v2 "Sign in with Google" feature (brokered through Keycloak, restricted
to the corporate Workspace domain).

## Background — why now

The IdP was migrated to a new host (`id.csquarednet.com`) and the Keycloak realm was
reconfigured/restarted. The deployed app's login broke in three escalating ways during
live testing:

1. `KEYCLOAK_ISSUER` pointed at the dead old host (`csquaredidp.ddns.net/auth/realms/csquared`)
   → OIDC discovery failed (invalid TLS + 404) → NextAuth `Configuration` error.
2. After fixing the issuer to `https://id.csquarednet.com/realms/csquared`, sign-in reached
   Keycloak but returned **"Client not found"** — the `csquared-cms` client no longer exists
   in the rebuilt realm.
3. The realm needs to be rebuilt anyway, which is the right moment to (a) adopt a clean
   multi-app structure and (b) wire the long-planned Google sign-in.

## Domain / environment facts

| Concern | Value |
|---|---|
| Corporate domain + Google Workspace | `csquared.com` (user identities, e.g. `devops@csquared.com`) |
| Internal app hosting + IdP | `csquarednet.com` (`csq-cms.vercel.app`, `id.csquarednet.com`) |
| Resend verified sender domain | `csquarednet.com` (`EMAIL_FROM` must be `@csquarednet.com`) |
| Keycloak issuer (correct) | `https://id.csquarednet.com/realms/csquared` (no `/auth` prefix — Quarkus distro) |
| Google sign-in allowed domain | `csquared.com` |

## Decisions (locked during brainstorming)

1. **One shared internal realm** (`csquared`), one client per internal app. No CMS-specific
   realm. CMS = the `csquared-cms` client.
2. **CMS roles become client roles** on `csquared-cms` (`group_admin`, `group_auditor`),
   read from `resource_access["csquared-cms"].roles` — not realm roles. Avoids cross-app
   collision in the shared realm.
3. **Google sign-in is brokered through Keycloak** (Google as a realm-level Identity Provider),
   not a direct NextAuth Google provider. Preserves the existing token-based enrichment and
   single identity authority.
4. **Google sign-in is restricted to `csquared.com`** Workspace accounts.

## What the app requires from the token (the identity contract)

From `auth.config.ts`, `auth-callbacks.ts`, `server/keycloak.ts`:

- **Group roles** — currently read from `realm_access.roles`; this design moves them to
  `resource_access["csquared-cms"].roles`. The app looks for `group_admin` / `group_auditor`.
- **Per-OpCo roles** (`requester`/`approver`/`auditor`/`admin`) — sourced from the **app DB**
  (`userOpCoAssignment`), NOT Keycloak. Unchanged by this work.
- **User linking** — on first sign-in the DB user is linked/created **by verified email**
  (`email_verified` gate). Any verified `@csquared.com` user auto-provisions as a no-access
  member until an admin assigns OpCos in-app.
- **Admin service account** — `client_credentials` client (`KEYCLOAK_ADMIN_CLIENT_ID`,
  default `csquared-cms-admin`) needing `realm-management → manage-users`.

---

## Workstream 1 — Shared realm + client rebuild (operator runbook, no app code)

Performed by the user in the Keycloak admin console at `id.csquarednet.com`.

**A. Realm** — confirm/create realm named exactly `csquared`.

**B. App login client `csquared-cms`**
- Client authentication: **On** (confidential); Standard flow: **On** (auth code + PKCE).
- Valid redirect URIs: `https://csq-cms.vercel.app/api/auth/callback/keycloak`
  and `http://localhost:3000/api/auth/callback/keycloak`.
- Valid post-logout redirect URIs: `https://csq-cms.vercel.app/*` (+ localhost).
- Web origins: `+`.
- Credentials tab → copy secret → Vercel `KEYCLOAK_CLIENT_SECRET`.

**C. Admin (provisioning) client `csquared-cms-admin`**
- Client authentication: **On**; Standard flow: **Off**; Service accounts roles: **On**.
- Service-account roles → `realm-management → manage-users` (required);
  `view-users`, `query-users` (recommended). `manage-organizations` optional (best-effort).
- Credentials tab → secret → Vercel `KEYCLOAK_ADMIN_CLIENT_SECRET`.

**D. Client roles** (see Workstream 2) — create `group_admin`, `group_auditor` as **client
roles on `csquared-cms`**.

**E. Bootstrap admin user** — create `devops@csquared.com`, Email verified **On**, set a
password, assign the `csquared-cms` client role `group_admin`. This alone makes them
group-tier on first login (no DB seeding required).

**F. Vercel env (re-verify) + redeploy**
- `KEYCLOAK_ISSUER=https://id.csquarednet.com/realms/csquared`
- `KEYCLOAK_CLIENT_ID=csquared-cms`, `KEYCLOAK_CLIENT_SECRET=…`
- `KEYCLOAK_ADMIN_CLIENT_ID=csquared-cms-admin`, `KEYCLOAK_ADMIN_CLIENT_SECRET=…`
- `NEXTAUTH_SECRET=…`, `NEXTAUTH_URL=https://csq-cms.vercel.app`, `AUTH_TRUST_HOST=true`
- `EMAIL_FROM=<something>@csquarednet.com` (Resend-verified domain)
- Env changes require a redeploy to take effect.

**G. Production DB** — separately ensure prod Postgres is migrated (`prisma migrate deploy`)
and has the OpCos. The bootstrap admin works without DB seeding because the email-link +
`group_admin` client role makes them group tier.

---

## Workstream 2 — Role model migration: realm roles → client roles (app code + Keycloak)

### Code change — `src/auth.config.ts`

Today:
```ts
token.realmRoles = (p.realm_access as { roles?: string[] })?.roles ?? []
```
Change the **source** to the CMS client's roles in `resource_access`:
```ts
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "csquared-cms"
const resourceAccess = p.resource_access as Record<string, { roles?: string[] }> | undefined
token.realmRoles = resourceAccess?.[clientId]?.roles ?? []
```

**Field naming:** keep the session field named `realmRoles` to stay surgical — ~30 call-sites
in `permissions.ts` and pages reference it, and they treat it as an opaque string array. Only
the source changes. Update the field comment in `src/types/next-auth.d.ts` to reflect that it
now carries CMS client roles. (Renaming to `appRoles` is deferred; not worth the churn.)

### Keycloak requirement — get client roles into the token NextAuth reads

NextAuth's Keycloak provider populates `profile` from the **ID token / userinfo**. The default
`roles` client scope's "client roles" mapper writes `resource_access.<clientId>.roles` to the
**access token** but, by default, **not** the ID token. So one of:
- Enable **"Add to ID token"** on the `csquared-cms` client-roles mapper (preferred — keeps the
  app reading `profile`), **or**
- Add a dedicated client-scope mapper that injects `resource_access` into the ID token.

**Exact Keycloak 26 mapper behavior to be confirmed against current docs during planning**
(via the docs-fetch tool) before finalizing the operator steps.

### Tests
- Update `src/test/auth*.test.ts` and `src/test/lib/permissions.test.ts` fixtures so the JWT
  profile carries `resource_access["csquared-cms"].roles` instead of `realm_access.roles`.
- Add a focused test: a profile with the client role `group_admin` yields
  `session.user.realmRoles = ["group_admin"]`; a profile with only a *realm* role does NOT.

---

## Workstream 3 — Google SSO: brokered + domain-restricted

### Flow

`Continue with Google` → `signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google" })`
→ Keycloak skips its own login screen and redirects straight to Google → Google returns the
user → Keycloak's broker endpoint validates the email domain → issues the normal token →
existing `enrichedJwt` links the DB user by verified email. A new `@csquared.com` user with no
OpCo lands as a member; an admin assigns roles in-app. The work-credentials "Sign in" button is
unchanged (no hint → Keycloak's own login).

### Google Cloud setup (operator)
- Use a Google Cloud project **owned by the `csquared.com` Workspace org**.
- OAuth consent screen: **Internal** (this is the primary domain boundary — only `csquared.com`
  accounts can consent).
- Create a **new** OAuth 2.0 client, type **Web application** (do not reuse a client another
  service depends on).
- Authorized redirect URI: `https://id.csquarednet.com/realms/csquared/broker/google/endpoint`.
- No extra Google APIs needed (basic OpenID/email/profile).

### Keycloak setup (operator) — realm-level IdP
- Realm → Identity Providers → add **Google**; paste the Google client ID/secret.
- Set the hosted-domain hint (`hd=csquared.com`).
- Add a **first-broker-login** check that **rejects** any brokered email not ending in
  `@csquared.com` (defense in depth — `hd` and Internal consent are the real boundary, this is
  the backstop against forced/edge cases).
- Because this is at the realm level, every internal app in `csquared` inherits Google sign-in.

### Code change — `src/app/login/page.tsx`
- `handleGoogleLogin` → `signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google" })`.
- `handleLogin` (work credentials) unchanged.
- Confirm the NextAuth v5 `next-auth/react` `signIn` third-argument (`authorizationParams`)
  appends `kc_idp_hint` to the authorize URL — verify against current docs during planning.

### Domain enforcement — single source of truth
Enforce the `csquared.com` restriction in **Keycloak only** (IdP `hd` + first-login check).
Do **not** duplicate the policy in `enrichedJwt`; the existing `email_verified` gate stays.
This avoids two divergent copies of the access rule.

### Tests
- RTL: the Google button calls `signIn` with `kc_idp_hint: "google"`; the work-creds button
  calls `signIn` without it. (Mock `next-auth/react`.)
- Live (Playwright): clicking "Continue with Google" redirects to `accounts.google.com` with the
  Keycloak broker `redirect_uri` and the hint present. (Completing Google auth requires real
  credentials and is verified manually.)

---

## Security considerations

- **Domain restriction** is enforced at Google (Internal consent + `hd`) and backstopped by
  Keycloak first-login. A non-`csquared.com` user cannot obtain a session.
- **No new secrets in the repo.** Google client ID/secret live in Keycloak; Keycloak/NextAuth
  secrets live in Vercel env. `.env`/`.env.local` are never committed.
- **Single identity authority** — all sign-in (work creds and Google) flows through Keycloak,
  so role enrichment, auditing (`keycloakId`), and user lifecycle stay consistent.
- **Least privilege** — the admin client holds only `manage-users` (+ read roles).

## Testing strategy (overall)

1. `pnpm test` green after the role-source change and login-page change (fixtures updated).
2. `pnpm tsc --noEmit` clean.
3. Live Playwright on `https://csq-cms.vercel.app`:
   - Work-credentials login → reaches Keycloak login → (manual creds) → dashboard renders with
     correct tier for `devops@csquared.com` (group).
   - Google button → redirects to Google with the broker redirect URI + `kc_idp_hint`.
   - Full authenticated functional sweep (dashboard, requests table + scope, new request,
     approvals, CAB, calendar, risk register, notifications, settings) once login succeeds.

## Out of scope

- Renaming the `realmRoles` field to `appRoles` (deferred; would churn ~30 files).
- Direct NextAuth Google provider (rejected — fragments identity/roles).
- Migrating other internal apps onto the shared realm (each gets its own client when needed).
- The Phase-2 Cloud Run CI/CD deploy (tracked separately).

## Risks / open items

- **Keycloak 26 token-mapper behavior** for client roles in the ID token — confirm during
  planning before the operator runs the steps.
- **NextAuth v5 `signIn` authorizationParams** passthrough for `kc_idp_hint` — confirm during
  planning.
- Operator steps (Keycloak realm, Google Cloud) are performed by the user in parallel with the
  code change; the code change is independently testable (RTL) but full live verification depends
  on the realm + IdP being configured.
