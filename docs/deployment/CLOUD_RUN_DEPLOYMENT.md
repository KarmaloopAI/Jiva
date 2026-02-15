# Deploying Jiva to Cloud Run

This guide walks you through deploying Jiva as a stateless, auto-scaling service on Google Cloud Run with GCS persistence.

## Architecture Overview

```
┌─────────────┐
│   Client    │
│ (React UI)  │
└──────┬──────┘
       │ WebSocket/HTTP
       ▼
┌──────────────────────────────────────┐
│         Cloud Run Service            │
│  ┌────────────────────────────────┐  │
│  │  Jiva HTTP/WebSocket Server    │  │
│  │  - Session Manager              │  │
│  │  - DualAgent Instances          │  │
│  │  - StorageProvider              │  │
│  └────────────┬───────────────────┘  │
└───────────────┼──────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │  GCS Bucket           │
    │  - Conversations      │
    │  - Configuration      │
    │  - Workspace Files    │
    │  - Logs               │
    └───────────────────────┘
```

## Prerequisites

1. **Google Cloud Project**
   - Active GCP project with billing enabled
   - gcloud CLI installed and authenticated

2. **Required APIs**
   - Cloud Run API
   - Cloud Build API
   - Cloud Storage API
   - Secret Manager API

3. **Local Development**
   - Node.js 20+
   - Docker (for building)

## Quick Deployment

### 1. Automated Deployment

```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy to Cloud Run
./deploy.sh YOUR_PROJECT_ID us-central1
```

The script will:
- Enable required APIs
- Create GCS bucket for state storage
- Create service account with permissions
- Create secrets for API keys
- Build and deploy container
- Output service URL

### 2. Manual Deployment

#### Step 1: Setup GCP Resources

```bash
# Set variables
PROJECT_ID="your-project-id"
REGION="us-central1"
BUCKET_NAME="jiva-state-$PROJECT_ID"

# Set project
gcloud config set project $PROJECT_ID

# Enable APIs
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com

# Create bucket
gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$BUCKET_NAME

# Create service account
gcloud iam service-accounts create jiva-cloud-run \
    --display-name="Jiva Cloud Run Service Account"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:jiva-cloud-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:jiva-cloud-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

#### Step 2: Create Secrets

```bash
# Model API key
echo -n "YOUR_API_KEY" | gcloud secrets create jiva-model-api-key \
    --data-file=- \
    --replication-policy="automatic"

# JWT secret (if using custom auth)
echo -n "YOUR_JWT_SECRET" | gcloud secrets create jiva-jwt-secret \
    --data-file=- \
    --replication-policy="automatic"
```

#### Step 3: Build and Deploy

```bash
# Build container
gcloud builds submit --tag gcr.io/$PROJECT_ID/jiva:latest

# Update cloud-run.yaml with your PROJECT_ID and BUCKET_NAME

# Deploy
gcloud run services replace cloud-run.yaml --region=$REGION
```

## Configuration

### Environment Variables

Key environment variables are set in `cloud-run.yaml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `JIVA_STORAGE_PROVIDER` | Storage backend | `gcp` |
| `JIVA_GCP_BUCKET` | GCS bucket name | `jiva-state-{project}` |
| `MAX_CONCURRENT_SESSIONS` | Max sessions per instance | `100` |
| `SESSION_IDLE_TIMEOUT_MS` | Session timeout | `1800000` (30 min) |
| `AUTH_STRATEGY` | Auth method | `firebase` |

### Authentication

#### Option 1: Firebase Auth (Recommended)

```bash
# Set Firebase service account
gcloud secrets create firebase-service-account \
    --data-file=service-account.json
```

Update `cloud-run.yaml`:
```yaml
- name: AUTH_STRATEGY
  value: "firebase"
```

#### Option 2: Custom JWT

```bash
# Create JWT secret
gcloud secrets create jiva-jwt-secret --data-file=-
```

Update `cloud-run.yaml`:
```yaml
- name: AUTH_STRATEGY
  value: "custom"
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: jiva-jwt-secret
      key: latest
```

#### Option 3: Development Mode (Insecure)

```yaml
- name: AUTH_DISABLED
  value: "true"
```

### Resource Limits

Adjust based on your needs in `cloud-run.yaml`:

