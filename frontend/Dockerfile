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

# Production stage with Nginx
FROM nginx:1.25-alpine AS production

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

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
