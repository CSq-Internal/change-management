# CSquared CMS — Vercel Demo Deploy

A fast, no-IAM path to a shareable demo URL. **Temporary** — the Cloud Run /
on-prem path (`PROD-RUNBOOK.md`, `Dockerfile`) stays valid for the eventual
leadership decision; Vercel ignores the Dockerfile and builds Next.js natively.

**Topology:** Vercel (app) · **Neon** Postgres · your **org prod Keycloak** · **Google Drive** (service account).
**Drive is required, not optional:** submit gating needs all 5 documents, so without
Drive you can't move a change past `draft`. **Vercel caveat:** the upload route is a
Serverless Function with a **~4.5 MB request-body cap** (app allows 25 MB) — keep demo
files under ~4.5 MB; larger uploads 413 on Vercel (they'd work on Cloud Run).
**Skipped in the demo:** the SLA cron (escalation still runs lazily on page load).

---

## 1. Neon database
- Create a Neon project → you get **two** connection strings:
  - **Direct** (`...neon.tech`) — use for migrations/seed.
  - **Pooled** (`...-pooler...neon.tech`) — use for the app at runtime (serverless-safe).
- Both need `?sslmode=require`.

## 2. Migrate + seed (from your machine, against Neon DIRECT)
```bash
export DATABASE_URL='postgresql://USER:PASS@ep-xxx.neon.tech/DB?sslmode=require'   # DIRECT
pnpm prisma migrate deploy     # applies all 11 migrations
pnpm db:seed                   # 6 OpCos + admin (devops@csquared.com)
```

## 3. Vercel project
- Import the GitHub repo (`CSq-Internal/change-management`), production branch = **`dev`**.
- Framework preset: **Next.js** (auto-detected).
- **Settings → Node.js Version → 22.x** (required — pnpm 11.4 needs Node ≥ 22.13).
- Build/install are auto (pnpm via the `packageManager` field).

## 4. Environment variables (Vercel → Settings → Environment Variables)
| Key | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (`?sslmode=require`) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `NEXTAUTH_URL` | your Vercel URL (set after the first deploy — step 5) |
| `KEYCLOAK_ISSUER` | exact issuer from Keycloak discovery, e.g. `https://<org-keycloak>/auth/realms/<your-realm>` if Keycloak is mounted under `/auth` |
| `KEYCLOAK_CLIENT_ID` | `csquared-cms` |
| `KEYCLOAK_CLIENT_SECRET` | from 3a |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `csquared-cms-admin` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | from 3b |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the service-account JSON, single line (Drive — see step 4b) |
| `GDRIVE_SHARED_DRIVE_ID` | the Shared Drive ID |
| `GDRIVE_ROOT_FOLDER_ID` | root folder ID inside that drive |
| *(optional)* `KEYCLOAK_REALM` | only if the realm name isn't the one parsed from `KEYCLOAK_ISSUER` |
| *(optional)* `EMAIL_FROM` + `RESEND_API_KEY` | email notifications; without them, in-app notifications still work |
| *(omit)* | `CRON_SECRET` (no cron in demo), `NODE_ENV` (Vercel sets it), `PRISMA_ACCELERATE_URL`, `TEST_EMAIL_RECIPIENT` |

### 4b. Google Drive (required for the lifecycle)
Service account + a Shared Drive + a root folder — see `PROD-RUNBOOK.md` step 4 /
`docs/google-drive-setup.md`. Add the SA as **Content manager** on the Shared Drive.
Heads-up: minting the SA **key** needs `iam.serviceAccountKeys.create` on the SA's
project — given your `access-africa-01` IAM limits you may need an admin to create
the key (or reuse an existing Workspace SA key).

## 5. Deploy → capture the URL
- Deploy. Grab the production URL (e.g. `https://csquared-cms.vercel.app`).
- Set `NEXTAUTH_URL` to that URL and redeploy (so OIDC redirects/callbacks match).
  (A custom domain is cleaner if you have one — set `NEXTAUTH_URL` to it instead.)

## 6. Point Keycloak at the Vercel URL (login client `csquared-cms`)
In your org realm, on the `csquared-cms` client, add:
- **Valid redirect URI:** `https://<vercel-url>/api/auth/callback/keycloak`
- **Web origin:** `https://<vercel-url>` (or `+`)
- **Post logout:** `https://<vercel-url>/*` (or `+`)

(Leave any existing Cloud Run URIs in place — they can coexist.)

Before redeploying, verify issuer discovery returns `200` JSON and that the JSON
`issuer` field exactly matches `KEYCLOAK_ISSUER`:

```bash
curl -fsS "$KEYCLOAK_ISSUER/.well-known/openid-configuration" | jq -r .issuer
```

## 7. Smoke test
- Sign in via Keycloak as the admin → lands in the app with admin nav.
- Create a change, submit (note: **document upload will fail** — Drive deferred), approve via CAB, check the audit trail.
- Tenant isolation, dashboard, calendar, risk register, notifications.

---

## Notes
- **Migrations vs runtime URL:** migrate over the *direct* endpoint, run the app over the *pooled* endpoint (pgbouncer is happier for serverless; DDL is happier direct).
- **Auth on Vercel:** `AUTH_TRUST_HOST=true` + a stable `NEXTAUTH_URL` is the reliable combo; the Keycloak redirect URI must equal that URL exactly.
- **GCP leftovers are untouched/moot** here (the `csquared-cms-*` secrets, Cloud SQL). Clean them up only once the hosting decision is final.
- **Migrating later** to Cloud Run / on-prem = `PROD-RUNBOOK.md` (image already builds and is verified).
