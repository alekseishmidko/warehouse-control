# WMS-112: context — корень monorepo; credentials, build args с секретами и host artifacts не используются.
# Node 24.22.1 / Debian bookworm; digest закрепляет также базовые слои ОС. Обновлять осознанно с повтором gate.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS tooling
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json

# Отдельная prod install исключает Jest, TypeScript и Nest CLI из зависимостей runtime.
# Копировать полный build node_modules и затем удалять dev dependencies не требуется.
FROM tooling AS production-dependencies
RUN pnpm install --filter @warehouse/backend --prod --frozen-lockfile

FROM tooling AS build
RUN pnpm install --filter @warehouse/backend --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/backend/tsconfig*.json apps/backend/nest-cli.json apps/backend/
COPY apps/backend/src apps/backend/src
RUN pnpm --filter @warehouse/backend build

# Новая базовая стадия: установленные в tooling pnpm и dev dependencies не наследуются.
# Сохраняем оба node_modules: symlinks backend ведут в корневой pnpm store этого же workspace.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production PORT=3000 HTTP_HOST=0.0.0.0 DEV_ACTOR_ENABLED=false OUTBOX_ADMIN_ENABLED=false
WORKDIR /workspace/apps/backend
COPY --from=production-dependencies /workspace/node_modules /workspace/node_modules
COPY --from=production-dependencies /workspace/apps/backend/node_modules ./node_modules
COPY --from=build /workspace/apps/backend/dist ./dist
# migrate.js ищет ../../../drizzle относительно compiled каталога: сохраняем исходную структуру путей.
COPY apps/backend/drizzle ./drizzle
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
# Node получает PID 1 и SIGTERM напрямую. Compose меняет CMD для worker/migrate, без shell/pnpm между ними.
ENTRYPOINT ["node"]
CMD ["dist/main.js"]
