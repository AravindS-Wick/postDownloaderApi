# Use Node.js LTS version
FROM node:20-alpine AS base

# Install system dependencies including Python and build tools for yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    bash \
    && ln -sf python3 /usr/bin/python

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
FROM base AS deps
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS build
COPY . .
RUN npm ci
RUN npm run build

# Production stage
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

# Create downloads directory
RUN mkdir -p /app/downloads && chown -R nodejs:nodejs /app/downloads

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 2500

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:2500/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
