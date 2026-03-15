# ThreadAtlas

ThreadAtlas monorepo for a semantic browser copilot.

## Workspace layout

- `apps/api`: current-page session runtime API
- `apps/extension`: Chrome Extension sidepanel copilot
- `packages/shared`: Shared contracts/types/utils

## Prerequisites

- Node.js 20+
- pnpm 10+

## Install

```bash
pnpm install
```

## Build

```bash
pnpm -w build
```

## Test

```bash
pnpm -w test
```

## Run API (local MVP)

```bash
export GOOGLE_CLOUD_PROJECT=threadatlas
export GOOGLE_CLOUD_LOCATION=us-central1
export AUTH_BOOTSTRAP_KEY=threadatlas-dev-bootstrap-2026-7Xq9Lr2Vm!K8pS4
export GOOGLE_APPLICATION_CREDENTIALS_HOST="$HOME/.config/gcloud/application_default_credentials.json"

docker compose -f docker-compose.yml -f docker-compose.gcp-local.yml up --build api
```

Default base URL: `http://localhost:8080`

Optional for real Google sign-in:

```bash
export GOOGLE_OAUTH_CLIENT_ID=<your-google-oauth-client-id>
pnpm extension:build
```

## Build extension

```bash
pnpm extension:build
```

## Deployment

- Cloud Run 배포 가이드: [docs/cloud-run-deployment-guide.md](/Users/spark/workspace/thread-atlas/docs/cloud-run-deployment-guide.md)

Load unpacked extension from:

`apps/extension/dist`

## Use In Chrome

1. Build the extension:

```bash
pnpm extension:build
```

2. Open `chrome://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select [apps/extension/dist](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/dist)
6. Open a Hacker News item page like `https://news.ycombinator.com/item?id=...`
7. Click the ThreadAtlas toolbar button to open the sidepanel
8. In the sidepanel DevTools console, configure one of the following:

Internal preview via hidden `dev-bootstrap` override:

```js
await chrome.storage.local.set({
  THREADATLAS_API_BASE_URL: "http://localhost:8080",
  THREADATLAS_AUTH_GRANT_TYPE: "dev-bootstrap",
  THREADATLAS_BOOTSTRAP_SUBJECT: "local-dev-user-1",
  THREADATLAS_AUTH_BOOTSTRAP_KEY: "threadatlas-dev-bootstrap-2026-7Xq9Lr2Vm!K8pS4",
  THREADATLAS_AUTH_DISPLAY_NAME: "Local Dev",
  THREADATLAS_AUTH_PRIMARY_EMAIL: "local-dev@example.com"
})
location.reload()
```

Real Google sign-in without rebuilding:

```js
await chrome.storage.local.set({
  THREADATLAS_API_BASE_URL: "http://localhost:8080",
  THREADATLAS_GOOGLE_OAUTH_CLIENT_ID: "<your-google-oauth-client-id>"
})
location.reload()
```

9. If you configured Google sign-in, use `Continue with Google` in the sidepanel.
10. Use `Capture Snapshot`, the context menu item, or the shortcut `Alt+Shift+C`
11. Ask a text question in the `Conversation` section or use `Mic`
12. Toggle semantic selection with `Alt+Shift+S` when you want to bind the snapshot to a specific node

## Runtime Notes

- Semantic snapshot capture works without the local API server.
- Text-first current-page conversation expects the local API server.
- The canonical runtime path is `POST /api/token` plus `GET /ws/session`.
- Chrome native STT runs in the page context; Chrome native TTS runs in the sidepanel.
- Voice/live is optional and not required for the internal MVP.

## Source of truth

- `docs/internals/PRD.md`
- `docs/internals/BE-SPEC.md`
- `docs/internals/FE-SPEC.md`
- `docs/internals/SCENARIO.md`
