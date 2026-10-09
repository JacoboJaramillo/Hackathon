#!/usr/bin/env bash
# Reproducible setup and deploy of the agente-vocal service on Cloud Run.
# Idempotent: safe to run again; it only creates what is missing and then
# deploys a new revision from web/.
#
# Prerequisites (one time, not automated because the values are secret):
#   printf '%s' "<value>" | gcloud secrets create <name> --replication-policy=user-managed \
#     --locations=us-east1 --data-file=- --project agente-vocal-hackaton
#   for each of: deepseek-api-key, deepgram-api-key, datosgov-app-token
#
# Usage, from the repository root: bash infra/deploy.sh
set -euo pipefail

PROJECT=agente-vocal-hackaton
REGION=us-east1
SERVICE=agente-vocal
RUNTIME_SA="agente-vocal-run@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA="agente-vocal-build@${PROJECT}.iam.gserviceaccount.com"
SECRETS=(deepseek-api-key deepgram-api-key datosgov-app-token)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
# Every command names the project explicitly; the local gcloud default may
# point to an unrelated project.
G="--project=$PROJECT --quiet"

echo "1. APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com $G

echo "2. Service accounts"
for sa in agente-vocal-run agente-vocal-build; do
  gcloud iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" $G >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$sa" --display-name="$sa" $G
done

echo "3. Runtime account: read access to its three secrets only"
for s in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/secretmanager.secretAccessor $G >/dev/null
done

echo "4. Build account: write logs, read uploaded sources, push the image"
for role in roles/logging.logWriter roles/storage.objectViewer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" \
    --role="$role" --condition=None $G >/dev/null
done

echo "5. Default compute account loses Editor (nothing runs as it anymore)"
gcloud projects remove-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/editor $G >/dev/null 2>&1 || echo "   already removed"

echo "6. Pin each secret to its current version so a revision is reproducible"
pin() { gcloud secrets versions list "$1" --filter=state=enabled --sort-by=~createTime --limit=1 --format='value(name)' $G; }
SECRET_FLAGS="DEEPGRAM_API_KEY=deepgram-api-key:$(pin deepgram-api-key)"
SECRET_FLAGS+=",DEEPSEEK_API_KEY=deepseek-api-key:$(pin deepseek-api-key)"
SECRET_FLAGS+=",DATOSGOV_APP_TOKEN=datosgov-app-token:$(pin datosgov-app-token)"

echo "7. Build and deploy"
gcloud run deploy "$SERVICE" --source web --region "$REGION" $G \
  --build-service-account="projects/${PROJECT}/serviceAccounts/${BUILD_SA}" \
  --service-account="$RUNTIME_SA" \
  --set-secrets="$SECRET_FLAGS" \
  --set-env-vars="ALLOWED_ORIGINS=${URL}" \
  --allow-unauthenticated \
  --session-affinity --timeout=3600 \
  --min-instances="${MIN_INSTANCES:-0}" --max-instances=2 \
  --cpu=1 --memory=1Gi --concurrency=40 \
  --startup-probe="httpGet.path=/api/health,httpGet.port=8080,periodSeconds=2,failureThreshold=15,timeoutSeconds=2" \
  --liveness-probe="httpGet.path=/api/health,httpGet.port=8080,periodSeconds=30,failureThreshold=3,timeoutSeconds=3"

echo "8. Smoke check"
curl -fsS "${URL}/api/health" && echo
echo "Deployed: ${URL}"
