# Jiva Cloud Run Implementation - Summary

This document summarizes the Cloud Run implementation for Jiva that enables stateless, auto-scaling deployment with GCS persistence.

## What Was Implemented

### ✅ New HTTP/WebSocket Interface

**Location**: [src/interfaces/http/](src/interfaces/http/)

- **Entry Point** ([index.ts](src/interfaces/http/index.ts)): Express + WebSocket server with health checks, CORS, and graceful shutdown
- **Session Manager** ([session-manager.ts](src/interfaces/http/session-manager.ts)): Manages DualAgent lifecycle, per-session MCP servers, idle timeouts, and state persistence
- **WebSocket Handler** ([websocket-handler.ts](src/interfaces/http/websocket-handler.ts)): Real-time bidirectional communication with heartbeat monitoring
- **Auth Middleware** ([middleware/auth.ts](src/interfaces/http/middleware/auth.ts)): JWT verification supporting Firebase Auth, custom JWT, and dev mode
- **REST API Routes**:
  - [routes/health.ts](src/interfaces/http/routes/health.ts): `/health`, `/ready`, `/startup` for Cloud Run probes
  - [routes/session.ts](src/interfaces/http/routes/session.ts): Session CRUD operations
  - [routes/chat.ts](src/interfaces/http/routes/chat.ts): Chat endpoints with SSE streaming support

### ✅ Storage Abstraction Integration

**Refactored Components**:

- **ConversationManager** ([src/core/conversation-manager.ts](src/core/conversation-manager.ts)): Now uses `StorageProvider` instead of direct filesystem access
- **WorkspaceManager** ([src/core/workspace.ts](src/core/workspace.ts)): Supports both local filesystem and `StorageProvider` for directive loading

**Benefits**:
- Seamless switching between local (CLI) and cloud (GCS) storage
- Multi-tenant path isolation in GCS
- Conversation history, workspace files, and logs all persist to GCS

### ✅ Deployment Infrastructure

**Files Created**:

- **Dockerfile**: Multi-stage build (builder + production) with dumb-init, health checks, and non-root user
- **.dockerignore**: Optimized build context
- **cloud-run.yaml**: Complete Cloud Run service configuration with:
  - Auto-scaling (0-10 instances)
  - CPU always-on for WebSocket
  - 60-minute timeout for long sessions
  - Health probes (startup, liveness, readiness)
  - Environment variables and secrets integration
- **deploy.sh**: Automated deployment script with GCP setup
- **.env.example**: Environment variables template (already existed, not overwritten)
- **docs/CLOUD_RUN_DEPLOYMENT.md**: Comprehensive deployment guide

### ✅ Package Updates

**[package.json](package.json)**:

- Added dependencies: `express`, `ws`, `jsonwebtoken`
- Added devDependencies: `@types/express`, `@types/ws`, `@types/jsonwebtoken`
- Added peerDependencies: `firebase-admin` (optional)
- New scripts:
  - `dev:http`: Run HTTP server in development
  - `serve`: Run production HTTP server
