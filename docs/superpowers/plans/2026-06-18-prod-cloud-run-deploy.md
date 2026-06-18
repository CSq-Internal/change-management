# Prod Cloud Run Deploy Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prod-only `deploy` job to `.github/workflows/ci-cd.yml` that, on push to `prod`, applies DB migrations and deploys the scanned image to the `cms-prod` Cloud Run service.

**Architecture:** New `deploy` job, `needs: [image]`, gated to `push` on `prod`. Steps: WIF auth → in-pipeline `prisma migrate deploy` (DB URL fetched from Secret Manager via `gcloud`) → `google-github-actions/deploy-cloudrun@v2`. Two operational prerequisites (one IAM grant + GitHub Variables) precede the workflow edit.

**Tech Stack:** GitHub Actions, Google Cloud (Cloud Run, Secret Manager, Artifact Registry, Workload Identity Federation), `gcloud` CLI, pnpm/Prisma.

Source spec: `docs/superpowers/specs/2026-06-17-prod-cloud-run-deploy-design.md`.

---

## Notes for the implementer

- This is a CI/infra change; there are no unit tests. Verification is: the command's own
  output (for the gcloud/gh tasks) and YAML validity + diff review (for the workflow task).
- `gcloud` is authenticated locally as `ckoranteng@csquared.com`; active project may be
  anything — always pass `--project=access-africa-01` explicitly.
- `gh` is authenticated (account `kkfergie22`, `repo` scope) against
  `CSq-Internal/change-management`.
- GCP is already provisioned (CI SA `github-ci`, runtime SA `cms-run-prod`, AR repo `cms`,
  WIF pool/provider, 8 empty `cms-prod-*` secrets). The 5 base GitHub Variables
  (`GCP_PROJECT_ID`, `AR_REGION`, `AR_REPO`, `GCP_SA_EMAIL`, `GCP_WIF_PROVIDER`) are set.
- Do NOT add `Co-Authored-By` trailers. Stage only the named files with explicit `git add`.

---

## Task 1: Grant the deploy SA read access to the prod DB-URL secret

The in-pipeline migrate step runs as the deploy identity `github-ci`, which currently has no
Secret Manager access. Grant it `secretAccessor` on **only** `cms-prod-database-url`
(least privilege — it must not read the other 7 secrets, which only the runtime SA needs).

**Files:** none (one-time `gcloud` IAM mutation).

- [ ] **Step 1: Grant the binding**

Run:
```bash
gcloud secrets add-iam-policy-binding cms-prod-database-url \
  --project=access-africa-01 \
  --member="serviceAccount:github-ci@access-africa-01.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```
Expected: prints `Updated IAM policy for secret [cms-prod-database-url].` followed by the
policy YAML including the new binding.

- [ ] **Step 2: Verify the binding exists and is scoped to this one secret**

Run:
```bash
gcloud secrets get-iam-policy cms-prod-database-url --project=access-africa-01 \
  --format="table(bindings.role, bindings.members)"
```
Expected: a row with `roles/secretmanager.secretAccessor` and member
`serviceAccount:github-ci@access-africa-01.iam.gserviceaccount.com`.

Then confirm the grant did NOT leak to another secret (spot-check one):
```bash
gcloud secrets get-iam-policy cms-prod-cron-secret --project=access-africa-01 \
  --format="value(bindings.members)" | grep github-ci || echo "OK: github-ci has no access to cron-secret"
```
Expected: prints `OK: github-ci has no access to cron-secret`.

(No commit — this is cloud state, not a repo change.)

---

## Task 2: Set the prod config GitHub Actions Variables

The deploy job sources non-sensitive config from `PROD_*` repo Variables (nothing hardcoded).
Set the five with known fixed values now. The three integration values
(`PROD_SMTP_USER`, `PROD_GDRIVE_SHARED_DRIVE_ID`, `PROD_GDRIVE_ROOT_FOLDER_ID`) are owned by
the user and may be unknown at implementation time; create them empty so the workflow
reference resolves cleanly, and the user fills real values later.

**Files:** none (GitHub repo Variables via `gh`).

- [ ] **Step 1: Set the five fixed-value variables**

Run:
```bash
R=CSq-Internal/change-management
gh variable set PROD_NEXTAUTH_URL          -R "$R" --body "https://cms.csquarednet.com"
gh variable set PROD_KEYCLOAK_ISSUER       -R "$R" --body "https://id.csquarednet.com/realms/csquared"
gh variable set PROD_KEYCLOAK_CLIENT_ID    -R "$R" --body "csquared-cms"
gh variable set PROD_KEYCLOAK_ADMIN_CLIENT_ID -R "$R" --body "csquared-cms-admin"
gh variable set PROD_EMAIL_FROM            -R "$R" --body "CSquared CMS <noreply@csquarednet.com>"
```
Expected: each prints `✓ Set variable PROD_… for CSq-Internal/change-management`.

