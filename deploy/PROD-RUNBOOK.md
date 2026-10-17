# CSquared CMS — Production Deploy Runbook (Cloud Run)

Concrete, ordered steps to deploy the containerised app. Topology:
**Cloud Run** (app) · **Cloud SQL for PostgreSQL** · **Google Secret Manager** ·
**existing org Keycloak** (you add 2 clients) · **Cloud Scheduler** (SLA cron).

> This is the executable companion to `docs/prod-release-integration-plan.html`
> (the high-level plan). Steps 0-5 are one-time setup. After that, every push to
> `prod` builds, migrates and deploys through `.github/workflows/ci-cd.yml` (steps 6-7).
> The serving container never migrates.

---

## 0. Set variables (edit these once, then copy-paste the rest)

```bash
export PROJECT_ID=access-africa-01
export REGION=europe-west1               # = GitHub variable AR_REGION
export AR_REPO=cms                       # = GitHub variable AR_REPO
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/csquared-cms
export TAG=v1.0.0
export SQL_INSTANCE=csq-cms-prod         # ci-cd.yml proxies to this instance by name
export DB_NAME=csquared_cms
export DB_USER=csquared_app
export SERVICE=cms-prod                  # ci-cd.yml deploys this service

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com
```

---

## 1. Artifact Registry

`scripts/provision-gcp-cicd.sh` creates the repository and CI's push rights. CI builds
and pushes the image itself; build by hand only to test the Dockerfile.

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="CSquared CMS images" 2>/dev/null || true

gcloud auth configure-docker "$REGION-docker.pkg.dev"

docker build --target runner -t "$IMAGE:$TAG" .
```
> Apple-silicon dev machines: add `--platform linux/amd64` so the image runs on Cloud Run.

---

## 2. Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 --region="$REGION" \
  --tier=db-custom-1-3840 --storage-auto-increase \
  --backup --enable-point-in-time-recovery

gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

# Strong DB password
export DB_PASSWORD="$(openssl rand -base64 24)"
gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"

export SQL_CONN="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
echo "Cloud SQL connection name: $SQL_CONN"
```

**DATABASE_URL for Cloud Run** (Unix socket via the built-in Cloud SQL connector):
```
postgresql://$DB_USER:$DB_PASSWORD@localhost/$DB_NAME?host=/cloudsql/$SQL_CONN
```
(Stored as a secret in step 5.)

---

## 3. Keycloak — create 2 clients in your existing prod realm

In your org's prod realm (note its name; the app derives the realm from
`KEYCLOAK_ISSUER`, or set `KEYCLOAK_REALM` to override):

> **You don't have the Cloud Run URL yet — that's fine.** Creating a client and
> copying its secret does NOT need the URL; only the redirect URI / web origin do.
> So: create both clients now with a placeholder redirect URI, grab the secrets,
> and continue. After **step 7** prints the `*.run.app` URL, come back and set the
> real redirect URI + web origin (and `NEXTAUTH_URL`). To set it up front instead,
> predict the URL:
> ```bash
> PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
> echo "https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"   # verify after deploy
> ```

