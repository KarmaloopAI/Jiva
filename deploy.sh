#!/bin/bash
# Deploy Jiva to Cloud Run
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

set -e

PROJECT_ID="${1:-your-project-id}"
REGION="${2:-us-central1}"
SERVICE_NAME="jiva"
IMAGE_NAME="gcr.io/$PROJECT_ID/jiva"
BUCKET_NAME="jiva-state-$PROJECT_ID"

echo "🚀 Deploying Jiva to Cloud Run"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found. Please install it first."
    exit 1
fi

# Set project
echo "📦 Setting GCP project..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "🔧 Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com \
    --quiet

# Create GCS bucket if it doesn't exist
echo "🪣 Creating GCS bucket (if not exists)..."
gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$BUCKET_NAME 2>/dev/null || echo "Bucket already exists"

# Create service account if it doesn't exist
echo "👤 Creating service account (if not exists)..."
gcloud iam service-accounts create jiva-cloud-run \
    --display-name="Jiva Cloud Run Service Account" \
    --quiet 2>/dev/null || echo "Service account already exists"

# Grant permissions
echo "🔐 Granting permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:jiva-cloud-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin" \
    --quiet

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:jiva-cloud-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet

# Create secret for model API key if it doesn't exist
echo "🔑 Checking model API key secret..."
if ! gcloud secrets describe jiva-model-api-key --quiet 2>/dev/null; then
    echo "Please enter your model API key:"
    read -s API_KEY
    echo -n "$API_KEY" | gcloud secrets create jiva-model-api-key \
        --data-file=- \
        --replication-policy="automatic" \
        --quiet
    echo "✅ Secret created"
else
    echo "✅ Secret already exists"
fi

# Build container image
echo "🏗️  Building container image..."
gcloud builds submit --tag $IMAGE_NAME:latest --quiet

# Update cloud-run.yaml with project-specific values
echo "📝 Updating configuration..."
sed -i.bak "s/PROJECT_ID/$PROJECT_ID/g" cloud-run.yaml
sed -i.bak "s/BUCKET_NAME/$PROJECT_ID/g" cloud-run.yaml

# Deploy to Cloud Run
echo "🚢 Deploying to Cloud Run..."
gcloud run services replace cloud-run.yaml \
    --region=$REGION \
    --quiet

# Restore original cloud-run.yaml
mv cloud-run.yaml.bak cloud-run.yaml

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "🌐 Service URL: $SERVICE_URL"
echo ""
echo "Test the service:"
echo "  Health: curl $SERVICE_URL/health"
echo "  WebSocket: ws://${SERVICE_URL#https://}/ws?token=YOUR_TOKEN"
echo ""
echo "To make the service public (optional):"
echo "  gcloud run services add-iam-policy-binding $SERVICE_NAME \\"
echo "    --region=$REGION \\"
echo "   --member=\"allUsers\" \\"
echo "    --role=\"roles/run.invoker\""
