import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createDb } from "@new-api-key-usage/db";
import { appLogger, setupLogging } from "@new-api-key-usage/core";

const env = loadEnv(process.env);
setupLogging(env.LOG_LEVEL);

const db = createDb(env.DATABASE_URL);

const app = createApp({
  db,
  skKeyEncryptionSecret: env.SK_KEY_ENCRYPTION_SECRET,
  newapiBase: env.NEWAPI_BASE,
  cookieSecure: env.COOKIE_SECURE,
  adminInitUsername: env.ADMIN_INIT_USERNAME,
  adminInitPassword: env.ADMIN_INIT_PASSWORD,
});

appLogger("server").info`listening on port ${env.PORT} (cookie_secure=${env.COOKIE_SECURE}, log_level=${env.LOG_LEVEL})`;

export default {
  port: env.PORT,
  fetch: app.fetch,
};