```yaml
resources:
  limits:
    cpu: "2000m"      # 2 vCPU
    memory: "4Gi"      # 4GB RAM
  requests:
    cpu: "1000m"       # 1 vCPU minimum
    memory: "2Gi"      # 2GB RAM minimum
```

## Testing

### Health Check

```bash
SERVICE_URL=$(gcloud run services describe jiva --region=$REGION --format='value(status.url)')
curl $SERVICE_URL/health
```

### REST API

```bash
# Create session
curl -X POST $SERVICE_URL/api/session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# Send message
curl -X POST $SERVICE_URL/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, Jiva!"}'
```

### WebSocket

```javascript
const ws = new WebSocket('wss://your-service.run.app/ws?token=YOUR_TOKEN');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'message',
    content: 'Hello, Jiva!'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

## Local Development

### Run HTTP Server Locally

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Set JIVA_STORAGE_PROVIDER=local for testing

# Run in development mode
npm run dev:http

# Server starts at http://localhost:8080
```

### Test with Docker

```bash
# Build image
docker build -t jiva:local .

# Run container
docker run -p 8080:8080 \
  -e NODE_ENV=development \
  -e AUTH_DISABLED=true \
  -e JIVA_STORAGE_PROVIDER=local \
  -e JIVA_MODEL_API_KEY=your-key \
  jiva:local

# Test
curl http://localhost:8080/health
```

## Monitoring

### Logs

```bash
# View logs
gcloud run services logs read jiva --region=$REGION --limit=100

# Stream logs
gcloud run services logs tail jiva --region=$REGION
```

### Metrics

```bash
# Get service details
gcloud run services describe jiva --region=$REGION

# View in Cloud Console
echo "https://console.cloud.google.com/run?project=$PROJECT_ID"
```

## Scaling

Cloud Run auto-scales based on traffic:

- **Min instances**: 0 (scale to zero when idle)
- **Max instances**: 10 (configurable in `cloud-run.yaml`)
- **Container concurrency**: 80 (WebSocket connections per instance)
- **Timeout**: 3600s (60 minutes for long sessions)

## Costs

Typical costs for Cloud Run deployment:

- **Compute**: $0.00002400/vCPU-second, $0.00000250/GB-second
- **Requests**: $0.40 per million requests
- **Storage**: GCS Standard - $0.020/GB/month
- **Scale to zero**: No charges when idle

Example monthly cost for moderate usage:
- 10,000 requests/month: ~$5-10/month

## Troubleshooting

### Issue: Container fails to start

Check logs:
```bash
gcloud run services logs read jiva --region=$REGION
```

Common causes:
- Missing secrets
- Invalid GCS bucket permissions
- Model API key not set

### Issue: WebSocket disconnects

- Increase `timeoutSeconds` in `cloud-run.yaml`
- Check if client sends heartbeat pings
- Verify `cpu-throttling: false` is set

### Issue: Sessions not persisting

- Verify GCS bucket permissions
- Check `JIVA_GCP_BUCKET` environment variable
- Ensure service account has `storage.objectAdmin` role

## Security Best Practices

1. **Enable Authentication**
   - Use Firebase Auth or custom JWT
   - Never set `AUTH_DISABLED=true` in production

2. **Restrict CORS**
   - Set `ALLOWED_ORIGINS` to your frontend domains only

3. **Service Account**
   - Use dedicated service account with minimal permissions
   - Don't use default Compute Engine service account

4. **Secrets Management**
   - Store API keys in Secret Manager
   - Never commit secrets to git

5. **Network Security**
   - Configure VPC connector if needed
   - Use Cloud Armor for DDoS protection

## Next Steps

1. **React UI Integration**
   - See `docs/REACT_INTEGRATION.md` (TODO)
   
2. **Custom MCP Servers**
   - Add MCP server configs to GCS
   - Upload to `gs://bucket/config/mcpServers.json`

3. **Multi-tenancy**
   - Configure tenantId extraction from JWT
   - Implement per-tenant quotas

4. **Monitoring & Alerting**
   - Setup Cloud Monitoring dashboards
   - Configure alerting policies

## Support

- GitHub Issues: https://github.com/KarmaloopAI/Jiva/issues
- Documentation: https://github.com/KarmaloopAI/Jiva/docs
