# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build project
RUN npm run build:all

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    jq \
    su-exec \
    wget \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /data && \
    chown -R nodejs:nodejs /app /data

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist /app/dist
# Vendor assets need to be inside dist/ because __dirname points to /app/dist in production
COPY --from=builder --chown=nodejs:nodejs /app/public/vendor /app/dist/public/vendor

# Copy entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Create symlinks for configuration
RUN ln -sf /data/settings.json /app/settings.json && \
    ln -sf /data/settings.d /app/settings.d

# Environment variables
ENV NODE_ENV=production \
    DATA_PATH=/data \
    PORT=3000 \
    BIND_ADDRESS=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Default command
CMD ["node", "dist/bundle.js"]