#!/usr/bin/env bash
#
# Provision the Cloud Scheduler job that drives /api/cron/sla (SLA escalation +
# approver / retrospective reminders) for a deployed Cloud Run service.
#
# Runs AFTER the pipeline has created the service: the job targets the service's
# live URL. The cron secret is read from Secret Manager straight into the job's
# header and never printed (it is briefly visible in this machine's process list as a
# gcloud argument — gcloud has no file input for headers). Idempotent: creates the
# job, or updates it in place.
#
# The endpoint is safe to call often — escalations only advance a level when one
# is due, and reminders are de-duplicated by the NotificationDispatch ledger — so
# the schedule is tight enough for the 1-hour emergency SLA.
#
# Usage:
#   PROJECT_ID=my-gcp-project REGION=europe-west1 ./scripts/provision-gcp-scheduler.sh <staging|prod>
#
# Optional overrides (defaults shown):
#   SERVICE_NAME=cms-<env>          Cloud Run service
#   SCHEDULE='*/15 * * * *'         cron schedule (UTC)

set -euo pipefail

# ---- args / config ----
ENV_NAME="${1:-}"
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:?REGION is required (prod is europe-west1)}"
SCHEDULE="${SCHEDULE:-*/15 * * * *}"

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

SERVICE_NAME="${SERVICE_NAME:-cms-${ENV_NAME}}"
JOB_NAME="cms-${ENV_NAME}-sla"
SECRET_NAME="cms-${ENV_NAME}-cron-secret"

echo "==> Project:   $PROJECT_ID"
echo "==> Region:    $REGION"
echo "==> Service:   $SERVICE_NAME"
echo "==> Job:       $JOB_NAME ($SCHEDULE UTC)"
echo

# ---- 1. API ----
gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID"

# ---- 2. target URL + cron secret ----
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" \
  --region="$REGION" --format='value(status.url)')"
if [[ -z "$SERVICE_URL" ]]; then
  echo "ERROR: Cloud Run service '$SERVICE_NAME' not found in $REGION — deploy it first." >&2
  exit 1
fi

CRON_SECRET="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID")"
if [[ -z "$CRON_SECRET" ]]; then
  echo "ERROR: secret '$SECRET_NAME' has no value." >&2
  exit 1
fi

# ---- 3. scheduler job ----
if gcloud scheduler jobs describe "$JOB_NAME" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  echo "==> Updating existing job '$JOB_NAME'..."
  gcloud scheduler jobs update http "$JOB_NAME" --project="$PROJECT_ID" --location="$REGION" \
    --schedule="$SCHEDULE" --time-zone="Etc/UTC" \
    --uri="${SERVICE_URL}/api/cron/sla" --http-method=POST \
    --update-headers="x-cron-secret=${CRON_SECRET}" \
    --attempt-deadline=300s >/dev/null
else
  echo "==> Creating job '$JOB_NAME'..."
  gcloud scheduler jobs create http "$JOB_NAME" --project="$PROJECT_ID" --location="$REGION" \
    --schedule="$SCHEDULE" --time-zone="Etc/UTC" \
    --uri="${SERVICE_URL}/api/cron/sla" --http-method=POST \
    --headers="x-cron-secret=${CRON_SECRET}" \
    --attempt-deadline=300s \
    --description="CSquared CMS ${ENV_NAME} - SLA escalation and reminders" >/dev/null
fi

echo
echo "Done. Trigger one run now and check its result with:"
echo "   gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo "   gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID --format='value(status,lastAttemptTime)'"
