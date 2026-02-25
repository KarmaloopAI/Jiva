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

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip postinstall/playwright)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Pre-install MCP servers globally so they don't need to be downloaded per-session
RUN npm install -g @modelcontextprotocol/server-filesystem

# Copy built application from builder
COPY --from=builder /app/dist ./dist

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
    JIVA_STORAGE_PROVIDER=gcp \
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
