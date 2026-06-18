#!/usr/bin/env bash
#
# Provision the Google Cloud resources the CI/CD `image` job needs:
#   - Required APIs (Artifact Registry, IAM, STS, IAM Credentials)
#   - An Artifact Registry Docker repository
#   - A deploy service account with repo-scoped push permission
#   - A Workload Identity pool + GitHub OIDC provider (keyless auth)
#   - The IAM binding letting THIS GitHub repo impersonate the service account
#
# It is idempotent: existing resources are detected and skipped, IAM bindings
# are additive no-ops. Safe to re-run.
#
# Usage:
#   PROJECT_ID=my-gcp-project ./scripts/provision-gcp-cicd.sh
#
# Optional overrides (shown with defaults):
#   REGION=us-central1            Artifact Registry location
#   AR_REPO=cms                   Artifact Registry repository name
#   GH_REPO=CSq-Internal/change-management   owner/repo allowed to authenticate
#   SA_NAME=github-ci             service account id
#   POOL_ID=github                workload identity pool id
#   PROVIDER_ID=github-oidc       workload identity provider id
#
# Pass --set-gh-vars to also write the five GitHub Actions repo Variables via the
# `gh` CLI (requires gh installed + authenticated). Without it, the commands are
# printed for you to run.

set -euo pipefail

# ---- config (env-overridable) ----
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
AR_REPO="${AR_REPO:-cms}"
GH_REPO="${GH_REPO:-CSq-Internal/change-management}"
SA_NAME="${SA_NAME:-github-ci}"
POOL_ID="${POOL_ID:-github}"
PROVIDER_ID="${PROVIDER_ID:-github-oidc}"
SET_GH_VARS=false
[[ "${1:-}" == "--set-gh-vars" ]] && SET_GH_VARS=true

# ---- preflight ----
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID is required, e.g. PROJECT_ID=my-project $0" >&2
  exit 1
fi
command -v gcloud >/dev/null || { echo "ERROR: gcloud CLI not found on PATH." >&2; exit 1; }
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || { echo "ERROR: no active gcloud login. Run 'gcloud auth login'." >&2; exit 1; }

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GH_OWNER="${GH_REPO%%/*}"

echo "==> Project:        $PROJECT_ID"
echo "==> Region:         $REGION"
echo "==> AR repository:  $AR_REPO"
echo "==> GitHub repo:    $GH_REPO"
echo "==> Service account:$SA_EMAIL"
echo

# ---- 1. enable APIs (idempotent) ----
echo "==> Enabling required APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ---- 2. Artifact Registry repository ----
if gcloud artifacts repositories describe "$AR_REPO" \
     --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Artifact Registry repo '$AR_REPO' already exists — skipping."
else
  echo "==> Creating Artifact Registry repo '$AR_REPO'..."
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker --location="$REGION" --project="$PROJECT_ID" \
    --description="CSquared CMS container images"
fi

# ---- 3. service account ----
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Service account '$SA_EMAIL' already exists — skipping."
else
  echo "==> Creating service account '$SA_NAME'..."
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT_ID" --display-name="GitHub Actions CI/CD"
fi

# ---- 4. repo-scoped push permission (least privilege; additive no-op) ----
echo "==> Granting roles/artifactregistry.writer on the repo to the service account..."
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --location="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" >/dev/null

# ---- 5. Workload Identity pool ----
if gcloud iam workload-identity-pools describe "$POOL_ID" \
     --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Workload Identity pool '$POOL_ID' already exists — skipping."
else
  echo "==> Creating Workload Identity pool '$POOL_ID'..."
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global --project="$PROJECT_ID" --display-name="GitHub Actions"
fi

# ---- 6. GitHub OIDC provider (scoped to this repo) ----
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
     --location=global --workload-identity-pool="$POOL_ID" \
     --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> OIDC provider '$PROVIDER_ID' already exists — skipping."
else
  echo "==> Creating GitHub OIDC provider '$PROVIDER_ID'..."
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --location=global --project="$PROJECT_ID" \
    --workload-identity-pool="$POOL_ID" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${GH_REPO}'"
fi

# ---- 7. let this repo impersonate the service account (additive no-op) ----
echo "==> Binding ${GH_REPO} → ${SA_EMAIL} (roles/iam.workloadIdentityUser)..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GH_REPO}" >/dev/null

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo
echo "============================================================"
echo "Done. Set these as GitHub repository Variables"
echo "(Settings → Secrets and variables → Actions → Variables):"
echo "============================================================"
echo "  GCP_PROJECT_ID   = ${PROJECT_ID}"
echo "  AR_REGION        = ${REGION}"
echo "  AR_REPO          = ${AR_REPO}"
echo "  GCP_SA_EMAIL     = ${SA_EMAIL}"
echo "  GCP_WIF_PROVIDER = ${WIF_PROVIDER}"
echo

if $SET_GH_VARS; then
  command -v gh >/dev/null || { echo "ERROR: --set-gh-vars given but 'gh' CLI not found." >&2; exit 1; }
  echo "==> Setting GitHub repo Variables via gh..."
  gh variable set GCP_PROJECT_ID   --repo "$GH_REPO" --body "$PROJECT_ID"
  gh variable set AR_REGION        --repo "$GH_REPO" --body "$REGION"
  gh variable set AR_REPO          --repo "$GH_REPO" --body "$AR_REPO"
  gh variable set GCP_SA_EMAIL     --repo "$GH_REPO" --body "$SA_EMAIL"
  gh variable set GCP_WIF_PROVIDER --repo "$GH_REPO" --body "$WIF_PROVIDER"
  echo "==> GitHub Variables set."
else
  echo "Or set them with the gh CLI:"
  echo "  gh variable set GCP_PROJECT_ID   --repo ${GH_REPO} --body '${PROJECT_ID}'"
  echo "  gh variable set AR_REGION        --repo ${GH_REPO} --body '${REGION}'"
  echo "  gh variable set AR_REPO          --repo ${GH_REPO} --body '${AR_REPO}'"
  echo "  gh variable set GCP_SA_EMAIL     --repo ${GH_REPO} --body '${SA_EMAIL}'"
  echo "  gh variable set GCP_WIF_PROVIDER --repo ${GH_REPO} --body '${WIF_PROVIDER}'"
  echo
  echo "(Re-run with --set-gh-vars to apply them automatically.)"
fi
