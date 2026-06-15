# CI/CD → Google Cloud setup

The `image` job in `.github/workflows/ci-cd.yml` builds the container, scans it with
Trivy (fails on CRITICAL), generates a CycloneDX SBOM, and pushes to Artifact Registry.
It authenticates with **Workload Identity Federation** (keyless — no service-account key
stored in GitHub).

## Required GitHub repository **Variables**
Settings → Secrets and variables → Actions → **Variables**:

| Variable | Example | Meaning |
|----------|---------|---------|
| `GCP_PROJECT_ID` | `csquared-cms` | GCP project id |
| `AR_REGION` | `us-central1` | Artifact Registry region |
| `AR_REPO` | `cms` | Artifact Registry repository name |
| `GCP_SA_EMAIL` | `github-ci@csquared-cms.iam.gserviceaccount.com` | Deploy service account |
| `GCP_WIF_PROVIDER` | `projects/123456789/locations/global/workloadIdentityPools/github/providers/github-oidc` | WIF provider resource name |

No secrets are required for this job (WIF is keyless).

## One-time GCP setup (gcloud)

**Automated:** run `PROJECT_ID=<your-project> ./scripts/provision-gcp-cicd.sh` — idempotent;
it provisions everything below and prints the five Variables to set (add `--set-gh-vars`
to write them via the `gh` CLI). The manual commands follow for reference.

Replace `PROJECT`, `PROJECT_NUMBER`, `REGION`, `REPO` accordingly. Repo is `CSq-Internal/change-management`.

```bash
# 1. Artifact Registry (Docker) repository
gcloud artifacts repositories create REPO \
  --repository-format=docker --location=REGION --project=PROJECT

# 2. Deploy service account
gcloud iam service-accounts create github-ci \
  --project=PROJECT --display-name="GitHub CI"

# 3. Allow it to push images
gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:github-ci@PROJECT.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# 4. Workload Identity pool + GitHub OIDC provider
gcloud iam workload-identity-pools create github \
  --location=global --project=PROJECT --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --location=global --project=PROJECT --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='CSq-Internal/change-management'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 5. Let this repo impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  github-ci@PROJECT.iam.gserviceaccount.com --project=PROJECT \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/CSq-Internal/change-management"
```

The value for `GCP_WIF_PROVIDER` is:
`projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-oidc`

## Phase 2 (not yet wired)
Migrations (`prisma migrate deploy` via the Dockerfile `migrate` target), Cloud Run deploy
(`dev`→staging, `prod`→production behind a manual-approval Environment), and a post-deploy
smoke check. These need the Cloud Run service(s) + Secret Manager wiring to exist first.
