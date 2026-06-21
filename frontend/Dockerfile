# Multi-stage build for optimized production image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Build application with environment variables
ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

RUN npm run build

# Build the standalone embed widget (dist-embed/embed.js), served at /embed.js
RUN npm run build:embed

# Dev stage — Vite dev server with HMR (no build; source is bind-mounted at runtime).
# Only deps are baked in; the container's node_modules is preserved via an anonymous
# volume in docker-compose.vite.yml so the host's macOS-built node_modules never
# shadows the Linux-native ones (esbuild/terser are platform-specific).
FROM node:20-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Source is provided by a bind mount at runtime; nothing else is copied in.
EXPOSE 5173

# --host 0.0.0.0 makes the dev server reachable from outside the container.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Production stage with Nginx
FROM nginx:1.25-alpine AS production

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html
# Serve the embed widget at /embed.js
COPY --from=builder /app/dist-embed/embed.js /usr/share/nginx/html/embed.js

# Set permissions for nginx user (already exists in base image)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d

# Create nginx.pid directory
RUN touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# Note: nginx config validation happens automatically at container startup
# Cannot validate during build because upstream 'backend' doesn't exist yet

# Switch to non-root user
USER nginx

# Expose port
EXPOSE 8080

# Note: Health check configured in docker-compose.prod.yml
# (Docker Compose overrides Dockerfile HEALTHCHECK)

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
