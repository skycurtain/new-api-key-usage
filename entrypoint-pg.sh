#!/bin/sh
# 从 DATABASE_URL 拆出官方镜像建库所需的 POSTGRES_*，再交回原入口
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

u="${DATABASE_URL#*://}"
auth="${u%%@*}"
rest="${u#*@}"

export POSTGRES_USER="${auth%%:*}"
export POSTGRES_PASSWORD="${auth#*:}"
export POSTGRES_DB="${rest#*/}"
export POSTGRES_DB="${POSTGRES_DB%%\?*}"

exec docker-entrypoint.sh postgres
