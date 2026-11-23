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
# Из pinned cc извлекаются только C++ packages с metadata; SSL bytes этого stage не наследуются runtime.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS cpp-source
FROM tooling AS cpp-runtime
COPY --from=cpp-source / /pinned-cc/
COPY scripts/image-release/cpp-runtime.cjs /tmp/cpp-runtime.cjs
RUN node /tmp/cpp-runtime.cjs /pinned-cc /runtime-cpp
# Официальный base-nossl содержит glibc/CA, но не системные libssl/libcrypto.
FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5
LABEL org.warehouse.runtime.base="sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5"
COPY --from=cpp-runtime /runtime-cpp/ /
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
