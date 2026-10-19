#!/usr/bin/env bash
#
# Provision Cloud Monitoring alerts for the Cloud Run service, emailed to ALERT_EMAIL:
#   - "server errors": any log entry at ERROR severity — 5xx responses (incl. failed
#     server actions) and Auth.js sign-in failures, which the app logs as structured
#     ERROR lines. Plain stderr text is DEFAULT severity in Cloud Run and does not match.
#   - "site down": uptime checks on the app's /login page and the Keycloak issuer's
#     discovery document, so an outage that logs nothing (service or IdP down) alerts too.
# The app has no error tracker, so without this a prod failure is only seen if someone
# happens to read the logs.
#
# Log-match alerts fire per matching entry, so notifications are rate-limited to one
# per 30 minutes; incidents auto-close after 30 quiet minutes. Uptime check targets are
# read from the deployed service's NEXTAUTH_URL and KEYCLOAK_ISSUER. Idempotent: finds
# the channel, checks and policies by display name, reusing or updating them in place.
#
# Usage:
#   PROJECT_ID=my-gcp-project REGION=europe-west1 ALERT_EMAIL=ops@example.com \
#     ./scripts/provision-gcp-alerting.sh <staging|prod>
#
# Optional overrides (defaults shown):
#   SERVICE_NAME=cms-<env>   Cloud Run service

set -euo pipefail

# ---- args / config ----
ENV_NAME="${1:-}"
PROJECT_ID="${PROJECT_ID:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
REGION="${REGION:?REGION is required (prod is europe-west1)}"

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
  echo "ERROR: first argument must be 'staging' or 'prod'. e.g. PROJECT_ID=p ALERT_EMAIL=e $0 prod" >&2
  exit 1
fi
if [[ -z "$PROJECT_ID" || -z "$ALERT_EMAIL" ]]; then
  echo "ERROR: PROJECT_ID and ALERT_EMAIL are required." >&2
  exit 1
fi
command -v gcloud >/dev/null || { echo "ERROR: gcloud CLI not found on PATH." >&2; exit 1; }
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || { echo "ERROR: no active gcloud login. Run 'gcloud auth login'." >&2; exit 1; }

SERVICE_NAME="${SERVICE_NAME:-cms-${ENV_NAME}}"
CHANNEL_NAME="CMS ${ENV_NAME} - ${ALERT_EMAIL}"
ERRORS_POLICY_NAME="CMS ${ENV_NAME} - server errors"
UPTIME_POLICY_NAME="CMS ${ENV_NAME} - site down"
APP_CHECK_NAME="CMS ${ENV_NAME} - login page"
IDP_CHECK_NAME="CMS ${ENV_NAME} - Keycloak issuer"

service_env() {            # value of a plain env var on the deployed service
  gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" \
    --format="value(spec.template.spec.containers[0].env.filter(name='$1').extract(value).flatten())"
}
APP_URL="$(service_env NEXTAUTH_URL)"
KEYCLOAK_ISSUER="$(service_env KEYCLOAK_ISSUER)"
if [[ -z "$APP_URL" || -z "$KEYCLOAK_ISSUER" ]]; then
  echo "ERROR: could not read NEXTAUTH_URL / KEYCLOAK_ISSUER from '$SERVICE_NAME' in $REGION." >&2
  exit 1
fi

echo "==> Project:  $PROJECT_ID"
echo "==> Service:  $SERVICE_NAME"
echo "==> App:      $APP_URL"
echo "==> Issuer:   $KEYCLOAK_ISSUER"
echo "==> Notify:   $ALERT_EMAIL"
echo

gcloud services enable monitoring.googleapis.com --project="$PROJECT_ID"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

upsert_policy() {          # upsert_policy <display name> <policy json file>
  local existing
  existing="$(gcloud monitoring policies list --project="$PROJECT_ID" \
    --filter="displayName=\"$1\"" --format='value(name)' | head -n1)"
  if [[ -n "$existing" ]]; then
    echo "==> Updating policy '$1'..."
    gcloud monitoring policies update "$existing" --project="$PROJECT_ID" \
      --policy-from-file="$2" >/dev/null
  else
    echo "==> Creating policy '$1'..."
    gcloud monitoring policies create --project="$PROJECT_ID" --policy-from-file="$2" >/dev/null
  fi
}

upsert_uptime_check() {    # upsert_uptime_check <display name> <https url>; prints the check id
  local rest host path existing
  rest="${2#https://}"; host="${rest%%/*}"; path="/${rest#*/}"
  [[ "$rest" == */* ]] || path="/"
  existing="$(gcloud monitoring uptime list-configs --project="$PROJECT_ID" \
    --filter="displayName=\"$1\"" --format='value(name)' | head -n1)"
  if [[ -n "$existing" ]]; then
    echo "==> Uptime check '$1' exists — reusing." >&2
  else
    echo "==> Creating uptime check '$1' (https://${host}${path})..." >&2
    existing="$(gcloud monitoring uptime create "$1" --project="$PROJECT_ID" \
      --resource-type=uptime-url --resource-labels="host=${host},project_id=${PROJECT_ID}" \
      --protocol=https --path="$path" --period=5 --timeout=10 --format='value(name)')"
  fi
  printf '%s' "${existing##*/}"
}

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

# ---- 2. log-match alert policy: server errors ----
cat >"$TMP_DIR/errors.json" <<JSON
{
  "displayName": "${ERRORS_POLICY_NAME}",
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
upsert_policy "$ERRORS_POLICY_NAME" "$TMP_DIR/errors.json"

# ---- 3. uptime checks: app login page + Keycloak issuer ----
APP_CHECK_ID="$(upsert_uptime_check "$APP_CHECK_NAME" "${APP_URL%/}/login")"
IDP_CHECK_ID="$(upsert_uptime_check "$IDP_CHECK_NAME" "${KEYCLOAK_ISSUER%/}/.well-known/openid-configuration")"

# ---- 4. uptime alert policy: site down ----
# Fires when two or more checker regions fail the same check — one flaky region alone
# does not page anyone.
uptime_condition() {       # uptime_condition <display name> <check id>
  cat <<JSON
    {
      "displayName": "$1 failing",
      "conditionThreshold": {
        "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"$2\"",
        "aggregations": [{
          "alignmentPeriod": "300s",
          "perSeriesAligner": "ALIGN_NEXT_OLDER",
          "crossSeriesReducer": "REDUCE_COUNT_FALSE",
          "groupByFields": ["resource.label.host"]
        }],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 1,
        "duration": "0s",
        "trigger": { "count": 1 }
      }
    }
JSON
}
cat >"$TMP_DIR/uptime.json" <<JSON
{
  "displayName": "${UPTIME_POLICY_NAME}",
  "combiner": "OR",
  "conditions": [
$(uptime_condition "$APP_CHECK_NAME" "$APP_CHECK_ID"),
$(uptime_condition "$IDP_CHECK_NAME" "$IDP_CHECK_ID")
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "notificationChannels": ["${CHANNEL}"],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "Users cannot reach the CMS sign-in (${APP_URL}/login) or Keycloak (${KEYCLOAK_ISSUER}). Severity 1 under the rollout plan: fall back to paper or phone approvals and tell the OpCo champions."
  }
}
JSON
upsert_policy "$UPTIME_POLICY_NAME" "$TMP_DIR/uptime.json"

echo
echo "Done. ${SERVICE_NAME} errors and outages alert ${ALERT_EMAIL} (errors at most one per 30 minutes)."