- Exported storage module in [src/index.ts](src/index.ts)

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Cloud Run Container                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Express HTTP Server (port 8080)                     │  │
│  │  ├─ Health routes (/health, /ready, /startup)       │  │
│  │  ├─ Session routes (/api/session, /api/sessions)    │  │
│  │  ├─ Chat routes (/api/chat, /api/chat/stream)       │  │
│  │  └─ WebSocket upgrades (/ws)                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Auth Middleware (JWT verification)                  │  │
│  │  - Firebase Auth or Custom JWT                       │  │
│  │  - Extract tenantId, sessionId, userId               │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Session Manager                                      │  │
│  │  - Track active DualAgent instances                  │  │
│  │  - Idle timeout (30 min default)                     │  │
│  │  - Max concurrent sessions (100 default)             │  │
│  │  - Per-session MCP servers                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  DualAgent (Manager + Worker + Client)               │  │
│  │  - In-memory conversation state                      │  │
│  │  - ModelOrchestrator (Krutrim/Custom)                │  │
│  │  - MCPServerManager (per-session)                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  StorageProvider (GCPBucketProvider)                 │  │
│  │  - Context: {tenantId, sessionId}                    │  │
│  │  - saveConversation(), loadConversation()            │  │
│  │  - loadDirective(), saveDirective()                  │  │
│  │  - flushLogs(), exportState()                        │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                           ▼
          ┌────────────────────────────────────┐
          │  GCS Bucket: jiva-state            │
          │  {tenantId}/                       │
          │  ├─ sessions/{sessionId}/          │
          │  │  ├─ conversation.json            │
          │  │  ├─ workspace/                   │
          │  │  └─ logs/                        │
          │  └─ config/                         │
          │     ├─ models.json                  │
          │     └─ mcpServers.json              │
          └────────────────────────────────────┘
```

## Key Features

### 🔄 Session Lifecycle

1. **Request arrives** → Auth middleware verifies JWT and extracts `tenantId`, `sessionId`
2. **Session creation** → SessionManager gets or creates DualAgent + MCP servers
3. **State restoration** → StorageProvider loads conversation history from GCS
4. **In-memory processing** → Agent operates on conversation state in memory (fast)
5. **Auto-save** → Conversation persists to GCS after each message
6. **Idle timeout** → After 30 min inactivity, session destroyed and state persisted
7. **Container shutdown** → All sessions gracefully closed, state saved to GCS

### 🔐 Multi-Tenancy

- **Path isolation**: GCS paths are `{tenantId}/sessions/{sessionId}/`
- **Per-tenant config**: Each tenant can have their own model config, MCP servers
- **Session limits**: Configurable max concurrent sessions per tenant

### 🚀 Performance

- **Per-session MCP servers**: Isolated per agent instance (recommended approach implemented)
- **In-memory operations**: Fast reads/writes during session
- **Batched logging**: Logs buffered in memory, flushed to GCS periodically
- **Scale to zero**: No charges when idle

### 🔌 API Endpoints

**REST API**:
- `POST /api/session` - Create/restore session
- `GET /api/sessions` - List active sessions
- `DELETE /api/session/:id` - Delete session
- `POST /api/chat` - Send message (non-streaming)
- `POST /api/chat/stream` - Send message (SSE streaming)
- `GET /api/chat/history` - Get conversation history

**WebSocket**:
- `ws://host/ws?token=JWT` - Real-time bidirectional chat
- Protocol: JSON messages with `type`, `content`
- Heartbeat: Ping/pong every 30s

**Health**:
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe
- `GET /startup` - Startup probe

## Deployment

### Quick Start

```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy
./deploy.sh YOUR_PROJECT_ID us-central1
```

### Manual Steps

See [docs/CLOUD_RUN_DEPLOYMENT.md](docs/CLOUD_RUN_DEPLOYMENT.md) for comprehensive guide.

### Local Testing

```bash
# Install dependencies
npm install

# Run HTTP server in dev mode
npm run dev:http

# Test
curl http://localhost:8080/health
```

## Configuration

### Environment Variables

Key variables (set in `cloud-run.yaml` or `.env`):

```bash
# Storage
JIVA_STORAGE_PROVIDER=gcp
JIVA_GCP_BUCKET=jiva-state-{project}
JIVA_GCP_PROJECT={project-id}

# Sessions
MAX_CONCURRENT_SESSIONS=100
SESSION_IDLE_TIMEOUT_MS=1800000  # 30 min

# Auth
AUTH_STRATEGY=firebase  # or "custom"
AUTH_DISABLED=false

# Model
JIVA_MODEL_PROVIDER=krutrim
JIVA_MODEL_API_KEY=***  # from Secret Manager
JIVA_MODEL_BASE_URL=https://api.olaayush.ai/v1
JIVA_MODEL_NAME=Meta-Llama-3.1-405B-Instruct
```

