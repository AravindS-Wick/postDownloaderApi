# Social Downloader API

Fastify 5 + TypeScript service that lets users download content from popular social platforms (YouTube, Instagram, X/Twitter, TikTok) and exposes authentication helpers for connecting platform accounts. The project uses Vitest for testing, ESLint/Prettier for code quality, and comes with Docker/Kubernetes assets for deployment.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Installation](#installation)
4. [Environment Configuration](#environment-configuration)
5. [Running the App](#running-the-app)
6. [Testing & Quality](#testing--quality)
7. [Available NPM Scripts](#available-npm-scripts)
8. [Architecture Overview](#architecture-overview)
9. [External Services & Tooling](#external-services--tooling)
10. [CI/CD Pipeline](#cicd-pipeline)
11. [Docker & Container Support](#docker--container-support)
12. [Kubernetes Manifests](#kubernetes-manifests)
13. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20.x** (the CI pipeline runs on Node 20)
- **npm 9+**
- **yt-dlp** binary installed on your machine  
  The downloader uses `youtube-dl-exec`, which shells out to `yt-dlp`. Make sure the binary is installed and reachable on `$PATH`. On macOS with Homebrew you can run `brew install yt-dlp`. On Linux use the distribution package manager or the [`yt-dlp` releases](https://github.com/yt-dlp/yt-dlp/releases).
- (Optional) **Docker** if you plan to run the container build or docker-compose stack.
- (Optional) **kubectl** and access to a cluster when deploying the manifests under `k8s/`.

---

## Project Structure

```
├── src/
│   ├── app.ts                # Core Fastify app factory (used in tests)
│   ├── index.ts              # Server entrypoint
│   ├── config/               # app/auth config helpers
│   ├── controllers/          # Route handler logic (if split out)
│   ├── plugins/              # Reusable Fastify plugins (rate limit, security, health)
│   ├── routes/               # Route registration modules
│   ├── services/             # Auth, platform, and download services
│   ├── types/                # Shared TypeScript interfaces
│   ├── utils/                # Error handling, helpers
│   ├── __tests__/            # Vitest unit/integration tests
│   └── __mocks__/            # Test doubles
├── downloads/                # Local temp download output (gitignored)
├── public/                   # Static assets (served if needed)
├── scripts/                  # Dev/deploy helper scripts
├── k8s/                      # Kubernetes manifests (namespace, configmap, deployment, etc.)
├── Dockerfile / docker-compose.yml
├── package.json / tsconfig.json / vitest.config.ts
└── README.md
```

---

## Installation

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd postDownloaderApi
npm install
```

> **Note:** The project now targets **Fastify 5** and matching `@fastify/*` plugins. Older node_modules installs may not work; always reinstall after pulling from main.

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description |
|----------|-------------|
| `PORT`, `HOST`, `NODE_ENV` | Server host binding. Docker uses `PORT=2500` by default. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Token signing secret and TTL. |
| `TWITTER_*`, `INSTAGRAM_*`, `YOUTUBE_*`, `TIKTOK_*` | OAuth credentials for each social platform. Configure redirect URIs to match your frontend. |
| `TWITTER_BEARER_TOKEN` | Used for X/Twitter API access. |
| `CORS_ORIGINS` | Comma-separated list of allowed origins. |
| `MAX_FILE_SIZE`, `DOWNLOAD_TIMEOUT` | Tune download limits. |
| `LOG_LEVEL` | Pino logger level (e.g. `info`, `debug`). |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Inputs for the rate-limit plugin. |
| `HEALTH_CHECK_INTERVAL` | Interval used by the health plugin. |

> The downloader currently expects `yt-dlp` at `/opt/homebrew/bin/yt-dlp` (see `src/services/downloader.service.ts`). Update the path or export `PATH` accordingly on non-mac systems.

---

## Running the App

### Local development (watched reload)

```bash
npm run dev
```

This uses `tsx` to compile `src/index.ts` with ESM support and restarts on change. The Fastify instance binds to `HOST`/`PORT` from `.env`.

### Production build

```bash
npm run build   # tsc -> dist/
npm start       # node dist/index.js
```

### Using Docker

```bash
npm run docker:build
npm run docker:run
```

or start the entire stack (API + reverse proxy + supporting services) using docker-compose:

```bash
npm run docker:compose
```

Shut it down with `npm run docker:compose:down`.

---

## Testing & Quality

- **Unit & integration tests:** `npm test` (Vitest).  
  Coverage: `npm run test:coverage`.
- **Type-checking:** `npm run type-check` (strict `tsc --noEmit`).
- **Linting:** `npm run lint` (ESLint with `@typescript-eslint`).  
  *Heads-up:* ESLint is configured with `parserOptions.project`, so it expects test files to be included in `tsconfig.json`. Adjust `tsconfig` or ESLint configuration if you enable linting for tests/mocks.
- **Formatting:** `npm run format` for write, `npm run format:check` for validation (Prettier).

The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) runs linting, type-checking, tests, and coverage on every push/PR.

---

## Available NPM Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Start Fastify with hot reload via `tsx` |
| `build` | Compile TypeScript to `dist/` |
| `start` | Run the compiled server |
| `test`, `test:coverage`, `test:ui` | Execute Vitest suites |
| `lint`, `lint:fix` | ESLint checks and auto-fix |
| `format`, `format:check` | Prettier formatting |
| `type-check` | TypeScript project validation |
| `docker:*` | Container build/run helpers |
| `clean` | Remove build artefacts (`dist`, `coverage`) |

---

## Architecture Overview

- **Fastify 5** server configured in `src/index.ts` with structured logging, error handling, and graceful shutdown.
- **Plugins:**
  - `@fastify/cors` for cross-origin controls.
  - Custom rate limiting (`src/plugins/rate-limit.ts`) and security headers (`src/plugins/security.ts`).
  - Health checks via `src/plugins/health.ts`.
  - `@fastify/jwt` provides JWT signing/verification with tokens configured by `src/config/auth.config.ts`.
  - `@fastify/static` serves temporary download files under `/temp/`.
  - `@fastify/swagger` and `@fastify/swagger-ui` expose API docs when `appConfig.enableSwagger` is true.
- **Routes:** Registered in `src/routes/auth.routes.ts` and `src/index.ts` for download/info endpoints.
- **Services:**
  - `AuthService` orchestrates platform OAuth flows using `PlatformService`.
  - `PlatformService` builds authorization URLs and exchanges codes for tokens per platform.
  - `DownloaderService` leverages `youtube-dl-exec` and Google APIs for media metadata and downloads.
- **Temporary File Management:** Files land in a temp directory created via `tempy` and are periodically cleaned up.

---

## External Services & Tooling

- **YouTube Data API** (Google APIs client) – requires API key and OAuth credentials.
- **Instagram Graph API** – OAuth client credentials required.
- **Twitter/X API (v2)** – needs bearer token + OAuth client credentials.
- **TikTok API** – OAuth client config.
- **yt-dlp** – handles the heavy lifting for media downloads across platforms.
- **Mongoose** is bundled but not yet wired; use it when you introduce persistence.

---

## CI/CD Pipeline

The GitHub Actions pipeline (`ci-cd.yml`) performs:

1. **Test job** – installs dependencies via `npm ci`, runs linting, type-checking, tests, and uploads coverage to Codecov.
2. **Security job** – `npm audit --audit-level=high` and an optional Snyk scan.
3. **Build job** – builds and pushes a multi-arch image to GHCR using Docker Buildx.
4. **Deploy jobs** – samples for staging, production, VPS, AWS ECS, and Google Cloud Run. Customize the scripts and provide the necessary secrets to activate them.

---

## Docker & Container Support

- `Dockerfile` builds a production image that installs dependencies, compiles TypeScript, and runs `node dist/index.js`.
- `docker-compose.yml` can orchestrate the API along with Nginx and any auxiliary services defined inside the compose file.
- `nginx.conf` configures reverse proxying for the API when using Docker compose or production deployments.

---

## Kubernetes Manifests

`k8s/` contains base manifests:

- `namespace.yaml` – namespace declaration.
- `configmap.yaml` / `secret.yaml` – app configuration and secret placeholders.
- `deployment.yaml` / `service.yaml` – workload + service exposure.
- `ingress.yaml`, `servicemonitor.yaml` – ingress routing and monitoring hooks.

Adjust image tags, resource requests/limits, and secrets before applying:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

---

## Troubleshooting

- **`fastify-plugin: ... expected '5.x'`** – Ensure all `@fastify/*` plugins are updated to versions compatible with Fastify 5 (already handled in `package.json`).
- **`yt-dlp` not found** – Install the binary and confirm the path used in `src/services/downloader.service.ts`. Consider exporting `PATH` or adjusting the `binaryPath`.
- **ESLint parsing errors for tests/mocks** – Either include test directories in `tsconfig.json` or remove them from the lint target.
- **CI coverage upload failures** – Verify `CODECOV_TOKEN` or adjust coverage path in the workflow.
- **OAuth redirect errors** – Make sure the redirect URIs configured for each platform match your frontend origin and the values inside `.env`.

---

Happy downloading! Contributions are welcome—open issues or PRs for enhancements and bug fixes.
