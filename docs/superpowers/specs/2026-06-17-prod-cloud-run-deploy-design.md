# Prod Cloud Run Deploy Job — Design

**Date:** 2026-06-17
**Status:** Approved (design); awaiting spec review before planning

## Goal

Add a prod-only Cloud Run deployment stage to the existing CI/CD pipeline so that a push to
the `prod` branch automatically applies database migrations and deploys the freshly-built,
scanned image to the `cms-prod` Cloud Run service in `access-africa-01` / `europe-west1`.

## Background / current state

`.github/workflows/ci-cd.yml` has four jobs: `quality`, `test`, `dependency-audit`, and
`image`. The `image` job runs on push to `dev` or `prod`, builds the `runner` Docker target,
scans it (Trivy, fail on CRITICAL), generates an SBOM, and pushes two tags to Artifact
Registry `cms/csquared-cms`: an immutable `:<github.sha>` and a moving `:<branch>` (`:dev` /
`:prod`). There is **no deploy job** today.

GCP was provisioned on 2026-06-17 (project `access-africa-01`, region `europe-west1`):
- CI: AR repo `cms`, deploy SA `github-ci@access-africa-01.iam.gserviceaccount.com`, WIF pool
  `github` + provider `github-oidc`; the 5 GitHub Actions Variables are set
  (`GCP_PROJECT_ID`, `AR_REGION`, `AR_REPO`, `GCP_SA_EMAIL`, `GCP_WIF_PROVIDER`).
- Runtime (prod): SA `cms-run-prod@access-africa-01.iam.gserviceaccount.com`; 8 empty
  Secret Manager secrets `cms-prod-{database-url,nextauth-secret,keycloak-client-secret,
  keycloak-admin-client-secret,resend-api-key,app-password,google-service-account-key,
  cron-secret}`; the runtime SA has `secretAccessor` on those secrets; the deploy SA has
  `run.admin` (project) + `serviceAccountUser` on the runtime SA.

The Dockerfile has a dedicated `migrate` target (`prisma migrate deploy`) and a `runner`
target (the default serving image; only `runner` is pushed).

## Decisions (locked in brainstorming)

- **Scope:** prod only. No staging in this effort.
- **Trigger:** auto-deploy on push to `prod`. No manual-approval GitHub Environment.
- **Migrations:** run `prisma migrate deploy` in the pipeline, before the Cloud Run deploy.
- **Public URL:** custom domain `cms.csquarednet.com` (drives `NEXTAUTH_URL` + Keycloak
  redirect URIs). Domain mapping + DNS done out-of-band, once.
- **Config:** non-sensitive config via GitHub Actions Variables (nothing hardcoded);
  secrets via `--set-secrets` from Secret Manager.

## Architecture

One new job, `deploy`, appended to `.github/workflows/ci-cd.yml`.

```
quality ─┐
test ────┼─► image (push to dev|prod) ─► deploy (prod only)
         │
dependency-audit (independent)
```

### `deploy` job

- `name: Deploy to Cloud Run (prod)`
- `runs-on: ubuntu-latest`
- `needs: [image]`
- `if: github.event_name == 'push' && github.ref_name == 'prod'`
- `permissions: { contents: read, id-token: write }`
- `env: IMAGE: ${{ vars.AR_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ vars.AR_REPO }}/csquared-cms`

Steps:
1. `actions/checkout@v6` — needed for the Prisma schema + migrations in the migrate step.
2. `google-github-actions/auth@v3` — WIF, identical inputs to the `image` job
   (`workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}`, `service_account: ${{ vars.GCP_SA_EMAIL }}`).