## Integration with React UI

### Example Client Code

```typescript
// WebSocket connection
const ws = new WebSocket('wss://jiva.run.app/ws?token=YOUR_JWT');

ws.onopen = () => {
  console.log('Connected to Jiva');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'status':
      console.log('Status:', data.message);
      break;
    case 'response':
      console.log('Agent:', data.content);
      break;
    case 'error':
      console.error('Error:', data.message);
      break;
  }
};

// Send message
ws.send(JSON.stringify({
  type: 'message',
  content: 'Hello, Jiva!'
}));
```

### REST API Example

```typescript
// Send message via REST
const response = await fetch('https://jiva.run.app/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ message: 'Hello, Jiva!' }),
});

const data = await response.json();
console.log(data.response);
```

## CLI vs Cloud Run

The npm package now supports **both** CLI and Cloud Run modes:

### CLI Mode (Existing)

```bash
# Install globally
npm install -g jiva-core

# Run CLI
jiva --help

# Uses local filesystem (~/.jiva)
# Interactive REPL
# Direct terminal output
```

### Cloud Run Mode (New)

```bash
# Deploy to Cloud Run
./deploy.sh

# Access via HTTP/WebSocket
curl https://jiva.run.app/api/chat

# Uses GCS for persistence
# React UI integration
# Multi-tenant support
```

**Both modes share**:
- Same agent architecture (Manager, Worker, Client)
- Same storage abstraction (StorageProvider)
- Same model integration (ModelOrchestrator)
- Same MCP support (MCPServerManager)

## Next Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Test Locally**
   ```bash
   npm run dev:http
   curl http://localhost:8080/health
   ```

3. **Deploy to Cloud Run**
   ```bash
   ./deploy.sh YOUR_PROJECT_ID
   ```

4. **Build React UI**
   - Create React app
   - Connect to WebSocket/REST API
   - Implement JWT authentication

5. **Production Hardening**
   - Enable authentication (disable `AUTH_DISABLED`)
   - Configure CORS for your domain
   - Set up monitoring and alerting
   - Implement rate limiting

## Files Modified/Created

### New Files

- `src/interfaces/http/index.ts` - HTTP server entry point
- `src/interfaces/http/session-manager.ts` - Session lifecycle management
- `src/interfaces/http/websocket-handler.ts` - WebSocket handler
- `src/interfaces/http/middleware/auth.ts` - JWT auth middleware
- `src/interfaces/http/routes/health.ts` - Health check routes
- `src/interfaces/http/routes/session.ts` - Session management routes
- `src/interfaces/http/routes/chat.ts` - Chat API routes
- `Dockerfile` - Multi-stage container build
- `.dockerignore` - Build optimization
- `cloud-run.yaml` - Cloud Run service config
- `deploy.sh` - Automated deployment script
- `docs/CLOUD_RUN_DEPLOYMENT.md` - Deployment guide

### Modified Files

- `src/core/conversation-manager.ts` - Refactored to use StorageProvider
- `src/core/workspace.ts` - Added StorageProvider support
- `src/index.ts` - Exported storage module and ConversationManager
- `package.json` - Added HTTP dependencies and scripts

## Cost Estimate

**Typical monthly costs for Cloud Run**:

- Light usage (1K requests/month): $2-5/month
- Moderate usage (10K requests/month): $10-20/month
- Heavy usage (100K requests/month): $50-100/month

**Includes**:
- Compute (vCPU + memory)
- Request charges
- GCS storage ($0.020/GB/month)
- Egress (if applicable)

**Scale to zero = $0 when idle** 🎉

## Support

For issues, questions, or contributions:
- GitHub Issues: https://github.com/KarmaloopAI/Jiva/issues
- Deployment Guide: [docs/CLOUD_RUN_DEPLOYMENT.md](docs/CLOUD_RUN_DEPLOYMENT.md)