- [ ] **Step 2: Create the three integration variables (empty placeholders)**

Run:
```bash
R=CSq-Internal/change-management
gh variable set PROD_SMTP_USER             -R "$R" --body ""
gh variable set PROD_GDRIVE_SHARED_DRIVE_ID -R "$R" --body ""
gh variable set PROD_GDRIVE_ROOT_FOLDER_ID  -R "$R" --body ""
```
Expected: each prints `✓ Set variable …`. (Empty is intentional; `SMTP_USER` only matters if
the Gmail SMTP fallback is used, and the GDrive ids are user-supplied later.)

- [ ] **Step 3: Verify all eight PROD_ variables are present**

Run:
```bash
gh variable list -R CSq-Internal/change-management | grep PROD_
```
Expected: 8 rows — `PROD_NEXTAUTH_URL`, `PROD_KEYCLOAK_ISSUER`, `PROD_KEYCLOAK_CLIENT_ID`,
`PROD_KEYCLOAK_ADMIN_CLIENT_ID`, `PROD_EMAIL_FROM`, `PROD_SMTP_USER`,
`PROD_GDRIVE_SHARED_DRIVE_ID`, `PROD_GDRIVE_ROOT_FOLDER_ID`.

(No commit — these are GitHub repo settings, not repo files.)

---

## Task 3: Add the `deploy` job to the workflow

**Files:**
- Modify: `.github/workflows/ci-cd.yml` (append a new `deploy` job after the `image` job; the
  file currently ends at line 214 with the image-push step).

- [ ] **Step 1: Append the `deploy` job**

Append the following to the END of `.github/workflows/ci-cd.yml` (after the `image` job's
final `docker push` step). Keep 2-space indentation so `deploy:` sits at the same level as
`image:` (i.e. nested under `jobs:`).

```yaml

  deploy:
    name: Deploy to Cloud Run (prod)
    runs-on: ubuntu-latest
    # Prod only: build/scan/push happens for dev too, but only prod deploys.
    if: github.event_name == 'push' && github.ref_name == 'prod'
    needs: [image]
    permissions:
      contents: read
      id-token: write # mint the OIDC token for Workload Identity Federation
    env:
      IMAGE: ${{ vars.AR_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ vars.AR_REPO }}/csquared-cms
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Authenticate to Google Cloud (Workload Identity Federation)
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_SA_EMAIL }}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v3

      - name: Apply database migrations (prod)
        # DB URL is fetched at runtime from Secret Manager and kept in-process — never
        # written to a file or logged. A failed migration fails the job before any deploy.
        run: |
          DATABASE_URL="$(gcloud secrets versions access latest \
            --secret=cms-prod-database-url --project=${{ vars.GCP_PROJECT_ID }})"
          export DATABASE_URL
          pnpm prisma migrate deploy

      - name: Deploy to Cloud Run
        id: deploy
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: cms-prod
          project_id: ${{ vars.GCP_PROJECT_ID }}
          region: ${{ vars.AR_REGION }}
          image: ${{ env.IMAGE }}:${{ github.sha }}
          service_account: cms-run-prod@${{ vars.GCP_PROJECT_ID }}.iam.gserviceaccount.com
          env_vars_update_strategy: overwrite
          secrets: |
            DATABASE_URL=cms-prod-database-url:latest
            NEXTAUTH_SECRET=cms-prod-nextauth-secret:latest
            KEYCLOAK_CLIENT_SECRET=cms-prod-keycloak-client-secret:latest
            KEYCLOAK_ADMIN_CLIENT_SECRET=cms-prod-keycloak-admin-client-secret:latest
            RESEND_API_KEY=cms-prod-resend-api-key:latest
            APP_PASSWORD=cms-prod-app-password:latest
            GOOGLE_SERVICE_ACCOUNT_KEY=cms-prod-google-service-account-key:latest
            CRON_SECRET=cms-prod-cron-secret:latest
          env_vars: |
            NEXTAUTH_URL=${{ vars.PROD_NEXTAUTH_URL }}
            KEYCLOAK_ISSUER=${{ vars.PROD_KEYCLOAK_ISSUER }}
            KEYCLOAK_CLIENT_ID=${{ vars.PROD_KEYCLOAK_CLIENT_ID }}
            KEYCLOAK_ADMIN_CLIENT_ID=${{ vars.PROD_KEYCLOAK_ADMIN_CLIENT_ID }}
            EMAIL_FROM=${{ vars.PROD_EMAIL_FROM }}
            SMTP_USER=${{ vars.PROD_SMTP_USER }}
            GDRIVE_SHARED_DRIVE_ID=${{ vars.PROD_GDRIVE_SHARED_DRIVE_ID }}
            GDRIVE_ROOT_FOLDER_ID=${{ vars.PROD_GDRIVE_ROOT_FOLDER_ID }}
          flags: '--allow-unauthenticated'

      - name: Show deployed URL
        run: echo "Deployed cms-prod -> ${{ steps.deploy.outputs.url }}"
```