3. `google-github-actions/setup-gcloud@v3`.
4. **Migrate:** set up Node 22 + pnpm (mirror the `test` job's setup), `pnpm install --frozen-lockfile`,
   then run `prisma migrate deploy` with `DATABASE_URL` exported from
   `gcloud secrets versions access latest --secret=cms-prod-database-url --project=${{ vars.GCP_PROJECT_ID }}`.
   The value is captured into the step's env (masked), never written to a file or logged.
5. **Deploy:** `gcloud run deploy cms-prod` with the flags below.

### `gcloud run deploy` invocation

```
gcloud run deploy cms-prod \
  --project   ${{ vars.GCP_PROJECT_ID }} \
  --region    ${{ vars.AR_REGION }} \
  --image     ${{ env.IMAGE }}:${{ github.sha }} \
  --service-account cms-run-prod@${{ vars.GCP_PROJECT_ID }}.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-secrets DATABASE_URL=cms-prod-database-url:latest,NEXTAUTH_SECRET=cms-prod-nextauth-secret:latest,KEYCLOAK_CLIENT_SECRET=cms-prod-keycloak-client-secret:latest,KEYCLOAK_ADMIN_CLIENT_SECRET=cms-prod-keycloak-admin-client-secret:latest,RESEND_API_KEY=cms-prod-resend-api-key:latest,APP_PASSWORD=cms-prod-app-password:latest,GOOGLE_SERVICE_ACCOUNT_KEY=cms-prod-google-service-account-key:latest,CRON_SECRET=cms-prod-cron-secret:latest \
  --set-env-vars NEXTAUTH_URL=${{ vars.PROD_NEXTAUTH_URL }},KEYCLOAK_ISSUER=${{ vars.PROD_KEYCLOAK_ISSUER }},KEYCLOAK_CLIENT_ID=${{ vars.PROD_KEYCLOAK_CLIENT_ID }},KEYCLOAK_ADMIN_CLIENT_ID=${{ vars.PROD_KEYCLOAK_ADMIN_CLIENT_ID }},EMAIL_FROM=${{ vars.PROD_EMAIL_FROM }},SMTP_USER=${{ vars.PROD_SMTP_USER }},GDRIVE_SHARED_DRIVE_ID=${{ vars.PROD_GDRIVE_SHARED_DRIVE_ID }},GDRIVE_ROOT_FOLDER_ID=${{ vars.PROD_GDRIVE_ROOT_FOLDER_ID }}
```

Notes:
- `--region` reuses `vars.AR_REGION` (both AR and Cloud Run are `europe-west1`) to avoid a
  redundant variable.
- AR region for the registry host equals the Cloud Run region here; if they ever diverge, a
  separate `RUN_REGION` variable would be introduced. Out of scope now.
- Using `--set-env-vars` / `--set-secrets` (not `--update-*`) makes the deploy declarative:
  the config block fully specifies env + secrets each deploy.

### IAM addition (provisioning, one-time)

Grant the deploy SA `secretAccessor` on **only** `cms-prod-database-url` so the migrate step
can read the DB URL (the deploy SA currently has no secret access; the runtime SA does):

```
gcloud secrets add-iam-policy-binding cms-prod-database-url \
  --project=access-africa-01 \
  --member="serviceAccount:github-ci@access-africa-01.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

This is a one-time command (run during implementation), not part of the workflow file.

### New GitHub Actions Variables (config, nothing hardcoded)

Set on `CSq-Internal/change-management` (values are non-sensitive):

| Variable | Value |
|---|---|
| `PROD_NEXTAUTH_URL` | `https://cms.csquarednet.com` |
| `PROD_KEYCLOAK_ISSUER` | `https://id.csquarednet.com/realms/csquared` |
| `PROD_KEYCLOAK_CLIENT_ID` | `csquared-cms` |
| `PROD_KEYCLOAK_ADMIN_CLIENT_ID` | `csquared-cms-admin` |
| `PROD_EMAIL_FROM` | `CSquared CMS <noreply@csquarednet.com>` |
| `PROD_SMTP_USER` | (the Gmail relay user, if SMTP fallback is used) |
| `PROD_GDRIVE_SHARED_DRIVE_ID` | (prod shared drive id) |
| `PROD_GDRIVE_ROOT_FOLDER_ID` | (prod root folder id) |

The user sets these (some values are still TBD by the user, e.g. GDrive ids). The workflow
references them; absent values surface as empty env at deploy, which is acceptable for the
optional integrations (SMTP/GDrive) and must be present for the Keycloak/NextAuth ones.

## Error handling

- A failed `prisma migrate deploy` fails the job before any `gcloud run deploy` runs — the
  service keeps the previous revision. (We already verified prod migrations apply cleanly.)
- A failed `gcloud run deploy` leaves the prior healthy revision serving (Cloud Run only
  shifts traffic to a revision that comes up healthy).
- The DB URL secret value is captured into a masked step env var, never echoed or persisted.

## Testing / verification

CI workflow changes can't be unit-tested. Verification is operational:
- `actionlint` (or a YAML lint) on the edited workflow to catch syntax errors before pushing.
- A dry-run sanity check of the `gcloud run deploy` command shape (documented, not executed
  in CI).
- First real end-to-end validation happens on the first push to `prod` AFTER the manual
  prerequisites are met (secrets, variables, domain mapping, `dev→prod` merge). This first
  deploy is the acceptance test: service reachable at `cms.csquarednet.com`, login works,
  a page renders.

## Manual prerequisites (outside this job; tracked, user-owned)

1. Populate the 8 `cms-prod-*` secret values (`gcloud secrets versions add … --data-file=-`).
   Includes rotating the exposed Neon password and storing the new URL.
2. Set the ~8 `PROD_*` GitHub Actions Variables above.
3. `gcloud run domain-mappings create --service cms-prod --domain cms.csquarednet.com` + the
   returned DNS record. (Cloud Run service must exist first — created by the first deploy.)
4. Register `https://cms.csquarednet.com/api/auth/callback/keycloak` (and the broker URIs) as
   valid redirect URIs on the `csquared-cms` Keycloak client.
5. Merge `dev → prod` so the prod branch actually contains the app before the first deploy.

## Out of scope

- Staging environment / `dev → cms-staging` deploy.
- Manual-approval GitHub Environment.
- Post-deploy smoke test (could be a follow-up step).
- Traffic splitting / canary / rollback automation (Cloud Run revisions provide basic
  rollback manually).
- DNS automation.
