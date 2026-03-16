# Multiplier Keeper

Runs every 2 hours and increases the rebase multiplier of each hackathon token
by a small random amount (up to 0.02 × 1e18).

## GCP equivalent of AWS Lambda + CloudWatch cron

| AWS | GCP |
|-----|-----|
| Lambda function | Cloud Run Job |
| EventBridge / CloudWatch cron | Cloud Scheduler |
| Secrets Manager | Secret Manager |
| ECR | Artifact Registry |

## Local testing

```bash
# Install keeper-only deps first (once)
cd scripts/multiplierKeeper && npm install && cd ../..

MULTIPLIER_UPDATER_PK=<private_key> \
SEPOLIA_RPC_URL=<rpc_url> \
npx ts-node --project scripts/multiplierKeeper/tsconfig.json \
            scripts/multiplierKeeper/index.ts
```

## Docker testing

```bash
docker build --platform linux/amd64 -f scripts/multiplierKeeper/Dockerfile -t ethcc-hackathon-multiplier-keeper .
docker run --rm \
  -e MULTIPLIER_UPDATER_PK=<private_key> \
  -e SEPOLIA_RPC_URL=<rpc_url> \
  ethcc-hackathon-multiplier-keeper
```

## One-time GCP setup

Run these once per environment. Replace the `<...>` placeholders with your values.

All resources are named with the `ethcc-hackathon-` prefix and tagged with
`hackathon=ethcc` so they are easy to find and clean up after the event.

```bash
PROJECT_ID=backedfi-dev
REGION=europe-west6
REGISTRY=europe-west6-docker.pkg.dev/$PROJECT_ID/backend
SERVICE_ACCOUNT=backend-service-account@$PROJECT_ID.iam.gserviceaccount.com

# 1. Store secrets in Secret Manager (labeled for easy discovery)
echo -n "<private_key>" | gcloud secrets create ethcc-hackathon-multiplier-updater-pk \
  --data-file=- \
  --labels hackathon=ethcc \
  --project=$PROJECT_ID

echo -n "<rpc_url>" | gcloud secrets create ethcc-hackathon-sepolia-rpc-url \
  --data-file=- \
  --labels hackathon=ethcc \
  --project=$PROJECT_ID

# 2. Authenticate Docker with Artifact Registry (once per machine)
gcloud auth configure-docker europe-west6-docker.pkg.dev

# 3. Build & push the initial image (or trigger Cloud Build)
# --platform linux/amd64 is required when building on Apple Silicon (arm64)
docker build --platform linux/amd64 \
  -f scripts/multiplierKeeper/Dockerfile \
  -t $REGISTRY/ethcc-hackathon-multiplier-keeper:latest .
docker push $REGISTRY/ethcc-hackathon-multiplier-keeper:latest

# 4. Create the Cloud Run Job (labeled for easy discovery)
gcloud run jobs create ethcc-hackathon-multiplier-keeper \
  --image $REGISTRY/ethcc-hackathon-multiplier-keeper:latest \
  --region $REGION \
  --set-secrets MULTIPLIER_UPDATER_PK=ethcc-hackathon-multiplier-updater-pk:latest \
  --set-secrets SEPOLIA_RPC_URL=ethcc-hackathon-sepolia-rpc-url:latest \
  --max-retries 2 \
  --labels hackathon=ethcc \
  --project $PROJECT_ID

# 5. Grant the Cloud Scheduler service account permission to invoke the job
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/run.invoker" \
  --condition=None

# 6. Create the Cloud Scheduler job — every 2 hours (labeled for easy discovery)
gcloud scheduler jobs create http ethcc-hackathon-multiplier-keeper-schedule \
  --location $REGION \
  --schedule "0 */2 * * *" \
  --time-zone "UTC" \
  --uri "https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/ethcc-hackathon-multiplier-keeper:run" \
  --http-method POST \
  --oauth-service-account-email $SERVICE_ACCOUNT \
  --message-body '{}' \
  --project $PROJECT_ID
```

> **Note:** Cloud Scheduler jobs don't support `--labels` directly in the CLI but
> you can add them after creation:
> ```bash
> gcloud scheduler jobs update http ethcc-hackathon-multiplier-keeper-schedule \
>   --update-labels hackathon=ethcc --location $REGION --project $PROJECT_ID
> ```

## Deploying updates

After the one-time setup, new versions are deployed via Cloud Build:

```bash
gcloud builds submit \
  --config devops/cloudbuild-multiplier-keeper.yaml \
  --substitutions _REGION=europe-west6,_REGISTRY=$REGISTRY \
  --project $PROJECT_ID
```

Or set up a Cloud Build trigger on the repository to run automatically on push.

## Triggering manually

```bash
gcloud run jobs execute ethcc-hackathon-multiplier-keeper \
  --region $REGION --project $PROJECT_ID
```

## Cleaning up after the hackathon

```bash
gcloud run jobs delete ethcc-hackathon-multiplier-keeper --region $REGION --project $PROJECT_ID
gcloud scheduler jobs delete ethcc-hackathon-multiplier-keeper-schedule --location $REGION --project $PROJECT_ID
gcloud secrets delete ethcc-hackathon-multiplier-updater-pk --project $PROJECT_ID
gcloud secrets delete ethcc-hackathon-sepolia-rpc-url --project $PROJECT_ID
```
