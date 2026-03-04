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
pnpm --filter @threadatlas/extension build
```

Load unpacked extension from:

`apps/extension/dist`

## API stub status

- `POST /api/token`: returns stub token and expiry (10 min)
- `POST /api/analyze`: returns minimal `ThreadSemantics` from incoming `ThreadDoc`
- `POST /api/evaluate`: SSE stream emits one `projection` (`respond`) and one `done`

## Source of truth

- `docs/internals/PRD.md`
- `docs/internals/BE-SPEC.md`
- `docs/internals/FE-SPEC.md`
- `docs/internals/SCENARIO.md`
