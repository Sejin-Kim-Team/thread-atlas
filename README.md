# ThreadAtlas

ThreadAtlas monorepo scaffold based on `docs/internals`.

## Workspace layout

- `apps/api`: Agent Brain API (Express + SSE, stubbed behavior)
- `apps/extension`: Chrome Extension (Semantic Relay skeleton, esbuild)
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

## Run API (local)

```bash
pnpm --filter @threadatlas/api dev
```

Default base URL: `http://localhost:8080`

## Build extension

```bash
pnpm extension:build
```

## Deployment

- Cloud Run 배포 가이드: [docs/cloud-run-deployment-guide.md](/Users/spark/workspace/thread-atlas/docs/cloud-run-deployment-guide.md)

Load unpacked extension from:

`apps/extension/dist`

## Use in Chrome

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
8. Use `Capture Snapshot`, the context menu item, or the shortcut `Alt+Shift+C`
9. Toggle semantic selection with `Alt+Shift+S`

## Runtime Notes

- Semantic snapshot capture works without the local API server.
- Voice-related flows still expect the API server:

```bash
pnpm api:dev
```

- Default API base URL is `http://localhost:8080`.

## API stub status

- `POST /api/token`: returns stub token and expiry (10 min)
- `POST /api/analyze`: returns minimal `ThreadSemantics` from incoming `ThreadDoc`
- `POST /api/evaluate`: SSE stream emits one `projection` (`respond`) and one `done`

## Source of truth

- `docs/internals/PRD.md`
- `docs/internals/BE-SPEC.md`
- `docs/internals/FE-SPEC.md`
- `docs/internals/SCENARIO.md`
