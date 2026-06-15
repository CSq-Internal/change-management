#!/usr/bin/env bash
#
# Provision the per-environment runtime resources for a Cloud Run deployment:
#   - Secret Manager / Cloud Run APIs
#   - A per-env runtime service account  (cms-run-<env>)
#   - Namespaced, EMPTY Secret Manager secrets  (cms-<env>-<key>)
#   - secretAccessor for the runtime SA on ONLY this env's secrets (least privilege)
#   - run.admin (project) + serviceAccountUser (on the runtime SA) for the deploy SA
#
# It does NOT create the Cloud Run service and does NOT set secret values — the
# pipeline deploys the service, and you add secret versions yourself (values must
# never live in the repo). Idempotent; safe to re-run.
#
# Usage:
#   PROJECT_ID=my-gcp-project ./scripts/provision-gcp-runtime.sh <staging|prod>
#
# Optional overrides (defaults shown):
#   REGION=us-central1           Cloud Run region
#   DEPLOY_SA_NAME=github-ci      CI deploy service account (from provision-gcp-cicd.sh)
#   RUNTIME_SA_NAME=cms-run-<env> runtime service account id

set -euo pipefail

# ---- args / config ----
ENV_NAME="${1:-}"
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
DEPLOY_SA_NAME="${DEPLOY_SA_NAME:-github-ci}"

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
  echo "ERROR: first argument must be 'staging' or 'prod'. e.g. PROJECT_ID=p $0 prod" >&2
  exit 1
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID is required, e.g. PROJECT_ID=my-project $0 $ENV_NAME" >&2
  exit 1
fi
command -v gcloud >/dev/null || { echo "ERROR: gcloud CLI not found on PATH." >&2; exit 1; }
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || { echo "ERROR: no active gcloud login. Run 'gcloud auth login'." >&2; exit 1; }

RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-cms-run-${ENV_NAME}}"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Credentials kept in Secret Manager (non-sensitive config is set as plain Cloud Run
# env vars at deploy time, not provisioned here).
SECRET_KEYS=(
  DATABASE_URL
  NEXTAUTH_SECRET
  KEYCLOAK_CLIENT_SECRET
  KEYCLOAK_ADMIN_CLIENT_SECRET
  RESEND_API_KEY
  APP_PASSWORD
  GOOGLE_SERVICE_ACCOUNT_KEY
  CRON_SECRET
)

secret_name() {            # DATABASE_URL -> cms-<env>-database-url
  printf 'cms-%s-%s' "$ENV_NAME" "$(printf '%s' "$1" | tr 'A-Z_' 'a-z-')"
}

echo "==> Project:          $PROJECT_ID"
echo "==> Environment:      $ENV_NAME"
echo "==> Region:           $REGION"
echo "==> Runtime SA:       $RUNTIME_SA"
echo "==> Deploy SA:        $DEPLOY_SA"
echo

# ---- 1. APIs ----
echo "==> Enabling Secret Manager + Cloud Run APIs..."
gcloud services enable secretmanager.googleapis.com run.googleapis.com --project="$PROJECT_ID"

# ---- 2. runtime service account ----
if gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Runtime SA already exists — skipping."
else
  echo "==> Creating runtime service account '$RUNTIME_SA_NAME'..."
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
    --project="$PROJECT_ID" --display-name="CSquared CMS runtime (${ENV_NAME})"
fi

# ---- 3. namespaced, empty secrets + accessor binding ----
echo "==> Provisioning ${#SECRET_KEYS[@]} namespaced secrets..."
for key in "${SECRET_KEYS[@]}"; do
  name="$(secret_name "$key")"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    - $name exists"
  else
    echo "    - creating $name (empty)"
    gcloud secrets create "$name" --replication-policy=automatic \
      --project="$PROJECT_ID" --labels="app=cms,env=${ENV_NAME}"
  fi
  # Runtime SA may read this secret (resource-scoped; additive no-op).
  gcloud secrets add-iam-policy-binding "$name" --project="$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
done

# ---- 4. deploy SA permissions: deploy Cloud Run + act as the runtime SA ----
echo "==> Granting deploy SA run.admin (project) + serviceAccountUser (runtime SA)..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/run.admin" --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

# ---- summary ----
SET_SECRETS=""
for key in "${SECRET_KEYS[@]}"; do
  SET_SECRETS+="${key}=$(secret_name "$key"):latest,"
done
SET_SECRETS="${SET_SECRETS%,}"

echo
echo "============================================================"
echo "Done for env '${ENV_NAME}'."
echo "============================================================"
echo
echo "1) Add a value to each secret (values are NEVER stored in the repo), e.g.:"
echo "   printf '%s' \"\$DATABASE_URL\" | gcloud secrets versions add $(secret_name DATABASE_URL) --data-file=- --project=${PROJECT_ID}"
echo
echo "2) The Cloud Run deploy (pipeline phase 2) wires the secrets with:"
echo "   --service-account ${RUNTIME_SA} \\"
echo "   --set-secrets ${SET_SECRETS}"
echo
echo "3) Set non-sensitive config as plain env vars at deploy, e.g.:"
echo "   --set-env-vars NEXTAUTH_URL=...,KEYCLOAK_ISSUER=...,KEYCLOAK_CLIENT_ID=...,KEYCLOAK_ADMIN_CLIENT_ID=...,EMAIL_FROM=...,SMTP_USER=...,GDRIVE_SHARED_DRIVE_ID=...,GDRIVE_ROOT_FOLDER_ID=..."
