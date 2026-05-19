# Multi-stage build for Jiva Cloud Run deployment
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (skip postinstall/playwright in CI environment)
RUN npm ci --ignore-scripts

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install dumb-init and bash (bash required by zx in @mkusaka/mcp-shell-server)
RUN apk add --no-cache dumb-init bash

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip postinstall/playwright)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Pre-install MCP servers globally so they don't need to be downloaded per-session
RUN npm install -g @modelcontextprotocol/server-filesystem

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy agent scripts and pre-install their dependencies
COPY scripts ./scripts
RUN cd scripts && npm install @google/genai mime --no-save --silent && npm cache clean --force

# Create workspace directory and set permissions
RUN mkdir -p /workspace && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    chown nodejs:nodejs /workspace

USER nodejs

# Environment variables (overrideable)
ENV NODE_ENV=production \
    PORT=8080 \
    LOG_LEVEL=info \
    JIVA_STORAGE_PROVIDER=gcp-bucket \
    MAX_CONCURRENT_SESSIONS=100 \
    SESSION_IDLE_TIMEOUT_MS=1800000

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start HTTP server
CMD ["node", "dist/interfaces/http/index.js"]
