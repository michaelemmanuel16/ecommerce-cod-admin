# Multi-stage build for optimized production image
FROM node:20-alpine AS builder

# Install openssl for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (needed for build)
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install dumb-init, netcat, and openssl for Prisma and healthchecks
RUN apk add --no-cache dumb-init netcat-openbsd openssl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files for production install
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generate client
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
RUN npx prisma generate

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy docker entrypoint script
COPY --from=builder --chown=nodejs:nodejs /app/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create necessary directories and set ownership
RUN mkdir -p /app/logs /app/uploads && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: 3000, path: '/health', timeout: 2000 }; const req = http.get(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { console.error('Health check failed with status:', res.statusCode); process.exit(1); } }); req.on('error', (err) => { console.error('Health check error:', err.message); process.exit(1); }); req.on('timeout', () => { console.error('Health check timed out'); req.destroy(); process.exit(1); });"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application using entrypoint script
CMD ["./docker-entrypoint.sh"]