**3a. Login client** — `csquared-cms`
- Client type: **OpenID Connect**, **confidential** (Client authentication ON).
- Standard flow ON; Direct access / implicit OFF.
- Valid redirect URI: `https://<CLOUD_RUN_URL>/api/auth/callback/keycloak`
  (placeholder for now if you don't have the URL — set it after step 7)
- Web origin: `https://<CLOUD_RUN_URL>` (same — set after step 7)
- Add a **mapper**: type *User Realm Role* → token claim name `realm_access.roles`,
  multivalued, add to ID + access token. (Emits `realm_access.roles`, consumed by `auth.config.ts`.)
- Copy the client secret → `KEYCLOAK_CLIENT_SECRET`.

**3b. Admin service-account client** — `csquared-cms-admin`
- Confidential; **Service accounts roles ON**; Standard flow OFF.
- Service account → **Assign roles** → filter **by clients** → `realm-management` →
  assign **`manage-users`** (and nothing else — least privilege).
- Copy the client secret → `KEYCLOAK_ADMIN_CLIENT_SECRET`.

**3c. Google-only sign-in** (after the app is live)
- Follow `docs/keycloak-cms-google-only-flow.md`: a `cms-google-only` browser-flow
  override on `csquared-cms`, so the CMS never shows a password form.
- Follow `docs/keycloak-first-broker-login-autolink.md`: a `cms-google-autolink`
  first-login override on `google-csquared`, so an onboarded user's first Google sign-in
  links to their account without an "Account already exists" screen.

> **About `manage-organizations` (verified on Keycloak 26.6):** don't bother — the
> `realm-management` `manage-organizations` role is **not seeded** when you enable
> Organizations (confirmed: neither realm import nor native realm creation adds it),
> and hand-creating a role by that name does **not** authorize the org Admin API (403).
> This is fine: the app's Keycloak **organization** sync (mirroring OpCos as KC orgs)
> is **best-effort** — it logs and skips on failure. `manage-users` is the only hard
> requirement (user onboarding/deactivation). So assign just `manage-users` and move on.
> If KC org-mirroring becomes a real requirement later, it needs separate work on
> Keycloak's admin permissions — it is **not** a deploy blocker, and do **not** grant
> the broad `realm-admin` role just for it.

> `KEYCLOAK_ISSUER` must be the exact issuer from Keycloak discovery, e.g.
> `https://<your-keycloak>/auth/realms/<your-realm>` if Keycloak is mounted under
> `/auth`. Verify before deploy:
> ```bash
> curl -fsS "$KEYCLOAK_ISSUER/.well-known/openid-configuration" | jq -r .issuer
> ```
> The chicken/egg with the redirect URI in 3a: you can deploy once to learn the
> Cloud Run URL (step 7), then set the redirect URI + `NEXTAUTH_URL`, or map a
> custom domain first and use that.

---

## 4. Google Drive (service account + Shared Drive)

1. Create a service account (or reuse your Workspace one); create a JSON key →
   this whole JSON (single line) is `GOOGLE_SERVICE_ACCOUNT_KEY`.
2. Enable the **Drive API** on the project.
3. Create a private **Shared Drive** "Change Management"; add the service account
   as **Content manager**. Capture its ID → `GDRIVE_SHARED_DRIVE_ID`.
4. Create a root folder inside it; capture its ID → `GDRIVE_ROOT_FOLDER_ID`.
   (See `docs/google-drive-setup.md`.)

---

## 5. Secret Manager, runtime account and CI access

The `deploy` job in `.github/workflows/ci-cd.yml` is the source of truth for secret
names and env vars. If this section and that file disagree, the file wins.

```bash
# Creates the runtime account cms-run-prod, an EMPTY cms-prod-<key> secret per key,
# read access for cms-run-prod on each, and deploy rights for github-ci.
PROJECT_ID=$PROJECT_ID REGION=$REGION ./scripts/provision-gcp-runtime.sh prod

add_version () { # secret-name value
  printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}
# The password is URL-encoded: base64 passwords can contain / + =.
DB_PW_ENC="$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["DB_PASSWORD"], safe=""))')"

add_version cms-prod-database-url  "postgresql://$DB_USER:$DB_PW_ENC@localhost/$DB_NAME?host=/cloudsql/$SQL_CONN"
add_version cms-prod-nextauth-secret "$(openssl rand -base64 32)"   # once; re-adding signs everyone out
add_version cms-prod-keycloak-client-secret       "paste-from-3a"
add_version cms-prod-keycloak-admin-client-secret "paste-from-3b"
add_version cms-prod-google-service-account-key   "$(cat /path/to/sa-key.json)"
add_version cms-prod-resend-api-key               "paste-from-resend"
add_version cms-prod-cron-secret   "$(openssl rand -base64 24)"     # once; the scheduler reads it
```

CI migrates through the Cloud SQL Auth Proxy on `127.0.0.1:5432`, so it needs its own
URL in a secret that only `github-ci` can read:

```bash
gcloud secrets create cms-prod-database-url-ci --replication-policy=automatic
add_version cms-prod-database-url-ci "postgresql://$DB_USER:$DB_PW_ENC@127.0.0.1:5432/$DB_NAME"
gcloud secrets add-iam-policy-binding cms-prod-database-url-ci \
  --member="serviceAccount:github-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client" --condition=None
# The service connects over the Cloud SQL socket as cms-run-prod:
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cms-run-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client" --condition=None
```

Then set the GitHub Actions variables the deploy job reads (`gh variable set NAME --body ...`):
`PROD_NEXTAUTH_URL`, `PROD_KEYCLOAK_ISSUER`, `PROD_KEYCLOAK_CLIENT_ID`,
`PROD_KEYCLOAK_ADMIN_CLIENT_ID`, `PROD_EMAIL_FROM`, `PROD_SMTP_USER`,
`PROD_GDRIVE_SHARED_DRIVE_ID`, `PROD_GDRIVE_ROOT_FOLDER_ID`.
`scripts/provision-gcp-cicd.sh --set-gh-vars` sets the other five.

---

## 6. Migrations

Every push to `prod` runs `pnpm prisma migrate deploy` in CI, through the Auth Proxy,
before the new revision deploys. A failed migration stops the deploy, and a running prod
deploy is never cancelled by a newer push. Take a Cloud SQL backup before merging a PR
that adds a migration.

To migrate by hand (for example, to seed the baseline once), use the same path:

```bash
cloud-sql-proxy --port 5432 "$PROJECT_ID:$REGION:$SQL_INSTANCE" &
DATABASE_URL="$(gcloud secrets versions access latest --secret=cms-prod-database-url-ci)" \
  pnpm prisma migrate deploy
DATABASE_URL="$(gcloud secrets versions access latest --secret=cms-prod-database-url-ci)" \
  pnpm db:seed     # first install only: 6 OpCos + admin
```

---

## 7. Deploy

Merge `dev` into `prod`. CI builds the `runner` image, scans it, pushes
`$IMAGE:<commit sha>` and `$IMAGE:prod`, migrates, then deploys `cms-prod` as
`cms-run-prod` with the secrets and env vars listed in `ci-cd.yml`. Both lists are
overwritten on every deploy, so a value set by hand on the service is lost at the next one.

The Cloud SQL socket mount is not in `ci-cd.yml`. It was set once and carries over to each
new revision. A brand-new service needs it before the first CI deploy:

```bash
gcloud run services update "$SERVICE" --region "$REGION" \
  --add-cloudsql-instances "$PROJECT_ID:$REGION:$SQL_INSTANCE"
```

Rollback: redeploy an earlier image. Migrations are forward-only.

```bash
gcloud run services update "$SERVICE" --region "$REGION" --image "$IMAGE:<previous sha>"
```

The service is mapped to `https://cms.csquarednet.com` (`PROD_NEXTAUTH_URL`). That is the
URL for the Keycloak redirect URI and web origin in 3a.

---

## 8. SLA cron (Cloud Scheduler → Cloud Run)

```bash
PROJECT_ID=access-africa-01 REGION=europe-west1 ./scripts/provision-gcp-scheduler.sh prod
```

Creates (or updates) job `cms-prod-sla`, every 15 minutes, POSTing to the live service URL
with the `x-cron-secret` header read from `cms-prod-cron-secret`.

Alerting (email on any `cms-prod` ERROR log, at most one per 30 minutes, plus uptime checks
on the `/login` page and the Keycloak issuer):

```bash
PROJECT_ID=access-africa-01 REGION=europe-west1 ALERT_EMAIL=you@csquared.com ./scripts/provision-gcp-alerting.sh prod
```

---

## 9. Smoke + UAT (gating)

- Sign in via Keycloak as the admin; session carries expected realm roles + OpCos.
- Create a change, upload all 5 documents to Drive, submit (gating enforced).
- Approve via the CAB route; SoD blocks requester=approver; audit entries are immutable.
- Tenant isolation: OpCo A user cannot read OpCo B's change.
- Notifications fire (in-app + email); trigger the cron once (`gcloud scheduler jobs run cms-prod-sla --location $REGION`) and confirm escalation.
- Auditor CSV / PDF evidence export works.
- Business UAT sign-off across requester / approver / auditor / admin.

---

## Notes

- **Release tag:** the `dev → prod` integration (PR #2) is the code release; tag it
  `v1.0.0` on merge (`git tag -a v1.0.0`). Use the same `$TAG` for the images.
- **Rollback:** redeploy the previous image tag. Migrations are forward-only — take
  a Cloud SQL backup immediately before the migrate job.
- **Keycloak admin scope:** the app only ever touches your realm via the
  `csquared-cms-admin` service account with **`manage-users`** — no master access.
  User onboarding/deactivation require this client; OpCo→KC-org mirroring is
  best-effort (and currently no-ops on KC 26.6 — see 3b).
