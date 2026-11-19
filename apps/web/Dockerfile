# WMS-303: Vite output собирается из allowlist context; runtime не содержит credentials, tooling или backend.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS tooling
FROM tooling AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
# Vendor patch нужен pnpm при frozen install; runtime stage получает только dist.
COPY patches ./patches
RUN pnpm install --filter @warehouse/web --frozen-lockfile
COPY apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/
COPY apps/web/src apps/web/src
RUN pnpm --filter @warehouse/web build
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2
LABEL org.warehouse.runtime.base="sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2"
# Только Node binary и прежний uid1000; npm/Corepack/Yarn/shell/package manager не наследуются.
COPY --from=tooling /usr/local/bin/node /usr/local/bin/node
COPY --from=tooling /etc/passwd /etc/passwd
COPY --from=tooling /etc/group /etc/group
WORKDIR /workspace/apps/web
COPY --from=build /workspace/apps/web/dist ./dist
COPY apps/web/server/static-server.cjs ./server/static-server.cjs
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "server/static-server.cjs"]
