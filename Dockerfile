# 语法：docker/dockerfile:1
# 构建产物：/app/naku-server · /app/naku-engine · /app/drizzle · /srv（前端）

# ---------- 构建：依赖 + 前端 + 两个单文件 ----------
FROM oven/bun:1.4-alpine AS build
WORKDIR /src

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

# 前端静态资源
RUN bun run --cwd apps/web build-only

# 单文件（linux-x64；构建发生在 Linux 容器内，无需交叉编译）
RUN mkdir -p /out \
  && bun build --compile --outfile /out/naku-server apps/server/src/index.ts \
  && bun build --compile --outfile /out/naku-engine apps/engine/src/index.ts

# ---------- 应用运行时：两个二进制 + 迁移 SQL ----------
FROM alpine:3.20 AS app
WORKDIR /app
# Bun 单文件仍需 C++ 运行时与 CA；从构建镜像拷贝，避免 apk 联网
COPY --from=build /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /usr/lib/
COPY --from=build /etc/ssl/certs /etc/ssl/certs
COPY --from=build /out/naku-server /out/naku-engine /app/
COPY --from=build /src/packages/db/drizzle /app/drizzle
ENV MIGRATIONS_FOLDER=/app/drizzle
# 默认跑 server；compose 里 engine 覆盖 command
CMD ["/app/naku-server"]

# ---------- 网关：Caddy + 前端静态资源 ----------
FROM caddy:2-alpine AS proxy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
