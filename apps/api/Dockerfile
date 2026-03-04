FROM node:20-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --filter @threadatlas/api --filter @threadatlas/shared

COPY apps/api apps/api
COPY packages/shared packages/shared

RUN pnpm --filter @threadatlas/shared build
RUN pnpm --filter @threadatlas/api build

EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
