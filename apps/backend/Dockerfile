# WMS-112: context — корень monorepo; credentials, build args с секретами и host artifacts не используются.
# Node 24.22.3 / Debian trixie; digest закрепляет также базовые слои ОС. Обновлять осознанно с повтором gate.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS tooling
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
# Vendor patch входит в frozen install, но не копируется в runtime.
COPY patches ./patches

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
# Из pinned cc извлекаются только C++ packages с metadata; SSL bytes этого stage не наследуются runtime.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS cpp-source
FROM tooling AS cpp-runtime
COPY --from=cpp-source / /pinned-cc/
COPY scripts/image-release/cpp-runtime.cjs /tmp/cpp-runtime.cjs
RUN node /tmp/cpp-runtime.cjs /pinned-cc /runtime-cpp
# Официальный base-nossl содержит glibc/CA, но не системные libssl/libcrypto.
FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5 AS runtime
LABEL org.warehouse.runtime.base="sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5"
COPY --from=cpp-runtime /runtime-cpp/ /
# Только Node binary и прежний uid1000; npm/Corepack/Yarn/shell/package manager не наследуются.
COPY --from=tooling /usr/local/bin/node /usr/local/bin/node
COPY --from=tooling /etc/passwd /etc/passwd
COPY --from=tooling /etc/group /etc/group
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
