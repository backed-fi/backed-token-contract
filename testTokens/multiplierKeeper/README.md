# Multiplier Keeper

Runs every 6 hours and increases the rebase multiplier of each test token
by a small random amount (up to 0.02 × 1e18).

## Local testing

```bash
# Install keeper-only deps first (once)
cd testTokens/multiplierKeeper && npm install && cd ../..

MULTIPLIER_UPDATER_PK=<private_key> \
SEPOLIA_RPC_URL=<rpc_url> \
npx ts-node --project testTokens/multiplierKeeper/tsconfig.json \
            testTokens/multiplierKeeper/index.ts
```

## Docker testing

```bash
docker build --platform linux/amd64 -f testTokens/multiplierKeeper/Dockerfile -t test-tokens-multiplier-keeper .
docker run --rm \
  -e MULTIPLIER_UPDATER_PK=<private_key> \
  -e SEPOLIA_RPC_URL=<rpc_url> \
  test-tokens-multiplier-keeper
```

## One-time GCP setup

Run these once per environment. Replace the `<...>` placeholders with your values.

All resources are named with the `test-tokens-` prefix and tagged with
`project=test-tokens` so they are easy to find and clean up after the event.

```bash
PROJECT_ID=backedfi-dev
REGION=europe-west6
REGISTRY=europe-west6-docker.pkg.dev/$PROJECT_ID/backend
SERVICE_ACCOUNT=backend-service-account@$PROJECT_ID.iam.gserviceaccount.com

# 1. Store secrets in Secret Manager (labeled for easy discovery)
echo -n "<private_key>" | gcloud secrets create test-tokens-multiplier-updater-pk \
  --data-file=- \
  --labels project=test-tokens \
  --project=$PROJECT_ID

echo -n "<rpc_url>" | gcloud secrets create test-tokens-sepolia-rpc-url \
  --data-file=- \
  --labels project=test-tokens \
  --project=$PROJECT_ID

# 2. Authenticate Docker with Artifact Registry (once per machine)
gcloud auth configure-docker europe-west6-docker.pkg.dev

# 3. Build & push the initial image (or trigger Cloud Build)
# --platform linux/amd64 is required when building on Apple Silicon (arm64)
docker build --platform linux/amd64 \
  -f testTokens/multiplierKeeper/Dockerfile \
  -t $REGISTRY/test-tokens-multiplier-keeper:latest .
docker push $REGISTRY/test-tokens-multiplier-keeper:latest

# 4. Create the Cloud Run Job (labeled for easy discovery)
gcloud run jobs create test-tokens-multiplier-keeper \
  --image $REGISTRY/test-tokens-multiplier-keeper:latest \
  --region $REGION \
  --set-secrets MULTIPLIER_UPDATER_PK=test-tokens-multiplier-updater-pk:latest \
  --set-secrets SEPOLIA_RPC_URL=test-tokens-sepolia-rpc-url:latest \
  --max-retries 2 \
  --labels hproject=test-tokens \
  --project $PROJECT_ID


## Triggering manually

```bash
gcloud run jobs execute test-tokens-multiplier-keeper \
  --region $REGION --project $PROJECT_ID
```

