# WMS-303: Vite output собирается из allowlist context; runtime не содержит credentials, tooling или backend.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @warehouse/web --frozen-lockfile
COPY apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/
COPY apps/web/src apps/web/src
RUN pnpm --filter @warehouse/web build
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /workspace/apps/web
COPY --from=build /workspace/apps/web/dist ./dist
COPY apps/web/server/static-server.cjs ./server/static-server.cjs
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "server/static-server.cjs"]
