# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Social Media Downloader API - A Fastify-based REST API for downloading media from social platforms (YouTube, Instagram, Twitter/X). Uses yt-dlp as the primary download engine.

## Development Commands

### Core Commands
- `npm run dev` - Start development server with hot reload (tsx watch)
- `npm run build` - Compile TypeScript to JavaScript (outputs to dist/)
- `npm start` - Run production build from dist/index.js
- `npm test` - Run tests with Vitest
- `npm run test:coverage` - Generate test coverage report
- `npm run test:ui` - Open Vitest UI for interactive testing

### Type Checking
- `npx tsc --noEmit` - Type check without emitting files (used in CI/CD)

### Testing Individual Files
```bash
npx vitest run src/__tests__/<filename>.test.ts
```

## Architecture

### Server Configuration
- **Framework**: Fastify (port 2500)
- **Frontend**: Express static server (ports 8081, 8082) serves public/ directory
- **Download Engine**: yt-dlp (system binary)
- **Path Aliases**: `@/*` maps to `src/*` (configured in tsconfig.json)

### Directory Structure
```
src/
├── controllers/     # Route handlers for auth and download operations
├── services/        # Business logic (downloader, platform auth, user auth)
├── routes/          # Route definitions (auth.routes, downloader, user)
├── types/           # TypeScript type definitions
├── config/          # Configuration files (auth.config)
├── __tests__/       # Vitest test files
└── __mocks__/       # Test mocks
```

### Core Flow
1. **Entry Point**: `src/index.ts` - Configures Fastify, registers plugins (CORS, JWT, Swagger), and defines inline download routes
2. **Download Logic**: Inline in index.ts (downloadYouTube, downloadInstagram, downloadTwitter functions) - Uses yt-dlp subprocess via execAsync
3. **File Serving**: Static files served from `downloads/` directory (auto-created if missing)
4. **Auth**: JWT-based with platform OAuth support (Instagram, YouTube, Twitter, TikTok) - Services implemented but not fully integrated

### Key Implementation Details

**Download Process**:
- URL validation by platform (YouTube, Instagram, Twitter/X)
- Format selection: `bestaudio` for audio, `best` video+audio for video
- Files saved as `{platform}_{timestamp}.{ext}` in downloads/
- Metadata extracted from yt-dlp JSON output (YouTube only)
- Response includes download URL: `/downloads/{filename}`

**yt-dlp Commands**:
- Info: `yt-dlp "{url}" --dump-json --no-warnings`
- Download: `yt-dlp "{url}" -f "{format}" -o "{path}" --write-info-json --no-warnings --progress --newline`

**CORS Origins**:
- localhost:2000, 8081, 8082, 19006
- exp://localhost:2100, 127.0.0.1:2100, 8081, 8082

### Environment Variables (Required)
```bash
# API Keys
YOUTUBE_API_KEY=
TWITTER_BEARER_TOKEN=

# JWT
JWT_SECRET=

# Platform OAuth (optional for auth features)
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_REDIRECT_URI=
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=
```

### Testing Approach
- **Framework**: Vitest with v8 coverage
- **Mocking**: Uses `__mocks__/` directory for Fastify and platform service mocks
- **Coverage excludes**: node_modules/, dist/, test files, config files, types/, __mocks__/

## CI/CD

The project uses GitHub Actions (`.github/workflows/ci-cd.yml`):
- Runs on push to main/develop and PRs to main
- Pipeline: test → security scan → build Docker image → deploy
- Type checking: `npx tsc --noEmit`
- Linting: `npm run lint` (soft fail if not configured)
- Security: npm audit + Snyk scan
- Deployment targets: VPS, AWS ECS, GCP Cloud Run (all optional)

## Important Notes

### System Dependencies
- **yt-dlp**: Must be installed on system (Homebrew path: `/opt/homebrew/bin/yt-dlp`)
- Downloads folder auto-created at startup

### Code Patterns
- Uses ES modules (`"type": "module"` in package.json)
- TypeScript strict mode enabled
- Async/await pattern for download operations
- Error handling with typed errors (DownloadError interface)
- Pino logger with pretty printing in development

### Known Limitations
- Platform auth services (Instagram, YouTube, Twitter, TikTok OAuth) defined but not fully integrated with download flow
- Database files (`db/*.json`) present but not actively used in current implementation
- Frontend server (frontend.ts) separate from API server

### When Adding New Platform Support
1. Add URL detection helper (e.g., `isPlatformURL`)
2. Implement `downloadPlatform` function following existing pattern
3. Add format selection logic for platform
4. Update `/api/download` route handler
5. Add metadata extraction if available
6. Add tests in `__tests__/` directory