FROM node:22-alpine

# Install ffmpeg, python3 (for yt-dlp), and curl
RUN apk add --no-cache ffmpeg python3 curl

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code and config
COPY dist/ ./dist/

# Create data directories (overridden by mounted volume in production)
RUN mkdir -p /data/downloads /data/db

EXPOSE 2500

CMD ["node", "dist/index.js"]
