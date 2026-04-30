FROM node:22-alpine

# Install system dependencies
RUN apk add --no-cache ffmpeg python3 curl bash

# Install latest yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies (including devDependencies for TypeScript build)
COPY package*.json ./
RUN npm install

# Copy all source files
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev && npm rebuild better-sqlite3

# Create data directories
RUN mkdir -p /tmp/downloads /tmp/db

EXPOSE 2500

CMD ["node", "dist/index.js"]
