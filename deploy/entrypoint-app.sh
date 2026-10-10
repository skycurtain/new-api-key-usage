#!/bin/sh
# 把 DATABASE_URL 的主机改写为 compose 服务名 postgres，再启动应用
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

export DATABASE_URL="$(echo "$DATABASE_URL" | sed -E 's#(@)[^:/]+(:[0-9]+)?(/)#\1postgres\2\3#')"

exec "$@"
