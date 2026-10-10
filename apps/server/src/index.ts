import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createDb, runMigrations } from "@new-api-key-usage/db";
import { appLogger, setupLogging } from "@new-api-key-usage/core";

const env = loadEnv(process.env);
setupLogging(env.LOG_LEVEL);

const db = createDb(env.DATABASE_URL);

const migrationsFolder =
  process.env.MIGRATIONS_FOLDER ??
  fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

await runMigrations(db, migrationsFolder);
appLogger("server").info("数据库迁移已就绪");

const app = createApp({
  db,
  skKeyEncryptionSecret: env.SK_KEY_ENCRYPTION_SECRET,
  newapiBase: env.NEWAPI_BASE,
  cookieSecure: env.COOKIE_SECURE,
  adminInitUsername: env.ADMIN_INIT_USERNAME,
  adminInitPassword: env.ADMIN_INIT_PASSWORD,
});

appLogger("server").info(
  `服务已启动，端口 ${env.PORT}（cookie_secure=${env.COOKIE_SECURE}，日志级别=${env.LOG_LEVEL}）`,
);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
