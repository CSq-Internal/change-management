# CSquared CMS — Production Deploy Runbook (Cloud Run)

Concrete, ordered steps to deploy the containerised app. Topology:
**Cloud Run** (app) · **Cloud SQL for PostgreSQL** · **Google Secret Manager** ·
**existing org Keycloak** (you add 2 clients) · **Cloud Scheduler** (SLA cron).

> This is the executable companion to `docs/prod-release-integration-plan.html`
> (the high-level plan). Run the steps in order. Migrations run as a **separate
> step** (a Cloud Run Job) — the serving container never migrates.

---

## 0. Set variables (edit these once, then copy-paste the rest)

```bash
export PROJECT_ID=your-gcp-project
export REGION=europe-west1               # pick your region
export AR_REPO=csquared                  # Artifact Registry repo
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/csquared-cms
export MIGRATE_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/csquared-cms-migrate
export TAG=v1.0.0
export SQL_INSTANCE=csquared-pg
export DB_NAME=csquared_cms
export DB_USER=csquared_app
export SERVICE=csquared-cms              # Cloud Run service name

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com
```

---

## 1. Artifact Registry + build & push both images

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="CSquared CMS images" 2>/dev/null || true

gcloud auth configure-docker "$REGION-docker.pkg.dev"

# Serving image (default target) and the migration image (--target migrate)
docker build -t "$IMAGE:$TAG" .
docker build --target migrate -t "$MIGRATE_IMAGE:$TAG" .
docker push "$IMAGE:$TAG"
docker push "$MIGRATE_IMAGE:$TAG"
```
> Apple-silicon dev machines: add `--platform linux/amd64` to both `docker build`
> commands so the image runs on Cloud Run.

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

> `KEYCLOAK_ISSUER` = `https://<your-keycloak>/realms/<your-realm>`.
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

## 5. Secret Manager — create every secret

```bash
create_secret () { # name value
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret DATABASE_URL              "postgresql://$DB_USER:$DB_PASSWORD@localhost/$DB_NAME?host=/cloudsql/$SQL_CONN"
create_secret NEXTAUTH_SECRET           "$(openssl rand -base64 32)"
create_secret KEYCLOAK_CLIENT_SECRET    "paste-from-3a"
create_secret KEYCLOAK_ADMIN_CLIENT_SECRET "paste-from-3b"
create_secret GOOGLE_SERVICE_ACCOUNT_KEY "$(cat /path/to/sa-key.json)"
create_secret RESEND_API_KEY            "paste-or-skip"
create_secret CRON_SECRET               "$(openssl rand -base64 24)"

# Cloud Run's runtime service account needs read access:
export RUN_SA="$(gcloud iam service-accounts list --filter='displayName:Compute Engine default' --format='value(email)' | head -1)"
for s in DATABASE_URL NEXTAUTH_SECRET KEYCLOAK_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET \
         GOOGLE_SERVICE_ACCOUNT_KEY RESEND_API_KEY CRON_SECRET; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor"
done
```

---

## 6. Run migrations (separate step — a Cloud Run Job)

```bash
gcloud run jobs create migrate \
  --image "$MIGRATE_IMAGE:$TAG" --region "$REGION" \
  --set-cloudsql-instances "$SQL_CONN" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --max-retries 1 --task-timeout 600

gcloud run jobs execute migrate --region "$REGION" --wait    # applies all 11 migrations
```
Then seed the baseline (6 OpCos + admin) **once** — run the seed against the prod
`DATABASE_URL` (e.g. a one-off `gcloud run jobs` with `command: pnpm db:seed`, or
locally through the Cloud SQL Auth Proxy). Confirm it's safe to skip on re-deploys.

---

## 7. Deploy the Cloud Run service

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE:$TAG" --region "$REGION" --port 8080 \
  --add-cloudsql-instances "$SQL_CONN" \
  --set-env-vars "NODE_ENV=production,AUTH_TRUST_HOST=true,\
KEYCLOAK_ISSUER=https://<your-keycloak>/realms/<your-realm>,\
KEYCLOAK_CLIENT_ID=csquared-cms,KEYCLOAK_ADMIN_CLIENT_ID=csquared-cms-admin,\
GDRIVE_SHARED_DRIVE_ID=<id>,GDRIVE_ROOT_FOLDER_ID=<id>,EMAIL_FROM=changes@yourdomain" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,\
KEYCLOAK_CLIENT_SECRET=KEYCLOAK_CLIENT_SECRET:latest,\
KEYCLOAK_ADMIN_CLIENT_SECRET=KEYCLOAK_ADMIN_CLIENT_SECRET:latest,\
GOOGLE_SERVICE_ACCOUNT_KEY=GOOGLE_SERVICE_ACCOUNT_KEY:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest,CRON_SECRET=CRON_SECRET:latest" \
  --allow-unauthenticated     # this is a user-facing web app

export RUN_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "Deployed: $RUN_URL"

# Now set NEXTAUTH_URL to the real URL (and the Keycloak redirect URI from 3a):
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "NEXTAUTH_URL=$RUN_URL"
```

---

## 8. SLA cron (Cloud Scheduler → Cloud Run)

```bash
export CRON_SECRET_VAL="$(gcloud secrets versions access latest --secret=CRON_SECRET)"
gcloud scheduler jobs create http sla-escalation \
  --location "$REGION" --schedule "0 * * * *" \
  --uri "$RUN_URL/api/cron/sla" --http-method POST \
  --headers "x-cron-secret=$CRON_SECRET_VAL" \
  --oidc-service-account-email "$RUN_SA"   # drop if the service is public + header-only
```

---

## 9. Smoke + UAT (gating)

- Sign in via Keycloak as the admin; session carries expected realm roles + OpCos.
- Create a change, upload all 5 documents to Drive, submit (gating enforced).
- Approve via the CAB route; SoD blocks requester=approver; audit entries are immutable.
- Tenant isolation: OpCo A user cannot read OpCo B's change.
- Notifications fire (in-app + email); trigger the cron once (`gcloud scheduler jobs run sla-escalation --location $REGION`) and confirm escalation.
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
