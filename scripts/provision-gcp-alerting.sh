#!/usr/bin/env bash
#
# Provision a Cloud Monitoring alert that emails on any ERROR log from the Cloud Run
# service — failed sign-ins, 5xx responses, unhandled server-action errors. The app
# has no error tracker, so without this a prod failure is only seen if someone
# happens to read the logs.
#
# Log-match alerts fire per matching entry, so notifications are rate-limited to one
# per 30 minutes; the incident auto-closes after 30 quiet minutes. Idempotent: finds
# the channel and policy by display name and updates them in place.
#
# Usage:
#   PROJECT_ID=my-gcp-project ALERT_EMAIL=ops@example.com \
#     ./scripts/provision-gcp-alerting.sh <staging|prod>
#
# Optional overrides (defaults shown):
#   SERVICE_NAME=cms-<env>   Cloud Run service

set -euo pipefail

# ---- args / config ----
ENV_NAME="${1:-}"
PROJECT_ID="${PROJECT_ID:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
  echo "ERROR: first argument must be 'staging' or 'prod'. e.g. PROJECT_ID=p ALERT_EMAIL=e $0 prod" >&2
  exit 1
fi
if [[ -z "$PROJECT_ID" || -z "$ALERT_EMAIL" ]]; then
  echo "ERROR: PROJECT_ID and ALERT_EMAIL are required." >&2
  exit 1
fi
command -v gcloud >/dev/null || { echo "ERROR: gcloud CLI not found on PATH." >&2; exit 1; }

SERVICE_NAME="${SERVICE_NAME:-cms-${ENV_NAME}}"
CHANNEL_NAME="CMS ${ENV_NAME} - ${ALERT_EMAIL}"
POLICY_NAME="CMS ${ENV_NAME} - server errors"

echo "==> Project:  $PROJECT_ID"
echo "==> Service:  $SERVICE_NAME"
echo "==> Notify:   $ALERT_EMAIL"
echo

gcloud services enable monitoring.googleapis.com --project="$PROJECT_ID"

# ---- 1. email notification channel ----
CHANNEL="$(gcloud beta monitoring channels list --project="$PROJECT_ID" \
  --filter="displayName=\"${CHANNEL_NAME}\"" --format='value(name)' | head -n1)"
if [[ -n "$CHANNEL" ]]; then
  echo "==> Channel '$CHANNEL_NAME' exists — reusing."
else
  echo "==> Creating email channel '$CHANNEL_NAME'..."
  CHANNEL="$(gcloud beta monitoring channels create --project="$PROJECT_ID" \
    --display-name="$CHANNEL_NAME" --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}" --format='value(name)')"
fi

# ---- 2. log-match alert policy ----
POLICY_FILE="$(mktemp)"
trap 'rm -f "$POLICY_FILE"' EXIT
cat >"$POLICY_FILE" <<JSON
{
  "displayName": "${POLICY_NAME}",
  "combiner": "OR",
  "conditions": [{
    "displayName": "ERROR log on ${SERVICE_NAME}",
    "conditionMatchedLog": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND severity>=ERROR"
    }
  }],
  "alertStrategy": {
    "notificationRateLimit": { "period": "1800s" },
    "autoClose": "1800s"
  },
  "notificationChannels": ["${CHANNEL}"],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "The CMS (${SERVICE_NAME}) logged an error. Read the entries around the incident time:\n\n\`gcloud logging read 'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND severity>=ERROR' --project=${PROJECT_ID} --freshness=1h --limit=20\`"
  }
}
JSON

POLICY="$(gcloud monitoring policies list --project="$PROJECT_ID" \
  --filter="displayName=\"${POLICY_NAME}\"" --format='value(name)' | head -n1)"
if [[ -n "$POLICY" ]]; then
  echo "==> Updating policy '$POLICY_NAME'..."
  gcloud monitoring policies update "$POLICY" --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE" >/dev/null
else
  echo "==> Creating policy '$POLICY_NAME'..."
  gcloud monitoring policies create --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE" >/dev/null
fi

echo
echo "Done. Alerts for ${SERVICE_NAME} errors go to ${ALERT_EMAIL} (at most one per 30 minutes)."
