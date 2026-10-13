# 语法：docker/dockerfile:1
# 只装配 release/ 产物，构建期不编译业务代码

# ---------- 应用运行时 ----------
# 用 Debian slim：与 Bun --compile（glibc）同源，兼容面更稳；
# CA 与 libstdc++ 显式安装，不依赖 slim 是否自带
FROM debian:bookworm-slim AS app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# --chmod：Windows 打包 / 跨机传输常丢可执行位，缺 x 时容器内 exec 以 126 退出
COPY --chmod=755 release/naku-server release/naku-engine release/naku-migrate /app/
COPY release/drizzle /app/drizzle
ENV MIGRATIONS_FOLDER=/app/drizzle
CMD ["/app/naku-server"]

# ---------- 网关（Caddy + 前端静态） ----------
FROM caddy:2-alpine AS proxy
COPY Caddyfile /etc/caddy/Caddyfile
COPY release/dist /srv
