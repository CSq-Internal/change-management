#!/bin/bash
set -euo pipefail

# Create this app's secrets in Google Secret Manager (namespaced with a prefix to
# avoid colliding with other services in a shared project) and grant the Cloud Run
# runtime service account read access. Drive + email are deferred (add later).
#
# Secret Manager is a FLAT, project-global namespace — there is no per-app scoping —
# so every secret here is prefixed. At deploy, map prefixed secret -> clean env var:
#   --set-secrets "DATABASE_URL=${PREFIX}database-url:latest,NEXTAUTH_SECRET=${PREFIX}nextauth-secret:latest,..."
#
# Set in your shell BEFORE running (don't hardcode secrets in this file):
#   From step 2 (Cloud SQL): DB_USER  DB_PASSWORD  DB_NAME  SQL_CONN
#   From 3a Credentials:     KEYCLOAK_CLIENT_SECRET
#   From 3b Credentials:     KEYCLOAK_ADMIN_CLIENT_SECRET
# And point gcloud at the right project (gcloud config set project ...).

PREFIX="csquared-cms-"

: "${DB_USER:?set DB_USER}" "${DB_PASSWORD:?set DB_PASSWORD}" "${DB_NAME:?set DB_NAME}" "${SQL_CONN:?set SQL_CONN}"
: "${KEYCLOAK_CLIENT_SECRET:?set KEYCLOAK_CLIENT_SECRET (from 3a)}"
: "${KEYCLOAK_ADMIN_CLIENT_SECRET:?set KEYCLOAK_ADMIN_CLIENT_SECRET (from 3b)}"

# URL-encode the DB password — base64/hex passwords can contain / + = which would
# otherwise break the postgresql:// connection string.
DB_PW_ENC="$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["DB_PASSWORD"], safe=""))')"
DATABASE_URL="postgresql://${DB_USER}:${DB_PW_ENC}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONN}"

# Provided secrets: create, or add a new version (safe to re-run with corrected values).
set_secret () {
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null && echo "created $1" \
    || { printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null && echo "updated $1"; }
}
# Generated secrets: create ONCE — re-running must NOT rotate them.
create_once () {
  if gcloud secrets describe "$1" >/dev/null 2>&1; then echo "$1 exists — keeping"; else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- && echo "created $1"; fi
}

set_secret  "${PREFIX}database-url"                 "$DATABASE_URL"
create_once "${PREFIX}nextauth-secret"              "$(openssl rand -base64 32)"
set_secret  "${PREFIX}keycloak-client-secret"       "$KEYCLOAK_CLIENT_SECRET"
set_secret  "${PREFIX}keycloak-admin-client-secret" "$KEYCLOAK_ADMIN_CLIENT_SECRET"
create_once "${PREFIX}cron-secret"                  "$(openssl rand -base64 24)"
# Deferred — uncomment when ready:
#   set_secret "${PREFIX}google-service-account-key" "$(cat /path/to/sa-key.json)"   # Drive (step 4)
#   set_secret "${PREFIX}resend-api-key"             "$RESEND_API_KEY"               # email (optional)

# Grant Cloud Run's runtime SA read access. NOTE: this needs secretmanager.secrets.setIamPolicy
# (roles/secretmanager.admin or Owner) — a plain Editor will get 403 here; hand this loop to
# a project Owner/admin if it fails for you.
RUN_SA="$(gcloud iam service-accounts list --filter='displayName:Compute Engine default' --format='value(email)' | head -1)"
echo "runtime SA: $RUN_SA"
for s in database-url nextauth-secret keycloak-client-secret keycloak-admin-client-secret cron-secret; do
  gcloud secrets add-iam-policy-binding "${PREFIX}${s}" \
    --member="serviceAccount:${RUN_SA}" --role="roles/secretmanager.secretAccessor" >/dev/null \
    && echo "granted accessor on ${PREFIX}${s}" || echo "WARN: could not bind ${PREFIX}${s} (needs IAM admin)"
done
echo "DONE — prefixed secrets created (Drive/email deferred). IAM binding may need an admin."