- [ ] **Step 2: Validate the workflow YAML parses and the job is well-formed**

Prefer `actionlint` if available; otherwise fall back to a Python YAML parse.

Run:
```bash
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/ci-cd.yml
else
  python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci-cd.yml')); \
    j=d['jobs']; assert 'deploy' in j, 'deploy job missing'; \
    dep=j['deploy']; assert dep['needs']==['image']; \
    assert dep['if'].strip()==\"github.event_name == 'push' && github.ref_name == 'prod'\"; \
    steps=[s.get('uses') or s.get('name') for s in dep['steps']]; \
    assert 'google-github-actions/deploy-cloudrun@v2' in steps, steps; \
    print('OK: deploy job parses; steps =', steps)"
fi
```
Expected: `actionlint` exits 0 with no findings, OR the Python check prints
`OK: deploy job parses; steps = [...]` listing the steps (ending with the deploy action and
the URL echo).

- [ ] **Step 3: Review the diff**

Run: `git diff .github/workflows/ci-cd.yml`
Expected: only an addition — the new `deploy:` job appended after the `image` job; no other
job changed; indentation matches `image:` (job key at 2 spaces).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: add prod-only Cloud Run deploy job (migrate + deploy-cloudrun)"
```

---

## Final verification

- [ ] **Confirm the workflow still defines all five jobs and nothing else regressed**

Run:
```bash
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci-cd.yml')); \
  print('jobs:', list(d['jobs'].keys()))"
```
Expected: `jobs: ['quality', 'test', 'dependency-audit', 'image', 'deploy']`.

The deploy path is not exercised until a push to `prod` occurs with the manual prerequisites
satisfied (below). That first prod push is the live acceptance test.

---

## Manual prerequisites (user-owned; NOT code tasks — do before the first prod deploy)

These are tracked in the spec and gate the first *successful* prod deploy. They are not part
of the implementation tasks above:

1. Populate the 8 `cms-prod-*` secret values, e.g.
   `printf '%s' "$VALUE" | gcloud secrets versions add cms-prod-database-url --data-file=- --project=access-africa-01`
   (includes rotating the exposed Neon password and storing the new URL).
2. Fill real values for `PROD_SMTP_USER` / `PROD_GDRIVE_*` Variables if those integrations are
   used in prod.
3. After the first deploy creates the `cms-prod` service:
   `gcloud run domain-mappings create --service cms-prod --domain cms.csquarednet.com --region europe-west1 --project access-africa-01`
   and add the returned DNS record.
4. Add `https://cms.csquarednet.com/api/auth/callback/keycloak` to the `csquared-cms` Keycloak
   client's valid redirect URIs.
5. Merge `dev → prod` so the prod branch actually contains the app before pushing to prod.

---

## Self-review notes (author)

- **Spec coverage:** trigger/gating → Task 3 (`if`, `needs`); WIF auth → Task 3 (auth step);
  in-pipeline migrations + DB-URL fetch → Task 3 (migrate step) enabled by Task 1 (IAM grant);
  deploy via `deploy-cloudrun@v2` with secrets/env/service_account/flags → Task 3; config via
  `PROD_*` Variables (nothing hardcoded) → Task 2; verification (YAML/actionlint) → Task 3
  Step 2 + Final; manual prerequisites → dedicated section. All spec sections mapped.
- **Placeholder scan:** the empty `PROD_SMTP_USER`/`PROD_GDRIVE_*` Variables are intentional
  user-owned config (documented), not plan placeholders; every code/command step has concrete
  content.
- **Consistency:** secret names (`cms-prod-*`), SAs (`github-ci` deploy identity vs
  `cms-run-prod` runtime), region (`vars.AR_REGION`), and image ref
  (`${IMAGE}:${{ github.sha }}`) match the spec and the existing `image` job exactly.
